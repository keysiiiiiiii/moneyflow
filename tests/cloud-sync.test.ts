import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Account } from '../src/types'
import type { Database } from '../src/lib/supabase/database.types'
import { fingerprint, SupabaseFinanceRepository } from '../src/lib/supabase/FinanceRepository'
import { parseBackup } from '../src/lib/backup'
import { buildCloudRows, emptyCloudRows, planCloudChanges } from '../src/lib/supabase/cloudRows'
import { FinanceSyncQueue, type QueueStatus, type SyncRepository } from '../src/lib/supabase/FinanceSyncQueue'
import { cloudSyncUserId, recordImportedBackup, recordSkippedImport } from '../src/lib/supabase/migrationState'

const account: Account = { id: 'existing-local-bank', name: 'Test bank', institution: 'BPI', kind: 'Traditional Bank', openingBalance: 5000, includeInTotal: true, archived: false, color: '#3ba7ff', icon: 'bank', nickname: '' }

function accountClient() {
  let row: Record<string, unknown> | null = null
  const insert = vi.fn((value: Record<string, unknown>) => ({ select: () => ({ single: async () => {
    row = { ...value, id: '10000000-0000-4000-8000-000000000001', updated_at: '2026-10-22T00:00:00Z' }
    return { data: row, error: null }
  } }) }))
  const update = vi.fn((value: Record<string, unknown>) => {
    const builder = { eq: () => builder, select: () => ({ maybeSingle: async () => { row = { ...row, ...value }; return { data: row, error: null } } }) }
    return builder
  })
  const from = () => ({ insert, update, select: () => {
    const builder = { eq: () => builder, maybeSingle: async () => ({ data: row, error: null }) }
    return builder
  } })
  return { client: { auth: { getUser: async () => ({ data: { user: { id: 'owner' } }, error: null }) }, from } as unknown as SupabaseClient<Database>, insert, update, getRow: () => row }
}

describe('authenticated account persistence', () => {
  it('creates stable SHA-256 backup fingerprints without Web Crypto subtle support', async () => {
    const value = { fixture: 'synthetic local migration', records: 3 }
    const expected = createHash('sha256').update(JSON.stringify(value)).digest('hex')
    expect(await fingerprint(value)).toBe(expected)
    expect(await fingerprint(value)).toBe(expected)
  })

  it('imports a missing account once with its client ID and opening balance intact', async () => {
    const fixture = accountClient()
    const repository = new SupabaseFinanceRepository(fixture.client)
    const id = await repository.upsertAccount('owner', account)
    expect(await repository.upsertAccount('owner', account)).toBe(id)
    expect(fixture.insert).toHaveBeenCalledOnce()
    expect(fixture.getRow()).toMatchObject({ client_id: account.id, opening_balance: 5000, user_id: 'owner' })
  })

  it('updates and archives only an expected unchanged cloud account', async () => {
    const fixture = accountClient()
    const repository = new SupabaseFinanceRepository(fixture.client)
    await repository.upsertAccount('owner', account)
    await repository.upsertAccount('owner', { ...account, name: 'Renamed', archived: true }, account)
    expect(fixture.update).toHaveBeenCalledOnce()
    expect(fixture.getRow()).toMatchObject({ name: 'Renamed', archived: true, opening_balance: 5000 })
  })

  it('rejects a conflicting import or stale edit without overwriting the cloud copy', async () => {
    const fixture = accountClient()
    const repository = new SupabaseFinanceRepository(fixture.client)
    await repository.upsertAccount('owner', account)
    await expect(repository.upsertAccount('owner', { ...account, openingBalance: 9000 })).rejects.toThrow('Account conflict')
    await expect(repository.upsertAccount('owner', { ...account, name: 'Changed' }, { ...account, name: 'Stale' })).rejects.toThrow('Account conflict')
    expect(fixture.update).not.toHaveBeenCalled()
    expect(fixture.getRow()).toMatchObject({ opening_balance: 5000, name: 'Test bank' })
  })

  it('refuses a mismatched requested owner before touching records', async () => {
    const fixture = accountClient()
    await expect(new SupabaseFinanceRepository(fixture.client).upsertAccount('other-owner', account)).rejects.toThrow('account owner')
    expect(fixture.insert).not.toHaveBeenCalled()
  })
})

function sampleBackup() {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/mobile-backup.json', import.meta.url), 'utf8'))
  return parseBackup({ ...fixture, profile: { displayName: '', preferredName: '', photoDataUrl: '', currency: 'PHP', monthlyIncomeTarget: null, payday: '', weekStartsOn: 1, dateFormat: 'en-PH', theme: 'system', accent: 'ocean' } })
}

function memoryStorage(): Storage {
  const records = new Map<string, string>()
  return { get length() { return records.size }, key: (index) => [...records.keys()][index] ?? null, getItem: (key) => records.get(key) ?? null, setItem: (key, value) => { records.set(key, value) }, removeItem: (key) => { records.delete(key) }, clear: () => records.clear() }
}

