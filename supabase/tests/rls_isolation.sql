begin;

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-4000-8000-0000000000a1', 'authenticated', 'authenticated', 'moneyflow-rls-a@example.invalid', '', now(), now(), now()),
  ('00000000-0000-4000-8000-0000000000b2', 'authenticated', 'authenticated', 'moneyflow-rls-b@example.invalid', '', now(), now(), now())
on conflict (id) do nothing;

insert into public.accounts (id, user_id, client_id, name, kind, opening_balance, color, icon)
values
  ('10000000-0000-4000-8000-0000000000a1', '00000000-0000-4000-8000-0000000000a1', 'rls-account-a', 'RLS A', 'Cash', 100, '#3ba7ff', 'wallet'),
  ('10000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000b2', 'rls-account-b', 'RLS B', 'Cash', 200, '#3ba7ff', 'wallet')
on conflict (user_id, client_id) do nothing;

insert into public.goals (id, user_id, client_id, name, target_amount, deadline)
values ('20000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000b2', 'rls-goal-b', 'B goal', 1000, current_date + 30)
on conflict (user_id, client_id) do nothing;

insert into public.transactions (user_id, client_id, account_id, entry_type, amount, occurred_on, category, description)
values ('00000000-0000-4000-8000-0000000000b2', 'rls-transaction-b', '10000000-0000-4000-8000-0000000000b2', 'expense', 10, current_date, 'Food', 'B private expense')
on conflict (user_id, client_id) do nothing;

insert into public.budget_schedules (id, user_id, client_id, title, category, amount, source_account_id, start_date, end_date)
values ('30000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000b2', 'rls-schedule-b', 'B schedule', 'Food', 100, '10000000-0000-4000-8000-0000000000b2', current_date, current_date + 1)
on conflict (user_id, client_id) do nothing;

insert into public.budget_occurrences (user_id, client_id, budget_schedule_id, occurrence_date, planned_amount)
values ('00000000-0000-4000-8000-0000000000b2', 'rls-occurrence-b', '30000000-0000-4000-8000-0000000000b2', current_date, 100)
on conflict (user_id, client_id) do nothing;

insert into public.calendar_notes (user_id, client_id, note_date, content)
values ('00000000-0000-4000-8000-0000000000b2', 'rls-note-b', current_date, 'Private note')
on conflict (user_id, client_id) do nothing;

insert into public.notifications (user_id, client_id, type, title, message)
values ('00000000-0000-4000-8000-0000000000b2', 'rls-notification-b', 'expense', 'Private', 'Private notification')
on conflict (user_id, client_id) do nothing;

insert into public.activity_history (user_id, client_id, category, action, entity_type, entity_client_id, title, occurred_on)
values ('00000000-0000-4000-8000-0000000000b2', 'rls-history-b', 'expenses', 'created', 'expense', 'rls-transaction-b', 'Private history', current_date)
on conflict (user_id, client_id) do nothing;

create temporary table moneyflow_rls_fixtures (table_name text, row_data jsonb) on commit drop;
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'accounts', 'goals', 'transactions', 'budget_schedules',
    'budget_occurrences', 'calendar_notes', 'notifications', 'activity_history'
  ] loop
    execute format(
      'insert into moneyflow_rls_fixtures select %L, to_jsonb(candidate) from public.%I candidate where user_id = $1',
      table_name, table_name
    ) using '00000000-0000-4000-8000-0000000000b2'::uuid;
  end loop;
end;
$$;
grant select on moneyflow_rls_fixtures to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-0000000000a1","role":"authenticated"}', true);

do $$
declare
  visible_count integer;
  affected_count integer;
  fixture record;
