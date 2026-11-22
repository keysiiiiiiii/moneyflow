import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { CloudChange } from '../src/lib/supabase/cloudRows'
import { buildCloudRows, emptyCloudRows, planCloudChanges } from '../src/lib/supabase/cloudRows'
import { parseBackup } from '../src/lib/backup'

const database = new PGlite()
const migration = readFileSync(new URL('../supabase/migrations/20261021000100_moneyflow_v2_initial.sql', import.meta.url), 'utf8')
const syncMigration = readFileSync(new URL('../supabase/migrations/20261022000100_atomic_cloud_sync.sql', import.meta.url), 'utf8')
const profileSyncMigration = readFileSync(new URL('../supabase/migrations/20261103000100_profile_bootstrap_sync.sql', import.meta.url), 'utf8')

beforeAll(async () => {
  await database.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create schema extensions;
    create table auth.users (
      id uuid primary key, aud text, role text, email text,
      encrypted_password text, email_confirmed_at timestamptz,
      created_at timestamptz, updated_at timestamptz
    );
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `)
  await database.exec(migration.replace('create extension if not exists pgcrypto with schema extensions;', ''))
}, 60000)

afterAll(async () => { await database.close() })

describe('Supabase migration using local PostgreSQL with simulated Auth', () => {
  it('creates 18 RLS-protected tables with four owner policies each', async () => {
    const tables = await database.query<{ name: string; rls: boolean }>(`
      select relname as name, relrowsecurity as rls from pg_class
      where relnamespace = 'public'::regnamespace and relkind = 'r'
    `)
    expect(tables.rows).toHaveLength(18)
    expect(tables.rows.every((table) => table.rls)).toBe(true)
    const policies = await database.query('select * from pg_policies where schemaname = \'public\'')
    expect(policies.rows).toHaveLength(72)
  })

  it('passes the Dashboard role-based isolation script', async () => {
    await database.exec(readFileSync(new URL('../supabase/tests/rls_isolation.sql', import.meta.url), 'utf8'))
  })

  it('passes the read-only Dashboard schema inventory', async () => {
    await database.exec(readFileSync(new URL('../supabase/tests/schema_inventory.sql', import.meta.url), 'utf8'))
  })

  it('reserves, pays, edits goals and replays transfers without double deduction', async () => {
    try {
      await database.exec(`
        begin;
        insert into auth.users (id) values ('00000000-0000-4000-8000-0000000000d4');
        insert into public.accounts (id, user_id, client_id, name, kind, opening_balance) values
          ('10000000-0000-4000-8000-0000000000d4', '00000000-0000-4000-8000-0000000000d4', 'cash', 'Cash', 'Cash', 5000),
          ('20000000-0000-4000-8000-0000000000d4', '00000000-0000-4000-8000-0000000000d4', 'bank', 'Bank', 'Cash', 5000);
        insert into public.goals (id, user_id, client_id, name, target_amount, deadline)
        values ('30000000-0000-4000-8000-0000000000d4', '00000000-0000-4000-8000-0000000000d4', 'trip', 'Trip', 5000, current_date + 30);
        set local role authenticated;
        select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000d4', true);
        select public.upsert_goal_contribution('trip-funding', 'reserve-trip', '30000000-0000-4000-8000-0000000000d4', '10000000-0000-4000-8000-0000000000d4', 1000, 'reserve', current_date);
      `)
      const reserved = await database.query<{ physical_balance: string; available_balance: string }>("select physical_balance, available_balance from public.account_balances where client_id = 'cash'")
      expect(Number(reserved.rows[0].physical_balance)).toBe(5000)
      expect(Number(reserved.rows[0].available_balance)).toBe(4000)
      await database.exec(`
        select public.upsert_goal_contribution('trip-funding', 'pay-trip', '30000000-0000-4000-8000-0000000000d4', '10000000-0000-4000-8000-0000000000d4', 1000, 'paid', current_date);
        select public.upsert_goal_contribution('trip-funding', 'edit-trip', '30000000-0000-4000-8000-0000000000d4', '10000000-0000-4000-8000-0000000000d4', 1500, 'paid', current_date);
        select public.record_transfer('move-money', 'move-money-once', '10000000-0000-4000-8000-0000000000d4', '20000000-0000-4000-8000-0000000000d4', 2000, current_date);
        select public.record_transfer('move-money', 'move-money-once', '10000000-0000-4000-8000-0000000000d4', '20000000-0000-4000-8000-0000000000d4', 2000, current_date);
      `)
      const balances = await database.query<{ client_id: string; physical_balance: string }>('select client_id, physical_balance from public.account_balances')
      expect(Number(balances.rows.find((row) => row.client_id === 'cash')?.physical_balance)).toBe(1500)
      expect(Number(balances.rows.find((row) => row.client_id === 'bank')?.physical_balance)).toBe(7000)
      const totals = await database.query<{ total_money: string }>('select total_money from public.financial_totals')
      expect(Number(totals.rows[0].total_money)).toBe(8500)
    } finally { await database.exec('rollback') }
  })

  it('posts only once and reconciles a provisional occurrence to zero', async () => {
    try {
      await database.exec(`
        begin;
        insert into auth.users (id) values ('00000000-0000-4000-8000-0000000000c3');
        insert into public.accounts (id, user_id, client_id, name, kind, opening_balance)
        values ('10000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000c3', 'cash', 'Cash', 'Cash', 5000);
        insert into public.budget_schedules (id, user_id, client_id, title, category, amount, source_account_id, start_date, end_date, reservation_mode, auto_post)
        values ('20000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000c3', 'commute', 'Commute', 'Transportation', 200, '10000000-0000-4000-8000-0000000000c3', current_date, current_date, 'reserve', true);
        insert into public.budget_occurrences (id, user_id, client_id, budget_schedule_id, occurrence_date, planned_amount, reservation_client_id)
        values ('30000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000c3', 'commute-today', '20000000-0000-4000-8000-0000000000c3', current_date, 200, 'reserve-commute');
        insert into public.reservations (user_id, client_id, account_id, source_type, source_client_id, amount, reserved_on)
        values ('00000000-0000-4000-8000-0000000000c3', 'reserve-commute', '10000000-0000-4000-8000-0000000000c3', 'budget_schedule', 'commute-today', 200, current_date);
        set local role authenticated;
        select set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000c3', true);
        select public.process_budget_occurrence('30000000-0000-4000-8000-0000000000c3');
        select public.process_budget_occurrence('30000000-0000-4000-8000-0000000000c3');
      `)
      const posted = await database.query<{ physical_balance: string }>('select physical_balance from public.account_balances')
      expect(Number(posted.rows[0].physical_balance)).toBe(4800)
      await database.exec("select public.reconcile_budget_occurrence('30000000-0000-4000-8000-0000000000c3', 0, 'reconcile-zero')")
      const reconciled = await database.query<{ physical_balance: string; reserved_balance: string }>('select physical_balance, reserved_balance from public.account_balances')
      expect(Number(reconciled.rows[0].physical_balance)).toBe(5000)
      expect(Number(reconciled.rows[0].reserved_balance)).toBe(0)
    } finally { await database.exec('rollback') }
  })
})

describe('atomic cloud synchronization using PostgreSQL', () => {
  const owner = '00000000-0000-4000-8000-0000000000e5'
  const accountId = '10000000-0000-4000-8000-0000000000e5'
  const transactionId = '20000000-0000-4000-8000-0000000000e5'
  let operation = 0
  beforeAll(async () => { await database.exec(syncMigration); await database.exec(profileSyncMigration) })
  async function batch(changes: CloudChange[], operationId = `90000000-0000-4000-8000-${String(++operation).padStart(12, '0')}`) {
    return database.query('select public.apply_finance_changes($1::uuid, $2::jsonb)', [operationId, JSON.stringify(changes)])
  }
  async function begin() {
    await database.exec(`begin; insert into auth.users(id) values ('${owner}'); set local role authenticated; select set_config('request.jwt.claim.sub', '${owner}', true);`)
  }
  const accountRow = { id: accountId, user_id: owner, client_id: 'local-bank', name: 'Bank', kind: 'Cash', opening_balance: 5000 }
  async function storedAccount() {
    return (await database.query<Record<string, unknown>>('select * from public.accounts where client_id = $1', ['local-bank'])).rows[0]
  }

  it('creates stable account mappings, replays once, edits, archives, and reverses an expense', async () => {
    try {
      await begin()
      const accountChange: CloudChange[] = [{ table: 'accounts', key: 'local-bank', before: null, after: accountRow }]
      const retryId = '80000000-0000-4000-8000-000000000001'
      await batch(accountChange, retryId)
      await batch(accountChange, retryId)
      expect((await database.query('select * from public.accounts')).rows).toHaveLength(1)
      const before = await storedAccount()
      await batch([{ table: 'accounts', key: 'local-bank', before, after: { ...accountRow, name: 'Renamed' } }])
      await batch([{ table: 'transactions', key: 'expense', before: null, after: { id: transactionId, user_id: owner, client_id: 'expense', account_id: accountId, entry_type: 'expense', category: 'Food', amount: 100, occurred_on: '2026-10-22' } }])
      expect(Number((await database.query<{ physical_balance: string }>('select physical_balance from public.account_balances')).rows[0].physical_balance)).toBe(4900)
      const expense = (await database.query<Record<string, unknown>>('select * from public.transactions')).rows[0]
      await batch([{ table: 'transactions', key: 'expense', before: expense, after: null }])
      expect(Number((await database.query<{ physical_balance: string }>('select physical_balance from public.account_balances')).rows[0].physical_balance)).toBe(5000)
      await batch([{ table: 'accounts', key: 'local-bank', before: await storedAccount(), after: { ...accountRow, name: 'Renamed', archived: true } }])
      expect((await storedAccount()).archived).toBe(true)
    } finally { await database.exec('rollback') }
  })

  it('rejects stale edits without changing either copy', async () => {
    try {
      await begin()
      await batch([{ table: 'accounts', key: 'local-bank', before: null, after: accountRow }])
      const before = await storedAccount()
      await database.exec("update public.accounts set name = 'Remote edit' where client_id = 'local-bank'; savepoint stale;")
      await expect(batch([{ table: 'accounts', key: 'local-bank', before, after: { ...accountRow, name: 'Stale edit' } }])).rejects.toThrow('Cloud conflict')
      await database.exec('rollback to savepoint stale')
      expect((await storedAccount()).name).toBe('Remote edit')
    } finally { await database.exec('rollback') }
  })

  it('rolls back ledger, history, notifications, and receipt together on insufficient funds', async () => {
    try {
      await begin()
      await batch([{ table: 'accounts', key: 'local-bank', before: null, after: accountRow }])
      await database.exec('savepoint insufficient')
      await expect(batch([
        { table: 'transactions', key: 'bad-expense', before: null, after: { id: transactionId, user_id: owner, client_id: 'bad-expense', account_id: accountId, entry_type: 'expense', category: 'Food', amount: 6000, occurred_on: '2026-10-22' } },
        { table: 'notifications', key: 'bad-event', before: null, after: { id: '30000000-0000-4000-8000-0000000000e5', user_id: owner, client_id: 'bad-event', type: 'expense', title: 'QA', message: 'QA' } },
        { table: 'activity_history', key: 'bad-history', before: null, after: { id: '40000000-0000-4000-8000-0000000000e5', user_id: owner, client_id: 'bad-history', category: 'transactions', action: 'created', entity_type: 'transaction', entity_client_id: 'bad-expense', title: 'QA', description: 'QA', occurred_on: '2026-10-22' } },
      ])).rejects.toThrow('overdraw')
      await database.exec('rollback to savepoint insufficient')
      for (const table of ['transactions', 'notifications', 'activity_history']) expect((await database.query(`select * from public.${table}`)).rows).toHaveLength(0)
      expect((await database.query('select * from public.sync_batches')).rows).toHaveLength(1)
    } finally { await database.exec('rollback') }
  })

  it('rejects cross-owner payloads and anonymous calls', async () => {
    try {
      await begin()
      await database.exec('savepoint owner_check')
      await expect(batch([{ table: 'accounts', key: 'local-bank', before: null, after: { ...accountRow, user_id: '00000000-0000-4000-8000-0000000000f6' } }])).rejects.toThrow('owner')
      await database.exec('rollback to savepoint owner_check; set local role anon;')
      await expect(batch([])).rejects.toThrow('permission denied')
    } finally { await database.exec('rollback') }
  })

  it('maps every V2 cloud collection and applies the complete snapshot atomically', async () => {
    const userId = '00000000-0000-4000-8000-0000000000a7'
    const fixture = JSON.parse(readFileSync(new URL('./fixtures/mobile-backup.json', import.meta.url), 'utf8'))
    const backup = parseBackup({
      ...fixture,
      schemaVersion: 7,
      goalContributions: [{ id: 'qa-goal-reserve', goalId: 'test-goal', amount: 25, accountId: 'test-cash', type: 'reserve', date: '2026-11-04', notes: '', createdAt: '2026-11-03T00:00:00.000Z', updatedAt: '2026-11-03T00:00:00.000Z' }],
      budgetSchedules: [{ id: 'qa-schedule', userId: 'local', title: 'QA schedule', category: 'Bills', amount: 75, sourceAccountId: 'test-cash', startDate: '2026-11-04', endDate: '2026-11-30', weekdays: [1], reservationMode: 'reserve', autoPost: false, status: 'active', createdAt: '2026-11-03T00:00:00.000Z', updatedAt: '2026-11-03T00:00:00.000Z' }],
      budgetOccurrences: [{ id: 'qa-occurrence', budgetScheduleId: 'qa-schedule', date: '2026-11-04', plannedAmount: 75, actualAmount: null, status: 'scheduled', reservationId: 'qa-schedule-reservation' }],
      calendarNotes: [{ id: 'qa-note', userId: 'local', date: '2026-11-04', title: 'QA note', content: 'Persist me', createdAt: '2026-11-03T00:00:00.000Z', updatedAt: '2026-11-03T00:00:00.000Z' }],
      notifications: [{ id: 'qa-notification', userId: 'local', type: 'qa', title: 'QA notification', message: 'Persist me', createdAt: '2026-11-03T00:00:00.000Z', priority: 'normal' }],
      activityHistory: [{ id: 'qa-history', userId: 'local', category: 'accounts', action: 'created', entityType: 'account', entityId: 'test-cash', title: 'Test cash', description: 'Persist me', date: '2026-11-03', createdAt: '2026-11-03T00:00:00.000Z', amount: 1000, accountId: 'test-cash', beforeBalance: 0, afterBalance: 1000 }],
      profile: { displayName: 'QA', preferredName: 'QA', photoDataUrl: '', currency: 'PHP', monthlyIncomeTarget: null, payday: '', weekStartsOn: 1, dateFormat: 'en-PH', theme: 'dark', accent: 'lagoon' },
    })
    const rows = buildCloudRows(backup, userId, emptyCloudRows())
    const changes = planCloudChanges(null, rows, emptyCloudRows())
    try {
      await database.exec(`begin; insert into auth.users(id) values ('${userId}'); set local role authenticated; select set_config('request.jwt.claim.sub', '${userId}', true);`)
      await database.query('select public.apply_finance_changes($1::uuid, $2::jsonb)', ['90000000-0000-4000-8000-0000000000a7', JSON.stringify(changes)])
      const expectedCounts: Record<string, number> = { accounts: 2, goals: 1, budget_schedules: 1, transactions: 3, goal_contributions: 1, budget_occurrences: 1, transfers: 1, balance_adjustments: 1, monthly_budgets: 1, daily_budgets: 1, contributions: 1, planned_spending: 1, reservations: 4, calendar_notes: 1, notifications: 1, activity_history: 1, profiles: 1 }
      for (const [table, count] of Object.entries(expectedCounts)) expect((await database.query(`select * from public.${table}`)).rows).toHaveLength(count)
      const mappings = await database.query<{ transaction_account: string; schedule_account: string; occurrence_schedule: string; goal_account: string; history_account: string }>(`select (select account.client_id from public.transactions tx join public.accounts account on account.id=tx.account_id where tx.client_id='test-income') transaction_account, (select account.client_id from public.budget_schedules schedule join public.accounts account on account.id=schedule.source_account_id where schedule.client_id='qa-schedule') schedule_account, (select schedule.client_id from public.budget_occurrences occurrence join public.budget_schedules schedule on schedule.id=occurrence.budget_schedule_id where occurrence.client_id='qa-occurrence') occurrence_schedule, (select account.client_id from public.goal_contributions funding join public.accounts account on account.id=funding.account_id where funding.client_id='qa-goal-reserve') goal_account, (select account.client_id from public.activity_history history join public.accounts account on account.id=history.account_id where history.client_id='qa-history') history_account`)
      expect(mappings.rows[0]).toEqual({ transaction_account: 'test-cash', schedule_account: 'test-cash', occurrence_schedule: 'qa-schedule', goal_account: 'test-cash', history_account: 'test-cash' })
      const balances = await database.query<{ client_id: string; physical_balance: string; available_balance: string }>('select client_id, physical_balance, available_balance from public.account_balances')
      expect(Number(balances.rows.find((row) => row.client_id === 'test-cash')?.physical_balance)).toBe(1180)
      expect(Number(balances.rows.find((row) => row.client_id === 'test-cash')?.available_balance)).toBe(680)
      expect(Number((await database.query<{ total_money: string }>('select total_money from public.financial_totals')).rows[0].total_money)).toBe(1380)
      const profile = await database.query<{ photo_data_url: string; theme: string; accent: string }>('select photo_data_url, theme, accent from public.profiles')
      expect(profile.rows[0]).toMatchObject({ photo_data_url: '', theme: 'dark', accent: 'lagoon' })
    } finally { await database.exec('rollback') }
  })
})