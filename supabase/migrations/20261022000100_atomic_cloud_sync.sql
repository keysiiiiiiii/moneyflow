begin;

alter table public.profiles add column if not exists photo_data_url text not null default '';
alter table public.profiles add constraint profile_photo_size check (octet_length(photo_data_url) <= 700000);

create table public.sync_batches (
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_id uuid not null,
  payload_hash text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, operation_id)
);
alter table public.sync_batches enable row level security;
create policy sync_batches_select on public.sync_batches for select to authenticated using (user_id = auth.uid());
create policy sync_batches_insert on public.sync_batches for insert to authenticated with check (user_id = auth.uid());
grant select, insert on public.sync_batches to authenticated;

create function public.apply_finance_changes(p_operation_id uuid, p_changes jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
<<finance_sync>>
declare
  owner_id uuid := auth.uid();
  change jsonb;
  actual jsonb;
  expected jsonb;
  desired jsonb;
  table_name text;
  key_column text;
  column_names text;
  typed_columns text;
  receipt_hash text;
  allowed_tables text[] := array['accounts','goals','budget_schedules','transactions','goal_contributions','budget_occurrences','transfers','balance_adjustments','monthly_budgets','daily_budgets','contributions','planned_spending','reservations','calendar_notes','notifications','activity_history','profiles'];
begin
  if owner_id is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_operation_id is null or jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) > 20000 or pg_column_size(p_changes) > 16777216 then
    raise exception 'Invalid or oversized sync batch' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(owner_id::text, 0));
  select payload_hash into receipt_hash from public.sync_batches where user_id = owner_id and operation_id = p_operation_id;
  if receipt_hash is not null then
    if receipt_hash <> md5(p_changes::text) then raise exception 'Operation ID reused with a different sync payload' using errcode = '22023'; end if;
    return jsonb_build_object('applied', 0, 'replayed', true);
  end if;
  if exists (select 1 from jsonb_array_elements(p_changes) entry group by entry->>'table', entry->>'key' having count(*) > 1) then
    raise exception 'Duplicate record in sync batch' using errcode = '22023';
  end if;
  perform id from public.accounts where user_id = owner_id order by id for update;
  for change in select value from jsonb_array_elements(p_changes) loop
    table_name := change->>'table';
    if table_name is null or not table_name = any(allowed_tables) then raise exception 'Unsupported sync table' using errcode = '22023'; end if;
    key_column := case when table_name = 'profiles' then 'user_id' else 'client_id' end;
    desired := nullif(change->'after', 'null'::jsonb);
    expected := nullif(change->'before', 'null'::jsonb);
    if desired is null and expected is null then raise exception 'Empty record change' using errcode = '22023'; end if;
    if expected is not null and (expected->>'user_id' is distinct from owner_id::text or expected->>key_column is distinct from change->>'key')
      or desired is not null and (desired->>'user_id' is distinct from owner_id::text or desired->>key_column is distinct from change->>'key') then
      raise exception 'Sync owner or client ID mismatch' using errcode = '42501';
    end if;
    if table_name = 'activity_history' and expected is not null then raise exception 'Activity History is append-only' using errcode = '42501'; end if;
    if table_name = 'profiles' and desired is null then raise exception 'Profile deletion is not a sync operation' using errcode = '42501'; end if;
    execute format('select to_jsonb(record) from public.%I record where user_id = $1 and %I::text = $2 for update', table_name, key_column)
      into actual using owner_id, change->>'key';
    if expected is not null then
      execute format('select to_jsonb(jsonb_populate_record(null::public.%I, $1))', table_name) into expected using expected;
    end if;
    if actual is distinct from expected then raise exception 'Cloud conflict in % (%)', table_name, change->>'key' using errcode = '40001'; end if;
    if actual is not null and desired is not null and table_name <> 'profiles' and actual->>'id' is distinct from desired->>'id' then
      raise exception 'Hosted record UUID cannot change' using errcode = '22023';
    end if;
    if desired is not null and exists (
      select 1 from jsonb_object_keys(desired) field where field = 'updated_at' or not exists (
        select 1 from information_schema.columns col where col.table_schema = 'public' and col.table_name = finance_sync.table_name and col.column_name = field
      )
    ) then raise exception 'Unsupported sync column' using errcode = '22023'; end if;
  end loop;
  foreach table_name in array allowed_tables loop
    key_column := case when table_name = 'profiles' then 'user_id' else 'client_id' end;
    for change in select value from jsonb_array_elements(p_changes) where value->>'table' = table_name and value->'after' <> 'null'::jsonb loop
      desired := change->'after';
      select string_agg(format('%I', field), ', ' order by field), string_agg(format('typed.%I', field), ', ' order by field)
        into column_names, typed_columns from jsonb_object_keys(desired) field;
      if change->'before' = 'null'::jsonb then
        execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1) typed', table_name, column_names, typed_columns, table_name) using desired;
      else
        execute format('update public.%I set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1) typed) where user_id = $2 and %I::text = $3', table_name, column_names, typed_columns, table_name, key_column)
          using desired, owner_id, change->>'key';
      end if;
    end loop;
  end loop;
  for table_name in select entry.name from unnest(allowed_tables) with ordinality as entry(name, position) order by entry.position desc loop
    key_column := case when table_name = 'profiles' then 'user_id' else 'client_id' end;
    for change in select value from jsonb_array_elements(p_changes) where value->>'table' = table_name and value->'after' = 'null'::jsonb loop
      execute format('delete from public.%I where user_id = $1 and %I::text = $2', table_name, key_column) using owner_id, change->>'key';
    end loop;
  end loop;
  if exists (select 1 from public.account_balances where user_id = owner_id and (physical_balance < -0.005 or available_balance < -0.005)) then
    raise exception 'Sync would overdraw physical or available account funds' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.goal_contributions contribution left join public.transactions payment on payment.id = contribution.transaction_id and payment.user_id = owner_id
    where contribution.user_id = owner_id and contribution.contribution_type = 'paid'
      and (payment.id is null or payment.entry_type <> 'expense' or payment.amount <> contribution.amount or payment.account_id <> contribution.account_id)
  ) then raise exception 'Paid goal contribution requires its matching expense' using errcode = '23514'; end if;
  if exists (
    select 1 from public.contributions contribution left join public.transactions payment on payment.id = contribution.transaction_id and payment.user_id = owner_id
    where contribution.user_id = owner_id and contribution.balance_effect = 'deducted'
      and (payment.id is null or payment.entry_type <> 'expense' or payment.amount <> contribution.amount or payment.account_id <> contribution.account_id)
  ) then raise exception 'Paid contribution requires its matching expense' using errcode = '23514'; end if;
  if exists (select 1 from public.goals goal where goal.user_id = owner_id and goal.initial_amount + coalesce((select sum(amount) from public.goal_contributions where goal_id = goal.id and user_id = owner_id), 0) > goal.target_amount + 0.005) then
    raise exception 'Goal contributions exceed the target' using errcode = '23514';
  end if;
  insert into public.sync_batches (user_id, operation_id, payload_hash) values (owner_id, p_operation_id, md5(p_changes::text));
  return jsonb_build_object('applied', jsonb_array_length(p_changes), 'replayed', false);
end;
$$;

revoke all on function public.apply_finance_changes(uuid, jsonb) from public, anon;
grant execute on function public.apply_finance_changes(uuid, jsonb) to authenticated;

commit;