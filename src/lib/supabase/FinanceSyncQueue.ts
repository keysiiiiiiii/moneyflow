import { parseBackup, type ValidatedBackup } from '../backup'
import { createId } from '../id'
import type { CloudChange } from './cloudRows'

export interface SyncRepository {
  prepareSync(userId: string, before: ValidatedBackup | null, after: ValidatedBackup): Promise<CloudChange[]>
  isSyncCommitted(userId: string, operationId: string): Promise<boolean>
  applySync(userId: string, operationId: string, changes: CloudChange[]): Promise<void>
  loadUserBackup(userId: string): Promise<ValidatedBackup>
}
interface QueueEntry {
  id: string
  sequence: number
  before: ValidatedBackup | null
  after: ValidatedBackup
  changes?: CloudChange[]
}
export interface QueueStatus { status: 'synced' | 'pending' | 'error'; pendingCount: number; error: string }

export function sameBackup(left: ValidatedBackup | null, right: ValidatedBackup): boolean {
  return Boolean(left && JSON.stringify({ ...left, exportedAt: undefined }) === JSON.stringify({ ...right, exportedAt: undefined }))
}

export class FinanceSyncQueue {
  private readonly prefix: string
  private readonly baselineKey: string
  private sequence = 0
  private running: Promise<void> | null = null

  constructor(privateUserId: string, privateRepository: SyncRepository, privateStorage: Storage) {
    this.userId = privateUserId
    this.repository = privateRepository
    this.storage = privateStorage
    this.prefix = `moneyflow-sync-outbox-${privateUserId}:`
    this.baselineKey = `moneyflow-sync-baseline-${privateUserId}`
  }
  private readonly userId: string
  private readonly repository: SyncRepository
  private readonly storage: Storage

  entries(): QueueEntry[] {
    const entries: QueueEntry[] = []
    for (let index = 0; index < this.storage.length; index++) {
      const key = this.storage.key(index)
      if (!key?.startsWith(this.prefix)) continue
      const value = JSON.parse(this.storage.getItem(key) ?? 'null') as QueueEntry | null
      if (!value || typeof value.id !== 'string' || !Number.isFinite(value.sequence) || key !== this.prefix + value.id) throw new Error('A sync outbox entry is damaged. It was retained for recovery; no records were uploaded.')
      entries.push({ ...value, before: value.before ? parseBackup(value.before) : null, after: parseBackup(value.after) })
    }
    return entries.sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id))
  }

  enqueue(before: ValidatedBackup | null, after: ValidatedBackup): void {
    if (sameBackup(before, after)) return
    this.sequence = Math.max(this.sequence + 1, Date.now() * 1000)
    const entry: QueueEntry = { id: createId(), sequence: this.sequence, before, after: parseBackup(after) }
    this.storage.setItem(this.prefix + entry.id, JSON.stringify(entry))
  }

  initialize(snapshot: ValidatedBackup): void {
    const queued = this.entries()
    const rawBaseline = this.storage.getItem(this.baselineKey)
    const baseline = queued.at(-1)?.after ?? (rawBaseline ? parseBackup(JSON.parse(rawBaseline)) : null)
    this.enqueue(baseline, snapshot)
  }

  reconcileSyncedSnapshot(local: ValidatedBackup, remote: ValidatedBackup): boolean {
    if (!sameBackup(local, remote)) return false
    const rawBaseline = this.storage.getItem(this.baselineKey)
    if (!rawBaseline || !sameBackup(parseBackup(JSON.parse(rawBaseline)), local)) return false
    for (const entry of this.entries()) this.storage.removeItem(this.prefix + entry.id)
    this.storage.setItem(this.baselineKey, JSON.stringify(remote))
    return true
  }

  flush(online: boolean, report: (status: QueueStatus) => void, refresh: (expected: ValidatedBackup, incoming: ValidatedBackup) => boolean): Promise<void> {
    if (this.running) return this.running
    this.running = this.drain(online, report, refresh).finally(() => { this.running = null })
    return this.running
  }

  private async drain(online: boolean, report: (status: QueueStatus) => void, refresh: (expected: ValidatedBackup, incoming: ValidatedBackup) => boolean): Promise<void> {
    try {
      let queued = this.entries()
      if (!online) { report({ status: queued.length ? 'pending' : 'synced', pendingCount: queued.length, error: '' }); return }
      let expected: ValidatedBackup | null = null
      while (queued.length) {
        report({ status: 'pending', pendingCount: queued.length, error: '' })
        const entry = queued[0]
        if (!await this.repository.isSyncCommitted(this.userId, entry.id)) {
          if (!entry.changes) {
            entry.changes = await this.repository.prepareSync(this.userId, entry.before, entry.after)
            this.storage.setItem(this.prefix + entry.id, JSON.stringify(entry))
          }
          await this.repository.applySync(this.userId, entry.id, entry.changes)
        }
        expected = entry.after
        this.storage.setItem(this.baselineKey, JSON.stringify(entry.after))
        this.storage.removeItem(this.prefix + entry.id)
        queued = this.entries()
      }
      const rawBaseline = this.storage.getItem(this.baselineKey)
      expected ??= rawBaseline ? parseBackup(JSON.parse(rawBaseline)) : null
      if (expected) {
        const incoming = await this.repository.loadUserBackup(this.userId)
        if (!this.entries().length) {
          if (!refresh(expected, incoming)) {
            report({ status: 'error', pendingCount: 0, error: 'This tab has stale local data from another tab. Reload before continuing to sync.' })
            return
          }
          this.storage.setItem(this.baselineKey, JSON.stringify(incoming))
        }
      }
      const pendingCount = this.entries().length
      if (pendingCount) return this.drain(online, report, refresh)
      report({ status: pendingCount ? 'pending' : 'synced', pendingCount, error: '' })
    } catch (failure) {
      let pendingCount: number
      try { pendingCount = this.entries().length } catch { pendingCount = 1 }
      report({ status: 'error', pendingCount, error: failure instanceof Error ? failure.message : 'Cloud sync failed. The local copy and queue were retained.' })
    }
  }
}