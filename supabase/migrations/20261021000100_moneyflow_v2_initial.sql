begin;

do $$
declare
  existing_tables text;
begin
  select string_agg(c.relname, ', ' order by c.relname) into existing_tables
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname = any(array[
    'profiles', 'accounts', 'goals', 'transactions', 'transfers', 'balance_adjustments',
    'monthly_budgets', 'daily_budgets', 'budget_schedules', 'budget_occurrences',
    'goal_contributions', 'contributions', 'planned_spending', 'reservations',
    'calendar_notes', 'notifications', 'activity_history', 'migration_batches'
  ]);
  if existing_tables is not null then
    raise exception 'Initial MoneyFlow migration requires a fresh schema. Existing tables: %. Nothing was changed; inspect deployment history before proceeding.', existing_tables;
  end if;
end;
$$;

create extension if not exists pgcrypto with schema extensions;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  preferred_name text not null default '',
  currency text not null default 'PHP' check (currency = 'PHP'),
  monthly_income_target numeric(14,2) check (monthly_income_target is null or monthly_income_target >= 0),
  payday text not null default '',
  week_starts_on smallint not null default 1 check (week_starts_on in (0, 1)),
  date_format text not null default 'en-PH' check (date_format in ('en-PH', 'en-US', 'en-GB')),
  theme text not null default 'system' check (theme in ('light', 'dark', 'system')),
  accent text not null default 'ocean' check (accent in ('ocean', 'midnight', 'lagoon')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  name text not null,
  institution text not null default '',
  kind text not null check (kind in ('Traditional Bank', 'Digital Bank', 'E-Wallet', 'Cash', 'Investment Account', 'Other')),
  opening_balance numeric(14,2) not null default 0 check (opening_balance >= 0),
  include_in_total boolean not null default true,
  archived boolean not null default false,
  color text not null default '#3ba7ff',
  icon text not null default 'wallet',
  nickname text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_id),
  unique (id, user_id)
);

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  name text not null,
  target_amount numeric(14,2) not null check (target_amount > 0),
  initial_amount numeric(14,2) not null default 0 check (initial_amount >= 0),
  deadline date not null,
  color text not null default 'blue',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_id),
  unique (id, user_id)
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  account_id uuid,
  entry_type text not null check (entry_type in ('income', 'expense', 'saving')),
  amount numeric(14,2) not null check (amount > 0),
  occurred_on date not null,
  category text,
  description text not null default '',
  income_source text,
  notes text not null default '',
  saving_type text,
  saving_mode text check (saving_mode is null or saving_mode in ('opening', 'transfer')),
  related_entity_type text,
  related_client_id text,
  recurring boolean not null default false,
  provisional boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_id),
  unique (id, user_id),
  foreign key (account_id, user_id) references public.accounts(id, user_id) on delete restrict,
  check (entry_type <> 'expense' or category is not null),
  check (entry_type <> 'income' or income_source is not null),
  check (entry_type <> 'saving' or saving_type is not null)
);

create table if not exists public.transfers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  source_account_id uuid not null,
  destination_account_id uuid not null,
  amount numeric(14,2) not null check (amount > 0),
  occurred_on date not null,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_id),
  foreign key (source_account_id, user_id) references public.accounts(id, user_id) on delete restrict,
  foreign key (destination_account_id, user_id) references public.accounts(id, user_id) on delete restrict,
  check (source_account_id <> destination_account_id)
);

create table if not exists public.balance_adjustments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  account_id uuid not null,
  amount numeric(14,2) not null check (amount <> 0),
  occurred_on date not null,
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_id),
  foreign key (account_id, user_id) references public.accounts(id, user_id) on delete restrict
);

create table if not exists public.monthly_budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  category text not null,
  amount numeric(14,2) not null check (amount > 0),
  month date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_id)
);

create table if not exists public.daily_budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  budget_date date not null,
  amount numeric(14,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_id),
  unique (user_id, budget_date)
);

create table if not exists public.budget_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  title text not null,
  category text not null,
  amount numeric(14,2) not null check (amount > 0),
  source_account_id uuid not null,
  start_date date not null,
  end_date date not null,
  weekdays smallint[] not null default '{}',
  reservation_mode text not null default 'none' check (reservation_mode in ('none', 'reserve')),
  auto_post boolean not null default false,
  status text not null default 'active' check (status in ('active', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_id),
  unique (id, user_id),
  foreign key (source_account_id, user_id) references public.accounts(id, user_id) on delete restrict,
  check (end_date >= start_date),
  check (array_position(weekdays, null) is null),
  check (weekdays <@ array[0,1,2,3,4,5,6]::smallint[])
);