begin
  if current_user <> 'authenticated' or auth.uid() <> '00000000-0000-4000-8000-0000000000a1'::uuid then
    raise exception 'Isolation test is not running with User A authenticated claims';
  end if;
  for fixture in select * from moneyflow_rls_fixtures loop
    execute format('select count(*) from public.%I where user_id = $1', fixture.table_name)
      into visible_count using '00000000-0000-4000-8000-0000000000b2'::uuid;
    if visible_count <> 0 then raise exception 'Cross-user SELECT allowed on %', fixture.table_name; end if;
    execute format('update public.%I set user_id = user_id where user_id = $1', fixture.table_name)
      using '00000000-0000-4000-8000-0000000000b2'::uuid;
    get diagnostics affected_count = row_count;
    if affected_count <> 0 then raise exception 'Cross-user UPDATE allowed on %', fixture.table_name; end if;
    execute format('delete from public.%I where user_id = $1', fixture.table_name)
      using '00000000-0000-4000-8000-0000000000b2'::uuid;
    get diagnostics affected_count = row_count;
    if affected_count <> 0 then raise exception 'Cross-user DELETE allowed on %', fixture.table_name; end if;
    begin
      execute format('insert into public.%I select * from jsonb_populate_record(null::public.%I, $1)', fixture.table_name, fixture.table_name)
        using fixture.row_data;
      raise exception 'Forged-owner INSERT allowed on %', fixture.table_name;
    exception when insufficient_privilege then
      null;
    end;
  end loop;

  select count(*) into visible_count from public.accounts;
  if visible_count <> 1 then raise exception 'RLS SELECT isolation failed: expected 1 own account, got %', visible_count; end if;
  select count(*) into visible_count from public.goals where client_id = 'rls-goal-b';
  if visible_count <> 0 then raise exception 'RLS goals SELECT isolation failed'; end if;
  select count(*) into visible_count from public.transactions where client_id = 'rls-transaction-b';
  if visible_count <> 0 then raise exception 'RLS transactions SELECT isolation failed'; end if;
  select count(*) into visible_count from public.budget_schedules where client_id = 'rls-schedule-b';
  if visible_count <> 0 then raise exception 'RLS budget schedule SELECT isolation failed'; end if;
  select count(*) into visible_count from public.budget_occurrences where client_id = 'rls-occurrence-b';
  if visible_count <> 0 then raise exception 'RLS budget occurrence SELECT isolation failed'; end if;
  select count(*) into visible_count from public.calendar_notes where client_id = 'rls-note-b';
  if visible_count <> 0 then raise exception 'RLS notes SELECT isolation failed'; end if;
  select count(*) into visible_count from public.notifications where client_id = 'rls-notification-b';
  if visible_count <> 0 then raise exception 'RLS notifications SELECT isolation failed'; end if;
  select count(*) into visible_count from public.activity_history where client_id = 'rls-history-b';
  if visible_count <> 0 then raise exception 'RLS history SELECT isolation failed'; end if;

  update public.accounts set name = 'Hacked' where client_id = 'rls-account-b';
  get diagnostics affected_count = row_count;
  if affected_count <> 0 then raise exception 'RLS UPDATE isolation failed'; end if;

  delete from public.accounts where client_id = 'rls-account-b';
  get diagnostics affected_count = row_count;
  if affected_count <> 0 then raise exception 'RLS DELETE isolation failed'; end if;

  update public.transactions set description = 'Hacked' where client_id = 'rls-transaction-b';
  get diagnostics affected_count = row_count;
  if affected_count <> 0 then raise exception 'RLS transaction UPDATE isolation failed'; end if;

  delete from public.goals where client_id = 'rls-goal-b';
  get diagnostics affected_count = row_count;
  if affected_count <> 0 then raise exception 'RLS goal DELETE isolation failed'; end if;

  begin
    insert into public.accounts (user_id, client_id, name, kind, opening_balance, color, icon)
    values ('00000000-0000-4000-8000-0000000000b2', 'rls-forged-owner', 'Forged', 'Cash', 0, '#3ba7ff', 'wallet');
    raise exception 'RLS INSERT owner forgery was unexpectedly accepted';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.transactions (user_id, client_id, account_id, entry_type, amount, occurred_on, category, description)
    values ('00000000-0000-4000-8000-0000000000b2', 'rls-forged-transaction', '10000000-0000-4000-8000-0000000000b2', 'expense', 1, current_date, 'Food', 'Forged');
    raise exception 'RLS transaction owner forgery was unexpectedly accepted';
  exception when insufficient_privilege then
    null;
  end;

  insert into public.accounts (user_id, client_id, name, kind, opening_balance)
  values (auth.uid(), 'rls-own-crud', 'Own account', 'Cash', 0);
  update public.accounts set name = 'Own account updated' where user_id = auth.uid() and client_id = 'rls-own-crud';
  get diagnostics affected_count = row_count;
  if affected_count <> 1 then raise exception 'Own-account UPDATE failed'; end if;
  delete from public.accounts where user_id = auth.uid() and client_id = 'rls-own-crud';
  get diagnostics affected_count = row_count;
  if affected_count <> 1 then raise exception 'Own-account DELETE failed'; end if;

  begin
    update public.accounts set user_id = '00000000-0000-4000-8000-0000000000b2'
    where client_id = 'rls-account-a';
    raise exception 'Owner reassignment was unexpectedly accepted';
  exception when insufficient_privilege then
    null;
  end;

  begin
    insert into public.transactions (user_id, client_id, account_id, entry_type, amount, occurred_on, category, description)
    values (auth.uid(), 'rls-cross-owner-reference', '10000000-0000-4000-8000-0000000000b2', 'expense', 1, current_date, 'Food', 'Cross-owner account');
    raise exception 'Cross-owner account reference was unexpectedly accepted';
  exception when foreign_key_violation then
    null;
  end;
end;
$$;

select 'MoneyFlow RLS isolation passed; test fixtures will be rolled back' as result;
rollback;