describe('canonical cloud entity mapping', () => {
  it('preserves UUID mappings and derives savings/plan reservations without adding physical money', () => {
    const remote = emptyCloudRows()
    remote.accounts = [{ id: '10000000-0000-4000-8000-000000000001', user_id: 'owner', client_id: 'test-cash' }]
    const rows = buildCloudRows(sampleBackup(), 'owner', remote)
    expect(rows.accounts[0]).toMatchObject({ id: remote.accounts[0].id, client_id: 'test-cash', opening_balance: 1000 })
    expect(rows.transactions.every((row) => row.account_id === remote.accounts[0].id)).toBe(true)
    expect(rows.reservations.map((row) => row.source_type).sort()).toEqual(['planned_spending', 'savings'])
    expect(rows.monthly_budgets).toHaveLength(1)
    expect(rows.daily_budgets).toHaveLength(1)
    expect(rows.contributions).toHaveLength(1)
    expect(rows.planned_spending).toHaveLength(1)
    expect(rows.profiles[0]).toMatchObject({ user_id: 'owner', theme: 'system', photo_data_url: '' })
  })

  it('makes repeated imports a no-op and never overwrites conflicting hosted accounts', () => {
    const rows = buildCloudRows(sampleBackup(), 'owner', emptyCloudRows())
    expect(planCloudChanges(null, rows, rows)).toEqual([])
    const changed = structuredClone(rows)
    changed.accounts[0].opening_balance = 9999
    expect(() => planCloudChanges(null, rows, changed)).toThrow('Cloud conflict in accounts')
  })

  it('initializes only a server-generated default profile and rejects customized profile conflicts', () => {
    const backup = sampleBackup()
    backup.profile = { ...backup.profile!, displayName: 'QA profile', theme: 'dark', accent: 'lagoon' }
    const desired = buildCloudRows(backup, 'owner', emptyCloudRows())
    const remote = emptyCloudRows()
    remote.profiles = [{ user_id: 'owner', display_name: '', preferred_name: '', photo_data_url: '', currency: 'PHP', monthly_income_target: null, payday: '', week_starts_on: 1, date_format: 'en-PH', theme: 'system', accent: 'ocean' }]
    const changes = planCloudChanges(null, desired, remote)
    expect(changes.find((change) => change.table === 'profiles')?.before).toEqual(remote.profiles[0])
    remote.profiles[0].display_name = 'Existing cloud name'
    expect(() => planCloudChanges(null, desired, remote)).toThrow('Cloud conflict in profiles')
  })

  it('detects stale edits, preserves unrelated rows, and emits explicit deletion changes', () => {
    const before = buildCloudRows(sampleBackup(), 'owner', emptyCloudRows())
    const after = structuredClone(before)
    after.calendar_notes = [{ id: 'note-uuid', user_id: 'owner', client_id: 'note', note_date: '2026-10-22', content: 'QA', title: '' }]
    after.accounts[0].name = 'Local edit'
    const remote = structuredClone(before)
    remote.accounts[0].name = 'Remote edit'
    expect(() => planCloudChanges(before, after, remote)).toThrow('Cloud conflict')
    after.accounts[0].name = before.accounts[0].name
    after.monthly_budgets = []
    const changes = planCloudChanges(before, after, before)
    expect(changes.map((change) => change.table).sort()).toEqual(['calendar_notes', 'monthly_budgets'])
    expect(changes.find((change) => change.table === 'monthly_budgets')?.after).toBeNull()
  })
})

describe('durable whole-store sync queue', () => {
  function fixture() {
    const backup = sampleBackup()
    const committed = new Set<string>()
    const repository: SyncRepository = {
      prepareSync: vi.fn(async () => []),
      isSyncCommitted: vi.fn(async (_userId, id) => committed.has(id)),
      applySync: vi.fn(async (_userId, id) => { committed.add(id) }),
      loadUserBackup: vi.fn(async () => backup),
    }
    const storage = memoryStorage()
    return { backup, committed, repository, storage, queue: new FinanceSyncQueue('owner', repository, storage) }
  }

  it('retains pending writes offline, restores them after restart, and isolates owners', async () => {
    const { queue, backup, storage, repository } = fixture()
    queue.initialize(backup)
    const report = vi.fn()
    await queue.flush(false, report, vi.fn(() => true))
    expect(report).toHaveBeenLastCalledWith({ status: 'pending', pendingCount: 1, error: '' })
    expect(new FinanceSyncQueue('other-user', repository, storage).entries()).toHaveLength(0)
    const restored = new FinanceSyncQueue('owner', repository, storage)
    await restored.flush(true, report, vi.fn(() => true))
    expect(restored.entries()).toHaveLength(0)
    expect(repository.applySync).toHaveBeenCalledOnce()
  })

  it('uses the durable receipt after a lost response instead of duplicating a committed operation', async () => {
    const { queue, backup, repository, committed } = fixture()
    repository.applySync = vi.fn(async (_owner, id) => { committed.add(id); throw new Error('Network response lost') })
    queue.initialize(backup)
    const report = vi.fn<(status: QueueStatus) => void>()
    await queue.flush(true, report, vi.fn(() => true))
    expect(queue.entries()).toHaveLength(1)
    expect(report.mock.lastCall?.[0].status).toBe('error')
    await queue.flush(true, report, vi.fn(() => true))
    expect(queue.entries()).toHaveLength(0)
    expect(repository.applySync).toHaveBeenCalledOnce()
    expect(repository.prepareSync).toHaveBeenCalledOnce()
  })

  it('keeps writes enqueued while an earlier operation is in flight', async () => {
    const { queue, backup, repository } = fixture()
    const next = structuredClone(backup)
    next.accounts[0].name = 'Second edit'
    let calls = 0
    repository.applySync = vi.fn(async () => { if (++calls === 1) queue.enqueue(backup, next) })
    queue.initialize(backup)
    await queue.flush(true, vi.fn(), vi.fn(() => true))
    expect(repository.applySync).toHaveBeenCalledTimes(2)
    expect(queue.entries()).toHaveLength(0)
  })

  it('does not discard a damaged queue or upload anything from it', async () => {
    const { queue, storage, repository } = fixture()
    storage.setItem('moneyflow-sync-outbox-owner:bad', '{bad json')
    const report = vi.fn<(status: QueueStatus) => void>()
    await queue.flush(true, report, vi.fn(() => true))
    expect(report.mock.lastCall?.[0].status).toBe('error')
    expect(storage.getItem('moneyflow-sync-outbox-owner:bad')).toBe('{bad json')
    expect(repository.applySync).not.toHaveBeenCalled()
  })
})