create table if not exists public.budget_occurrences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  budget_schedule_id uuid not null,
  occurrence_date date not null,
  planned_amount numeric(14,2) not null check (planned_amount > 0),
  actual_amount numeric(14,2) check (actual_amount is null or actual_amount >= 0),
  status text not null default 'scheduled' check (status in ('scheduled', 'due', 'pending_reconciliation', 'completed', 'exceeded', 'skipped', 'cancelled')),
  reservation_client_id text,
  posted_transaction_id uuid,
  reconciled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_id),
  unique (budget_schedule_id, occurrence_date),
  foreign key (budget_schedule_id, user_id) references public.budget_schedules(id, user_id) on delete cascade,
  foreign key (posted_transaction_id, user_id) references public.transactions(id, user_id) on delete restrict
);

create table if not exists public.goal_contributions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  goal_id uuid not null,
  account_id uuid not null,
  amount numeric(14,2) not null check (amount > 0),
  contribution_type text not null check (contribution_type in ('reserve', 'paid')),
  occurred_on date not null,
  notes text not null default '',
  transaction_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_id),
  unique (id, user_id),
  foreign key (goal_id, user_id) references public.goals(id, user_id) on delete restrict,
  foreign key (account_id, user_id) references public.accounts(id, user_id) on delete restrict,
  foreign key (transaction_id, user_id) references public.transactions(id, user_id) on delete restrict
);

create table if not exists public.contributions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  title text not null,
  category text not null,
  amount numeric(14,2) not null check (amount > 0),
  occurred_on date not null,
  recipient text,
  account_id uuid,
  description text not null default '',
  status text not null check (status in ('pending', 'scheduled', 'paid', 'cancelled')),
  balance_effect text not null check (balance_effect in ('none', 'deducted', 'historical_no_deduction')),
  include_in_expense_analytics boolean not null default false,
  paid_at timestamptz,
  transaction_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_id),
  foreign key (account_id, user_id) references public.accounts(id, user_id) on delete restrict,
  foreign key (transaction_id, user_id) references public.transactions(id, user_id) on delete restrict
);

create table if not exists public.planned_spending (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  title text not null,
  planned_date date not null,
  expected_amount numeric(14,2) not null default 0 check (expected_amount >= 0),
  maximum_amount numeric(14,2) not null check (maximum_amount > 0),
  category text not null,
  account_id uuid not null,
  notes text not null default '',
  reserve_money boolean not null default false,
  auto_post boolean not null default false,
  reminder boolean not null default false,
  status text not null check (status in ('Upcoming', 'Active', 'Due', 'Pending Reconciliation', 'Completed', 'Exceeded', 'Skipped', 'Cancelled')),
  actual_amount numeric(14,2) check (actual_amount is null or actual_amount >= 0),
  provisional_transaction_id uuid,
  reconciled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_id),
  foreign key (account_id, user_id) references public.accounts(id, user_id) on delete restrict,
  foreign key (provisional_transaction_id, user_id) references public.transactions(id, user_id) on delete restrict,
  check (expected_amount <= maximum_amount)
);

create table if not exists public.reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  account_id uuid not null,
  source_type text not null check (source_type in ('goal', 'budget_schedule', 'planned_spending', 'savings', 'other')),
  source_client_id text not null,
  amount numeric(14,2) not null check (amount > 0),
  reserved_on date not null,
  status text not null default 'active' check (status in ('active', 'released', 'consumed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_id),
  foreign key (account_id, user_id) references public.accounts(id, user_id) on delete restrict
);

create table if not exists public.calendar_notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  note_date date not null,
  title text not null default '',
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_id)
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  type text not null,
  title text not null,
  message text not null,
  related_entity_type text,
  related_client_id text,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (user_id, client_id)
);

create table if not exists public.activity_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null,
  category text not null,
  action text not null,
  entity_type text not null,
  entity_client_id text not null,
  title text not null,
  description text not null default '',
  occurred_on date not null,
  amount numeric(14,2),
  account_id uuid,
  category_name text,
  before_balance numeric(14,2),
  after_balance numeric(14,2),
  created_at timestamptz not null default now(),
  unique (user_id, client_id),
  foreign key (account_id, user_id) references public.accounts(id, user_id) on delete restrict
);

create table if not exists public.migration_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_key text not null,
  content_hash text not null,
  imported_at timestamptz not null default now(),
  record_counts jsonb not null default '{}'::jsonb,
  unique (user_id, source_key)
);

