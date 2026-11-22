import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { GoalContribution, Transaction, Transfer } from '../../types'
import { SupabaseFinanceRepository } from './FinanceRepository'
import { supabase } from './client'
import { createBackup, restoredRecords } from '../backup'
import { useFinanceStore } from '../../store'
import { areFinanceStorageWritesSuppressed, getFinanceStorageKey } from '../storageScope'
import { FinanceSyncQueue, sameBackup, type QueueStatus } from './FinanceSyncQueue'
import { CloudSyncContext, type CloudSyncValue } from './cloudSyncContext'

type CloudMutation =
  | { operationId: string; kind: 'transfer'; value: Transfer }
  | { operationId: string; kind: 'goal_contribution'; value: GoalContribution }
  | { operationId: string; kind: 'transaction'; value: Transaction }
  | { operationId: string; kind: 'delete_transaction'; value: { id: string } }

function queueKey(userId: string) { return `moneyflow-cloud-outbox-${userId}` }

function readQueue(userId: string): CloudMutation[] {
  const value: unknown = JSON.parse(localStorage.getItem(queueKey(userId)) ?? '[]')
  if (!Array.isArray(value)) throw new Error('The legacy sync queue is damaged and was retained for recovery.')
  return value as CloudMutation[]
}

function writeQueue(userId: string, queue: CloudMutation[]) {
  localStorage.setItem(queueKey(userId), JSON.stringify(queue))
}

export function CloudSyncProvider({ userId, children }: { userId: string | null; children: ReactNode }) {
  const repository = useMemo(() => supabase ? new SupabaseFinanceRepository(supabase) : null, [])
  const queue = useMemo(() => userId && repository ? new FinanceSyncQueue(userId, repository, localStorage) : null, [userId, repository])
  const [sync, setSync] = useState<QueueStatus>({ status: userId ? 'pending' : 'synced', pendingCount: 0, error: '' })
  const [retryCount, setRetryCount] = useState(0)

  useEffect(() => {
    if (!userId || !repository || !queue) return
    const activeUserId = userId
    const activeRepository = repository
    const activeQueue = queue
    let active = true
    let applyingRemote = false
    let legacyRunning: Promise<void> | null = null
    let crossTabRehydrate = Promise.resolve()
    const report = (status: QueueStatus) => { if (active) setSync(status) }
    const failure = (error: unknown) => report({ status: 'error', pendingCount: 1, error: error instanceof Error ? error.message : 'Cloud sync failed; local records were retained.' })
    function migrateLegacyQueue() {
      const legacy = readQueue(activeUserId)
      if (!legacy.length) return
      for (const mutation of legacy) {
        const state = useFinanceStore.getState()
        if (mutation.kind === 'transaction') {
          if (!state.transactions.some((entry) => entry.id === mutation.value.id)) state.upsertTransaction(mutation.value)
        } else if (mutation.kind === 'delete_transaction') {
          if (state.transactions.some((entry) => entry.id === mutation.value.id)) state.deleteTransaction(mutation.value.id)
        } else if (mutation.kind === 'transfer') {
          if (!state.transfers.some((entry) => entry.id === mutation.value.id)) state.transferMoney(mutation.value)
          if (!useFinanceStore.getState().transfers.some((entry) => entry.id === mutation.value.id)) throw new Error('A queued transfer could not be restored locally; its legacy outbox entry was retained.')
        } else {
          if (!state.goalContributions.some((entry) => entry.id === mutation.value.id)) {
            const result = state.upsertGoalContribution(mutation.value)
            if (!result.success) throw new Error(`A queued goal contribution could not be restored locally: ${result.message}`)
          }
        }
      }
      activeQueue.initialize(createBackup(useFinanceStore.getState()))
      writeQueue(activeUserId, [])
    }
    async function flush() {
      if (!active) return
      try {
        legacyRunning ??= Promise.resolve().then(migrateLegacyQueue).finally(() => { legacyRunning = null })
        await legacyRunning
        const queued = activeQueue.entries()
        if (navigator.onLine && queued.length) {
          const local = createBackup(useFinanceStore.getState())
          const remote = await activeRepository.loadUserBackup(activeUserId)
          const current = createBackup(useFinanceStore.getState())
          if (sameBackup(local, current) && activeQueue.reconcileSyncedSnapshot(current, remote)) {
            applyingRemote = true
            try { useFinanceStore.setState(restoredRecords(remote, useFinanceStore.getState().profile)) }
            finally { applyingRemote = false }
            report({ status: 'synced', pendingCount: 0, error: '' })
            return
          }
        }
        await activeQueue.flush(navigator.onLine, report, (expected, incoming) => {
          if (!active || !sameBackup(createBackup(useFinanceStore.getState()), expected)) return false
          applyingRemote = true
          try { useFinanceStore.setState(restoredRecords(incoming, useFinanceStore.getState().profile)) }
          finally { applyingRemote = false }
          return true
        })
        const remainingLegacy = readQueue(activeUserId).length
        if (remainingLegacy) report({ status: navigator.onLine ? 'error' : 'pending', pendingCount: activeQueue.entries().length + remainingLegacy, error: navigator.onLine ? 'Legacy queued changes are still waiting to sync.' : '' })
      } catch (error) {
        let pendingCount = 1
        try { pendingCount = activeQueue.entries().length + readQueue(activeUserId).length } catch { pendingCount = Math.max(1, pendingCount) }
        report({ status: 'error', pendingCount, error: error instanceof Error ? error.message : 'Cloud sync failed; local records were retained.' })
      }
    }
    const unsubscribe = useFinanceStore.subscribe((state, previous) => {
      if (!active || applyingRemote || areFinanceStorageWritesSuppressed() || getFinanceStorageKey() !== `moneyflow-data-user-${activeUserId}`) return
      try {
        const before = createBackup(previous)
        const after = createBackup(state)
        if (sameBackup(before, after)) return
        activeQueue.enqueue(before, after)
        report({ status: 'pending', pendingCount: activeQueue.entries().length, error: '' })
        void flush()
      } catch (error) { failure(error) }
    })
    void Promise.resolve().then(() => {
      if (!active) return
      try {
        activeQueue.initialize(createBackup(useFinanceStore.getState()))
        void flush()
      } catch (error) { failure(error) }
    })
    const online = () => { void flush() }
    const storageChanged = (event: StorageEvent) => {
      if (event.key !== `moneyflow-data-user-${activeUserId}` || !event.newValue) return
      applyingRemote = true
      crossTabRehydrate = crossTabRehydrate.then(() => useFinanceStore.persist.rehydrate()).then(() => {
        if (active) void flush()
      }).catch(failure).finally(() => { applyingRemote = false })
    }
    window.addEventListener('online', online)
    window.addEventListener('focus', online)
    window.addEventListener('storage', storageChanged)
    return () => {
      active = false
      unsubscribe()
      window.removeEventListener('online', online)
      window.removeEventListener('focus', online)
      window.removeEventListener('storage', storageChanged)
    }
  }, [userId, repository, queue, retryCount])

  const value = useMemo<CloudSyncValue>(() => ({
    enabled: Boolean(userId && repository),
    ...sync,
    retry: () => setRetryCount((count) => count + 1),
    runMutation: async () => Boolean(userId && repository && !navigator.onLine),
  }), [userId, repository, sync])

  return <CloudSyncContext.Provider value={value}>{children}{sync.error ? <div className="auth-session-error" role="alert"><span>{sync.error}</span><button type="button" className="text-button" onClick={value.retry}>Retry sync</button></div> : null}</CloudSyncContext.Provider>
}