describe('local-data migration decisions', () => {
  it('seeds the accepted atomic baseline and leaves skipped local data local-only', () => {
    const storage = memoryStorage()
    const backup = sampleBackup()
    storage.setItem('moneyflow-data-user-owner', JSON.stringify({ state: { accounts: backup.accounts } }))
    recordImportedBackup(storage, 'owner', backup)
    expect(JSON.parse(storage.getItem('moneyflow-sync-baseline-owner')!).accounts).toEqual(backup.accounts)
    expect(cloudSyncUserId(storage, 'owner')).toBe('owner')
    recordSkippedImport(storage, 'owner')
    expect(storage.getItem('moneyflow-data-user-owner')).toContain('test-cash')
    expect(cloudSyncUserId(storage, 'owner')).toBeNull()
  })
})

describe('same-origin multi-tab sync safety', () => {
  it('retires net-zero outbox entries only when local, hosted, and acknowledged snapshots match', () => {
    const backup = sampleBackup()
    const intermediate = structuredClone(backup)
    intermediate.accounts[0].nickname = 'temporary tab edit'
    const committed = new Set<string>()
    const repository: SyncRepository = {
      prepareSync: vi.fn(async () => []),
      isSyncCommitted: vi.fn(async (_userId, id) => committed.has(id)),
      applySync: vi.fn(async (_userId, id) => { committed.add(id) }),
      loadUserBackup: vi.fn(async () => backup),
    }
    const storage = memoryStorage()
    storage.setItem('moneyflow-sync-baseline-owner', JSON.stringify(backup))
    const queue = new FinanceSyncQueue('owner', repository, storage)
    queue.enqueue(backup, intermediate)
    queue.enqueue(intermediate, backup)
    expect(queue.entries()).toHaveLength(2)
    expect(queue.reconcileSyncedSnapshot(backup, backup)).toBe(true)
    expect(queue.entries()).toHaveLength(0)
    expect(JSON.parse(storage.getItem('moneyflow-sync-baseline-owner')!)).toEqual(backup)
    expect(repository.applySync).not.toHaveBeenCalled()
    queue.enqueue(backup, intermediate)
    const differentRemote = structuredClone(backup)
    differentRemote.accounts[0].openingBalance += 1
    expect(queue.reconcileSyncedSnapshot(intermediate, differentRemote)).toBe(false)
    expect(queue.entries()).toHaveLength(1)
  })

  it('does not advance the shared baseline or report synced when a stale tab refuses refresh', async () => {
    const backup = sampleBackup()
    const remote = structuredClone(backup)
    remote.accounts[0].nickname = 'remote tab update'
    const repository: SyncRepository = {
      prepareSync: vi.fn(async () => []),
      isSyncCommitted: vi.fn(async () => false),
      applySync: vi.fn(async () => {}),
      loadUserBackup: vi.fn(async () => remote),
    }
    const storage = memoryStorage()
    const queue = new FinanceSyncQueue('owner', repository, storage)
    const originalBaseline = JSON.stringify(backup)
    storage.setItem('moneyflow-sync-baseline-owner', originalBaseline)
    const report = vi.fn<(status: QueueStatus) => void>()
    await queue.flush(true, report, () => false)
    expect(storage.getItem('moneyflow-sync-baseline-owner')).toBe(originalBaseline)
    expect(report.mock.lastCall?.[0]).toMatchObject({ status: 'error', pendingCount: 0 })
    expect(report.mock.lastCall?.[0].error).toMatch(/stale local data from another tab/i)
    expect(repository.applySync).not.toHaveBeenCalled()
  })
})