create or replace view public.account_balances
with (security_invoker = true)
as
select
  a.user_id,
  a.id as account_id,
  a.client_id,
  a.name,
  a.opening_balance +
    coalesce((select sum(case when t.entry_type = 'income' then t.amount when t.entry_type = 'expense' then -t.amount else 0 end) from public.transactions t where t.user_id = a.user_id and t.account_id = a.id), 0) +
    coalesce((select sum(case when x.destination_account_id = a.id then x.amount when x.source_account_id = a.id then -x.amount else 0 end) from public.transfers x where x.user_id = a.user_id and (x.source_account_id = a.id or x.destination_account_id = a.id)), 0) +
    coalesce((select sum(b.amount) from public.balance_adjustments b where b.user_id = a.user_id and b.account_id = a.id), 0) as physical_balance,
  coalesce((select sum(r.amount) from public.reservations r where r.user_id = a.user_id and r.account_id = a.id and r.status = 'active'), 0) as reserved_balance,
  a.opening_balance +
    coalesce((select sum(case when t.entry_type = 'income' then t.amount when t.entry_type = 'expense' then -t.amount else 0 end) from public.transactions t where t.user_id = a.user_id and t.account_id = a.id), 0) +
    coalesce((select sum(case when x.destination_account_id = a.id then x.amount when x.source_account_id = a.id then -x.amount else 0 end) from public.transfers x where x.user_id = a.user_id and (x.source_account_id = a.id or x.destination_account_id = a.id)), 0) +
    coalesce((select sum(b.amount) from public.balance_adjustments b where b.user_id = a.user_id and b.account_id = a.id), 0) -
    coalesce((select sum(r.amount) from public.reservations r where r.user_id = a.user_id and r.account_id = a.id and r.status = 'active'), 0) as available_balance,
  a.include_in_total,
  a.archived
from public.accounts a;

create or replace view public.financial_totals
with (security_invoker = true)
as
select
  user_id,
  coalesce(sum(physical_balance) filter (where include_in_total and not archived), 0) as total_money,
  coalesce(sum(reserved_balance) filter (where include_in_total and not archived), 0) as reserved_money,
  coalesce(sum(available_balance) filter (where include_in_total and not archived), 0) as available_to_spend
from public.account_balances
group by user_id;

create index if not exists transactions_user_date_idx on public.transactions(user_id, occurred_on desc);
create index if not exists transfers_user_date_idx on public.transfers(user_id, occurred_on desc);
create index if not exists budget_occurrences_user_date_idx on public.budget_occurrences(user_id, occurrence_date);
create index if not exists calendar_notes_user_date_idx on public.calendar_notes(user_id, note_date);
create index if not exists notifications_user_read_idx on public.notifications(user_id, read_at, created_at desc);
create index if not exists activity_history_user_date_idx on public.activity_history(user_id, occurred_on desc, created_at desc);

grant select on public.account_balances, public.financial_totals to authenticated;
grant select, insert, update, delete on
  public.profiles, public.accounts, public.goals, public.transactions, public.transfers,
  public.balance_adjustments, public.monthly_budgets, public.daily_budgets,
  public.budget_schedules, public.budget_occurrences, public.goal_contributions,
  public.contributions, public.planned_spending, public.reservations,
  public.calendar_notes, public.notifications, public.activity_history, public.migration_batches
to authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'accounts', 'goals', 'transactions', 'transfers', 'balance_adjustments',
    'monthly_budgets', 'daily_budgets', 'budget_schedules', 'budget_occurrences',
    'goal_contributions', 'contributions', 'planned_spending', 'reservations',
    'calendar_notes', 'notifications', 'activity_history', 'migration_batches'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))', table_name || '_select_own', table_name);
    execute format('create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', table_name || '_insert_own', table_name);
    execute format('create policy %I on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', table_name || '_update_own', table_name);
    execute format('create policy %I on public.%I for delete to authenticated using (user_id = (select auth.uid()))', table_name || '_delete_own', table_name);
  end loop;
end;
$$;

