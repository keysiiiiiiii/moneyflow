begin read only;

do $$
declare
  table_name text;
  command_name text;
begin
  foreach table_name in array array[
    'profiles', 'accounts', 'goals', 'transactions', 'transfers', 'balance_adjustments',
    'monthly_budgets', 'daily_budgets', 'budget_schedules', 'budget_occurrences',
    'goal_contributions', 'contributions', 'planned_spending', 'reservations',
    'calendar_notes', 'notifications', 'activity_history', 'migration_batches'
  ] loop
    if not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = table_name and c.relkind = 'r' and c.relrowsecurity
    ) then raise exception 'Missing table or disabled RLS: %', table_name; end if;
    foreach command_name in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
      if not exists (
        select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = table_name
        and p.cmd = command_name and 'authenticated'::name = any(p.roles)
        and (p.qual like '%auth.uid()%' or p.with_check like '%auth.uid()%')
      ) then raise exception 'Missing owner policy: % %', table_name, command_name; end if;
    end loop;
  end loop;
  foreach table_name in array array['account_balances', 'financial_totals'] loop
    if not exists (
      select 1 from pg_class c where c.relnamespace = 'public'::regnamespace
      and c.relname = table_name and c.relkind = 'v' and 'security_invoker=true' = any(c.reloptions)
    ) then raise exception 'Missing security-invoker view: %', table_name; end if;
  end loop;
  foreach table_name in array array[
    'record_transfer', 'upsert_transaction', 'delete_transaction',
    'upsert_goal_contribution', 'process_budget_occurrence', 'reconcile_budget_occurrence'
  ] loop
    if not exists (
      select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = table_name
      and not p.prosecdef and has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and not has_function_privilege('anon', p.oid, 'EXECUTE')
    ) then raise exception 'Missing or incorrectly privileged financial RPC: %', table_name; end if;
  end loop;
  if not exists (
    select 1 from pg_trigger where tgrelid = 'auth.users'::regclass
    and tgname = 'on_auth_user_created_moneyflow' and tgenabled <> 'D'
  ) then raise exception 'Missing Auth profile trigger'; end if;
end;
$$;

select c.relname as table_name, c.relrowsecurity as rls_enabled,
  (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname) as policy_count,
  (select count(*) from pg_constraint k where k.conrelid = c.oid) as constraint_count,
  (select count(*) from pg_index i where i.indrelid = c.oid) as index_count
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
and c.relname in (
  'profiles', 'accounts', 'goals', 'transactions', 'transfers', 'balance_adjustments',
  'monthly_budgets', 'daily_budgets', 'budget_schedules', 'budget_occurrences',
  'goal_contributions', 'contributions', 'planned_spending', 'reservations',
  'calendar_notes', 'notifications', 'activity_history', 'migration_batches'
)
order by c.relname;

select p.proname as function_name, pg_get_function_identity_arguments(p.oid) as arguments,
  p.prosecdef as security_definer
from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (
  'record_transfer', 'upsert_transaction', 'delete_transaction', 'upsert_goal_contribution',
  'process_budget_occurrence', 'reconcile_budget_occurrence', 'set_updated_at', 'handle_new_auth_user'
)
order by p.proname;

select 'MoneyFlow schema inventory passed' as result;
commit;