create or replace function public.record_transfer(
  p_client_id text,
  p_operation_id text,
  p_source_account_id uuid,
  p_destination_account_id uuid,
  p_amount numeric,
  p_occurred_on date,
  p_note text default ''
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_transfer_id uuid;
  v_source_name text;
  v_destination_name text;
  v_available numeric;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_amount <= 0 or p_source_account_id = p_destination_account_id then raise exception 'Invalid transfer amount or accounts'; end if;
  if exists (select 1 from public.activity_history where user_id = v_user_id and client_id = p_operation_id) then
    select id into v_transfer_id from public.transfers where user_id = v_user_id and client_id = p_client_id;
    return v_transfer_id;
  end if;
  select name into v_source_name from public.accounts where id = p_source_account_id and user_id = v_user_id and not archived;
  select name into v_destination_name from public.accounts where id = p_destination_account_id and user_id = v_user_id and not archived;
  if v_source_name is null or v_destination_name is null then raise exception 'Both accounts must belong to the signed-in user and be active'; end if;
  select available_balance into v_available from public.account_balances where account_id = p_source_account_id and user_id = v_user_id;
  if v_available is null or p_amount > v_available then raise exception 'Insufficient available account balance'; end if;
  insert into public.transfers (user_id, client_id, source_account_id, destination_account_id, amount, occurred_on, note)
  values (v_user_id, p_client_id, p_source_account_id, p_destination_account_id, p_amount, p_occurred_on, coalesce(p_note, ''))
  on conflict (user_id, client_id) do update set source_account_id = excluded.source_account_id, destination_account_id = excluded.destination_account_id, amount = excluded.amount, occurred_on = excluded.occurred_on, note = excluded.note
  returning id into v_transfer_id;
  insert into public.activity_history (user_id, client_id, category, action, entity_type, entity_client_id, title, description, occurred_on, amount, account_id)
  values (v_user_id, p_operation_id, 'transfers', 'created', 'transfer', p_client_id, 'Transfer', v_source_name || ' → ' || v_destination_name || coalesce(' · ' || nullif(p_note, ''), ''), p_occurred_on, p_amount, p_source_account_id)
  on conflict (user_id, client_id) do nothing;
  insert into public.notifications (user_id, client_id, type, title, message, related_entity_type, related_client_id, priority)
  values (v_user_id, p_operation_id, 'transfer', 'Transfer completed', to_char(p_amount, 'FM999,999,990.00') || ' moved from ' || v_source_name || ' to ' || v_destination_name || '.', 'transfer', p_client_id, 'normal')
  on conflict (user_id, client_id) do nothing;
  return v_transfer_id;
end;
$$;

create or replace function public.upsert_transaction(
  p_client_id text,
  p_operation_id text,
  p_account_id uuid,
  p_entry_type text,
  p_amount numeric,
  p_occurred_on date,
  p_category text default null,
  p_description text default '',
  p_income_source text default null,
  p_notes text default '',
  p_saving_type text default null,
  p_saving_mode text default 'transfer',
  p_recurring boolean default false
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_entry_id uuid;
  v_existing public.transactions%rowtype;
  v_account_name text;
  v_available numeric;
  v_action text;
  v_title text;
  v_history_category text;
  v_delta numeric;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_entry_type not in ('income', 'expense', 'saving') or p_amount <= 0 then raise exception 'Invalid transaction'; end if;
  if exists (select 1 from public.activity_history where user_id = v_user_id and client_id = p_operation_id) then
    select id into v_entry_id from public.transactions where user_id = v_user_id and client_id = p_client_id;
    return v_entry_id;
  end if;
  select * into v_existing from public.transactions where user_id = v_user_id and client_id = p_client_id for update;
  if v_existing.related_entity_type is not null and v_existing.related_entity_type <> '' then raise exception 'Linked ledger entries must be changed through their owning financial record'; end if;
  select name into v_account_name from public.accounts where id = p_account_id and user_id = v_user_id and not archived;
  if v_account_name is null then raise exception 'Account does not belong to the signed-in user or is archived'; end if;
  select available_balance into v_available from public.account_balances where user_id = v_user_id and account_id = p_account_id;
  if v_existing.id is not null and v_existing.account_id = p_account_id then
    if v_existing.entry_type = 'expense' or v_existing.entry_type = 'saving' then v_available := v_available + v_existing.amount; end if;
  end if;
  if p_entry_type = 'expense' and p_amount > v_available then raise exception 'Insufficient available account balance'; end if;
  if p_entry_type = 'saving' and p_amount > v_available then raise exception 'Insufficient available account balance for savings classification'; end if;
  v_action := case when v_existing.id is null then 'created' else 'edited' end;
  v_title := case when p_entry_type = 'expense' then p_description when p_entry_type = 'income' then p_income_source else p_saving_type end;
  v_history_category := case when p_entry_type = 'expense' then 'expenses' when p_entry_type = 'income' then 'income' else 'savings' end;
  v_delta := case when p_entry_type = 'expense' then -p_amount when p_entry_type = 'income' then p_amount else 0 end;
  insert into public.transactions (user_id, client_id, account_id, entry_type, amount, occurred_on, category, description, income_source, notes, saving_type, saving_mode, recurring)
  values (v_user_id, p_client_id, p_account_id, p_entry_type, p_amount, p_occurred_on, p_category, coalesce(p_description, ''), p_income_source, coalesce(p_notes, ''), p_saving_type, p_saving_mode, coalesce(p_recurring, false))
  on conflict (user_id, client_id) do update set account_id = excluded.account_id, entry_type = excluded.entry_type, amount = excluded.amount, occurred_on = excluded.occurred_on, category = excluded.category, description = excluded.description, income_source = excluded.income_source, notes = excluded.notes, saving_type = excluded.saving_type, saving_mode = excluded.saving_mode, recurring = excluded.recurring
  returning id into v_entry_id;
  if v_existing.entry_type = 'saving' and p_entry_type <> 'saving' then
    delete from public.reservations where user_id = v_user_id and client_id = 'savings:' || p_client_id;
  end if;
  if p_entry_type = 'saving' then
    insert into public.reservations (user_id, client_id, account_id, source_type, source_client_id, amount, reserved_on, status)
    values (v_user_id, 'savings:' || p_client_id, p_account_id, 'savings', p_client_id, p_amount, p_occurred_on, 'active')
    on conflict (user_id, client_id) do update set account_id = excluded.account_id, amount = excluded.amount, reserved_on = excluded.reserved_on, status = 'active';
  end if;
  insert into public.activity_history (user_id, client_id, category, action, entity_type, entity_client_id, title, description, occurred_on, amount, account_id, category_name)
  values (v_user_id, p_operation_id, v_history_category, v_action, p_entry_type, p_client_id, coalesce(v_title, initcap(p_entry_type)), coalesce(nullif(p_description, ''), nullif(p_income_source, ''), initcap(p_entry_type)), p_occurred_on, v_delta, p_account_id, p_category)
  on conflict (user_id, client_id) do nothing;
  insert into public.notifications (user_id, client_id, type, title, message, related_entity_type, related_client_id, priority)
  values (v_user_id, p_operation_id, p_entry_type, case when p_entry_type = 'expense' then 'Expense recorded' when p_entry_type = 'income' then 'Income received' else 'Savings recorded' end, to_char(p_amount, 'FM999,999,990.00') || ' ' || case when p_entry_type = 'expense' then 'paid from ' when p_entry_type = 'income' then 'added to ' else 'classified at ' end || v_account_name || '.', 'transaction', p_client_id, 'normal')
  on conflict (user_id, client_id) do nothing;
  return v_entry_id;
end;
$$;

create or replace function public.delete_transaction(p_client_id text, p_operation_id text)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_entry public.transactions%rowtype;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if exists (select 1 from public.activity_history where user_id = v_user_id and client_id = p_operation_id) then return true; end if;
  select * into v_entry from public.transactions where user_id = v_user_id and client_id = p_client_id for update;
  if not found then return false; end if;
  if v_entry.related_entity_type is not null and v_entry.related_entity_type <> '' then raise exception 'Linked ledger entries must be reversed through their owning financial record'; end if;
  if v_entry.entry_type = 'saving' then delete from public.reservations where user_id = v_user_id and client_id = 'savings:' || p_client_id; end if;
  delete from public.transactions where id = v_entry.id and user_id = v_user_id;
  insert into public.activity_history (user_id, client_id, category, action, entity_type, entity_client_id, title, description, occurred_on, amount, account_id, category_name)
  values (v_user_id, p_operation_id, case when v_entry.entry_type = 'expense' then 'expenses' when v_entry.entry_type = 'income' then 'income' else 'savings' end, 'deleted/reversed', v_entry.entry_type, p_client_id, coalesce(nullif(v_entry.description, ''), nullif(v_entry.income_source, ''), v_entry.saving_type), 'Transaction removed and account effect reversed', v_entry.occurred_on, case when v_entry.entry_type = 'income' then -v_entry.amount when v_entry.entry_type = 'expense' then v_entry.amount else 0 end, v_entry.account_id, v_entry.category)
  on conflict (user_id, client_id) do nothing;
  insert into public.notifications (user_id, client_id, type, title, message, related_entity_type, related_client_id, priority)
  values (v_user_id, p_operation_id, 'transaction_reversed', 'Transaction removed', coalesce(nullif(v_entry.description, ''), nullif(v_entry.income_source, ''), 'Transaction') || ' was removed and its account effect reversed.', 'transaction', p_client_id, 'normal')
  on conflict (user_id, client_id) do nothing;
  return true;
end;
$$;

create or replace function public.upsert_goal_contribution(
  p_client_id text,
  p_operation_id text,
  p_goal_id uuid,
  p_account_id uuid,
  p_amount numeric,
  p_contribution_type text,
  p_occurred_on date,
  p_notes text default ''
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_goal_name text;
  v_target numeric;
  v_initial numeric;
  v_account_name text;
  v_available numeric;
  v_current numeric;
  v_existing_id uuid;
  v_contribution_id uuid;
  v_transaction_id uuid;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_amount <= 0 or p_contribution_type not in ('reserve', 'paid') then raise exception 'Invalid goal contribution'; end if;
  if exists (select 1 from public.activity_history where user_id = v_user_id and client_id = p_operation_id) then
    select id into v_contribution_id from public.goal_contributions where user_id = v_user_id and client_id = p_client_id;
    return v_contribution_id;
  end if;
  select id into v_existing_id from public.goal_contributions where user_id = v_user_id and client_id = p_client_id for update;
  if v_existing_id is not null then
    update public.goal_contributions set transaction_id = null where user_id = v_user_id and id = v_existing_id;
    delete from public.transactions where user_id = v_user_id and related_entity_type = 'goal_contribution' and related_client_id = p_client_id;
    delete from public.reservations where user_id = v_user_id and source_type = 'goal' and source_client_id = p_client_id;
  end if;
  select name, target_amount, initial_amount into v_goal_name, v_target, v_initial from public.goals where id = p_goal_id and user_id = v_user_id for update;
  if v_goal_name is null then raise exception 'Goal does not belong to the signed-in user'; end if;
  select name into v_account_name from public.accounts where id = p_account_id and user_id = v_user_id and not archived;
  if v_account_name is null then raise exception 'Funding account does not belong to the signed-in user or is archived'; end if;
  select v_initial + coalesce(sum(amount), 0) into v_current from public.goal_contributions where user_id = v_user_id and goal_id = p_goal_id and id is distinct from v_existing_id;
  if v_current + p_amount > v_target then raise exception 'Goal contribution exceeds the remaining target'; end if;
  select available_balance into v_available from public.account_balances where user_id = v_user_id and account_id = p_account_id;
  if v_available is null or p_amount > v_available then raise exception 'Insufficient available account balance'; end if;

  if p_contribution_type = 'paid' then
    insert into public.transactions (user_id, client_id, account_id, entry_type, amount, occurred_on, category, description, related_entity_type, related_client_id)
    values (v_user_id, 'goal-payment:' || p_client_id, p_account_id, 'expense', p_amount, p_occurred_on, 'Investment', 'Goal contribution: ' || v_goal_name, 'goal_contribution', p_client_id)
    on conflict (user_id, client_id) do update set account_id = excluded.account_id, amount = excluded.amount, occurred_on = excluded.occurred_on, description = excluded.description
    returning id into v_transaction_id;
  end if;

  insert into public.goal_contributions (user_id, client_id, goal_id, account_id, amount, contribution_type, occurred_on, notes, transaction_id)
  values (v_user_id, p_client_id, p_goal_id, p_account_id, p_amount, p_contribution_type, p_occurred_on, coalesce(p_notes, ''), v_transaction_id)
  on conflict (user_id, client_id) do update set goal_id = excluded.goal_id, account_id = excluded.account_id, amount = excluded.amount, contribution_type = excluded.contribution_type, occurred_on = excluded.occurred_on, notes = excluded.notes, transaction_id = excluded.transaction_id
  returning id into v_contribution_id;

  if p_contribution_type = 'reserve' then
    insert into public.reservations (user_id, client_id, account_id, source_type, source_client_id, amount, reserved_on, status)
    values (v_user_id, 'goal:' || p_client_id, p_account_id, 'goal', p_client_id, p_amount, p_occurred_on, 'active')
    on conflict (user_id, client_id) do update set account_id = excluded.account_id, amount = excluded.amount, reserved_on = excluded.reserved_on, status = 'active';
  end if;

  insert into public.activity_history (user_id, client_id, category, action, entity_type, entity_client_id, title, description, occurred_on, amount, account_id)
  values (v_user_id, p_operation_id, 'goals', case when v_existing_id is null then 'created' else 'edited' end, 'goal_contribution', p_client_id, v_goal_name, initcap(p_contribution_type) || ' ' || to_char(p_amount, 'FM999,999,990.00') || coalesce(' · ' || nullif(p_notes, ''), ''), p_occurred_on, case when p_contribution_type = 'paid' then -p_amount else p_amount end, p_account_id)
  on conflict (user_id, client_id) do nothing;
  insert into public.notifications (user_id, client_id, type, title, message, related_entity_type, related_client_id, priority)
  values (v_user_id, p_operation_id, 'goal_contribution', case when p_contribution_type = 'reserve' then 'Goal money reserved' else 'Goal contribution paid' end, to_char(p_amount, 'FM999,999,990.00') || ' ' || p_contribution_type || ' for ' || v_goal_name || ' from ' || v_account_name || '.', 'goal_contribution', p_client_id, 'normal')
  on conflict (user_id, client_id) do nothing;
  return v_contribution_id;
end;
$$;

create or replace function public.process_budget_occurrence(p_occurrence_id uuid)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_occurrence public.budget_occurrences%rowtype;
  v_schedule public.budget_schedules%rowtype;
  v_transaction_id uuid;
  v_event text;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  select * into v_occurrence from public.budget_occurrences where id = p_occurrence_id and user_id = v_user_id for update;
  if not found then raise exception 'Budget occurrence not found'; end if;
  if v_occurrence.status not in ('scheduled', 'due') or v_occurrence.occurrence_date > current_date then return v_occurrence.status; end if;
  select * into v_schedule from public.budget_schedules where id = v_occurrence.budget_schedule_id and user_id = v_user_id and status = 'active';
  if not found then
    update public.budget_occurrences set status = 'cancelled', reservation_client_id = null where id = v_occurrence.id and user_id = v_user_id;
    return 'cancelled';
  end if;

  if v_schedule.auto_post then
    insert into public.transactions (user_id, client_id, account_id, entry_type, amount, occurred_on, category, description, related_entity_type, related_client_id, provisional)
    values (v_user_id, 'budget-occurrence:' || v_occurrence.client_id || ':expense', v_schedule.source_account_id, 'expense', v_occurrence.planned_amount, v_occurrence.occurrence_date, v_schedule.category, v_schedule.title, 'budget_occurrence', v_occurrence.client_id, true)
    on conflict (user_id, client_id) do update set amount = excluded.amount, provisional = true
    returning id into v_transaction_id;
    update public.budget_occurrences set status = 'pending_reconciliation', posted_transaction_id = v_transaction_id, reservation_client_id = null where id = v_occurrence.id and user_id = v_user_id;
    update public.reservations set status = 'consumed' where user_id = v_user_id and client_id = v_occurrence.reservation_client_id and status = 'active';
    v_event := 'posted';
    insert into public.notifications (user_id, client_id, type, title, message, related_entity_type, related_client_id, priority)
    values (v_user_id, 'budget-occurrence:' || v_occurrence.client_id || ':posted', 'budget_posted', 'Budget posted', to_char(v_occurrence.planned_amount, 'FM999,999,990.00') || ' was provisionally posted for ' || v_schedule.title || '. Confirm the actual amount.', 'budget_occurrence', v_occurrence.client_id, 'high')
    on conflict (user_id, client_id) do nothing;
  else
    update public.budget_occurrences set status = 'due' where id = v_occurrence.id and user_id = v_user_id;
    v_event := 'due';
    insert into public.notifications (user_id, client_id, type, title, message, related_entity_type, related_client_id, priority)
    values (v_user_id, 'budget-occurrence:' || v_occurrence.client_id || ':due', 'budget_due', 'Budget due today', 'Your ' || to_char(v_occurrence.planned_amount, 'FM999,999,990.00') || ' ' || v_schedule.title || ' budget is due today.', 'budget_occurrence', v_occurrence.client_id, 'normal')
    on conflict (user_id, client_id) do nothing;
  end if;
  insert into public.activity_history (user_id, client_id, category, action, entity_type, entity_client_id, title, description, occurred_on, amount, account_id, category_name)
  values (v_user_id, 'budget-occurrence:' || v_occurrence.client_id || ':' || v_event, 'budgets', v_event, 'budget_occurrence', v_occurrence.client_id, v_schedule.title, 'Scheduled budget occurrence ' || v_event, v_occurrence.occurrence_date, case when v_event = 'posted' then -v_occurrence.planned_amount else v_occurrence.planned_amount end, v_schedule.source_account_id, v_schedule.category)
  on conflict (user_id, client_id) do nothing;
  return case when v_schedule.auto_post then 'pending_reconciliation' else 'due' end;
end;
$$;

create or replace function public.reconcile_budget_occurrence(p_occurrence_id uuid, p_actual_amount numeric, p_operation_id text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_occurrence public.budget_occurrences%rowtype;
  v_schedule public.budget_schedules%rowtype;
  v_transaction_id uuid;
  v_status text;
begin
  if v_user_id is null then raise exception 'Authentication required'; end if;
  if p_actual_amount < 0 then raise exception 'Actual amount cannot be negative'; end if;
  if exists (select 1 from public.activity_history where user_id = v_user_id and client_id = p_operation_id) then
    select status into v_status from public.budget_occurrences where id = p_occurrence_id and user_id = v_user_id;
    return v_status;
  end if;
  select * into v_occurrence from public.budget_occurrences where id = p_occurrence_id and user_id = v_user_id for update;
  if not found or v_occurrence.status not in ('due', 'pending_reconciliation') then raise exception 'Budget occurrence is not ready for reconciliation'; end if;
  select * into v_schedule from public.budget_schedules where id = v_occurrence.budget_schedule_id and user_id = v_user_id;
  if not found then raise exception 'Budget schedule not found'; end if;
  if p_actual_amount > 0 then
    insert into public.transactions (user_id, client_id, account_id, entry_type, amount, occurred_on, category, description, related_entity_type, related_client_id, provisional)
    values (v_user_id, 'budget-occurrence:' || v_occurrence.client_id || ':expense', v_schedule.source_account_id, 'expense', p_actual_amount, v_occurrence.occurrence_date, v_schedule.category, v_schedule.title, 'budget_occurrence', v_occurrence.client_id, false)
    on conflict (user_id, client_id) do update set amount = excluded.amount, provisional = false
    returning id into v_transaction_id;
  else
    update public.budget_occurrences set posted_transaction_id = null where id = v_occurrence.id and user_id = v_user_id;
    delete from public.transactions where user_id = v_user_id and related_entity_type = 'budget_occurrence' and related_client_id = v_occurrence.client_id and provisional;
  end if;
  v_status := case when p_actual_amount > v_occurrence.planned_amount then 'exceeded' else 'completed' end;
  update public.budget_occurrences set status = v_status, actual_amount = p_actual_amount, posted_transaction_id = v_transaction_id, reservation_client_id = null, reconciled_at = now() where id = v_occurrence.id and user_id = v_user_id;
  update public.reservations set status = case when p_actual_amount > 0 then 'consumed' else 'released' end where user_id = v_user_id and client_id = v_occurrence.reservation_client_id;
  insert into public.activity_history (user_id, client_id, category, action, entity_type, entity_client_id, title, description, occurred_on, amount, account_id, category_name)
  values (v_user_id, p_operation_id, 'budgets', 'reconciled', 'budget_occurrence', v_occurrence.client_id, v_schedule.title, 'Actual spending ' || to_char(p_actual_amount, 'FM999,999,990.00') || ' of ' || to_char(v_occurrence.planned_amount, 'FM999,999,990.00') || ' planned', v_occurrence.occurrence_date, -p_actual_amount, v_schedule.source_account_id, v_schedule.category)
  on conflict (user_id, client_id) do nothing;
  insert into public.notifications (user_id, client_id, type, title, message, related_entity_type, related_client_id, priority)
  values (v_user_id, p_operation_id, case when v_status = 'exceeded' then 'budget_exceeded' else 'budget_completed' end, case when v_status = 'exceeded' then 'Budget exceeded' else 'Budget reconciled' end, v_schedule.title || ': ' || to_char(p_actual_amount, 'FM999,999,990.00') || ' actual of ' || to_char(v_occurrence.planned_amount, 'FM999,999,990.00') || ' planned.', 'budget_occurrence', v_occurrence.client_id, case when v_status = 'exceeded' then 'high' else 'normal' end)
  on conflict (user_id, client_id) do nothing;
  return v_status;
end;
$$;

revoke execute on function public.record_transfer(text, text, uuid, uuid, numeric, date, text) from public, anon;
revoke execute on function public.upsert_transaction(text, text, uuid, text, numeric, date, text, text, text, text, text, text, boolean) from public, anon;
revoke execute on function public.delete_transaction(text, text) from public, anon;
revoke execute on function public.upsert_goal_contribution(text, text, uuid, uuid, numeric, text, date, text) from public, anon;
revoke execute on function public.process_budget_occurrence(uuid) from public, anon;
revoke execute on function public.reconcile_budget_occurrence(uuid, numeric, text) from public, anon;

grant execute on function public.record_transfer(text, text, uuid, uuid, numeric, date, text) to authenticated;
grant execute on function public.upsert_transaction(text, text, uuid, text, numeric, date, text, text, text, text, text, text, boolean) to authenticated;
grant execute on function public.delete_transaction(text, text) to authenticated;
grant execute on function public.upsert_goal_contribution(text, text, uuid, uuid, numeric, text, date, text) to authenticated;
grant execute on function public.process_budget_occurrence(uuid) to authenticated;
grant execute on function public.reconcile_budget_occurrence(uuid, numeric, text) to authenticated;

alter table public.profiles enable row level security;
create policy profiles_select_own on public.profiles for select to authenticated using (user_id = (select auth.uid()));
create policy profiles_insert_own on public.profiles for insert to authenticated with check (user_id = (select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy profiles_delete_own on public.profiles for delete to authenticated using (user_id = (select auth.uid()));

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_moneyflow on auth.users;
create trigger on_auth_user_created_moneyflow
  after insert on auth.users
  for each row execute procedure public.handle_new_auth_user();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'accounts', 'goals', 'transactions', 'transfers', 'balance_adjustments',
    'monthly_budgets', 'daily_budgets', 'budget_schedules', 'budget_occurrences',
    'goal_contributions', 'contributions', 'planned_spending', 'reservations', 'calendar_notes'
  ] loop
    execute format('drop trigger if exists set_updated_at on public.%I', table_name);
    execute format('create trigger set_updated_at before update on public.%I for each row execute procedure public.set_updated_at()', table_name);
  end loop;
end;
$$;

notify pgrst, 'reload schema';

commit;