import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createBackup, restoredRecords, type ValidatedBackup } from '../lib/backup'
import { AuthScreen } from './AuthScreen'
import { useAuth } from '../lib/supabase/authContext'
import { isSupabaseConfigured, supabase } from '../lib/supabase/client'
import { SupabaseFinanceRepository } from '../lib/supabase/FinanceRepository'
import { CloudSyncProvider } from '../lib/supabase/CloudSyncProvider'
import { cloudSyncUserId, recordImportedBackup, recordSkippedImport } from '../lib/supabase/migrationState'
import { switchFinanceStorageUser, useFinanceStore } from '../store'

function hasFinanceData(state: ReturnType<typeof useFinanceStore.getState>) {
  return Boolean(state.accounts.length || state.transactions.length || state.budgets.length || state.goals.length || state.contributions.length || state.transfers.length || state.plannedSpending.length)
}

function downloadMigrationBackup(backup: ValidatedBackup) {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `MoneyFlow_Migration_Backup_${new Date().toISOString().slice(0, 10)}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

export function AppGate({ children }: { children: ReactNode }) {
  const { configured, session, loading, error, passwordRecovery, signOut } = useAuth()
  const initializedUser = useRef<string | null>(null)
  const [localBackup, setLocalBackup] = useState<ValidatedBackup | null>(null)
  const [cacheReadyUserId, setCacheReadyUserId] = useState<string | null>(null)
  const [migrationNeeded, setMigrationNeeded] = useState(false)
  const [migrationError, setMigrationError] = useState('')
  const [working, setWorking] = useState(false)
  const userId = session?.user.id

  useEffect(() => {
    if (!configured || !userId) {
      if (initializedUser.current) {
        initializedUser.current = null
        window.location.reload()
      }
      return
    }
    if (initializedUser.current === userId) return
    initializedUser.current = userId
    let active = true
    const current = useFinanceStore.getState()
    const localDataExists = hasFinanceData(current)
    let backupSnapshot: ValidatedBackup | null = null
    let backupError = ''
    try { if (localDataExists) backupSnapshot = createBackup(current) }
    catch (failure) { backupError = failure instanceof Error ? failure.message : 'Local data could not be prepared for migration.' }
    void switchFinanceStorageUser(userId).then(async () => {
      if (!active) return
      setLocalBackup(backupSnapshot)
      setMigrationError(backupError)
      const cached = useFinanceStore.getState()
      const loadCloud = !hasFinanceData(cached) && Boolean(supabase)
      const restore = loadCloud ? new SupabaseFinanceRepository(supabase!).loadUserBackup(userId).then((backup) => {
        if (!active || useFinanceStore.getState() !== cached) return
        useFinanceStore.setState(restoredRecords(backup, useFinanceStore.getState().profile))
      }) : Promise.resolve()
      try { await restore }
      catch (failure) { setMigrationError(failure instanceof Error ? `Cloud data could not be loaded. The local cache is still available: ${failure.message}` : 'Cloud data could not be loaded. The local cache is still available.') }
      if (!active) return
      const marker = localStorage.getItem(`moneyflow-cloud-migration-${userId}`)
      setMigrationNeeded(localDataExists && !marker)
      setCacheReadyUserId(userId)
    }).catch((failure: unknown) => {
      if (!active) return
      initializedUser.current = null
      setMigrationError(failure instanceof Error ? failure.message : 'The account cache could not be opened.')
    })
    return () => { active = false }
  }, [configured, userId])

  if (!isSupabaseConfigured) return <CloudSyncProvider userId={null}>{children}</CloudSyncProvider>
  if (loading || session && cacheReadyUserId !== session.user.id) return <main className="auth-loading" role="status">Restoring secure MoneyFlow session…</main>
  if (session && passwordRecovery) return <AuthScreen />
  if (!session) return <AuthScreen />

  async function importLocalData() {
    if (!localBackup || !supabase || !session) return
    setWorking(true)
    setMigrationError('')
    try {
      downloadMigrationBackup(localBackup)
      const repository = new SupabaseFinanceRepository(supabase)
      await repository.importLocalBackup(session.user.id, localBackup)
      useFinanceStore.setState(restoredRecords(localBackup, useFinanceStore.getState().profile))
      recordImportedBackup(localStorage, session.user.id, localBackup)
      setMigrationNeeded(false)
    } catch (failure) {
      setMigrationError(failure instanceof Error ? failure.message : 'Cloud import failed. Your local data is still preserved; retry safely after resolving the error.')
    } finally { setWorking(false) }
  }

  function continueWithoutImport() {
    if (!session) return
    if (localBackup) useFinanceStore.setState(restoredRecords(localBackup, useFinanceStore.getState().profile))
    recordSkippedImport(localStorage, session.user.id)
    setMigrationNeeded(false)
  }

  if (migrationNeeded) return <main className="migration-screen"><section className="panel migration-panel"><span className="eyebrow">FIRST CLOUD SIGN-IN</span><h1>Existing MoneyFlow data found.</h1><p>Your local copy will remain on this device. Download a backup before importing it to your account.</p>{localBackup ? <><p>{localBackup.accounts.length} accounts · {localBackup.transactions.length} transactions · {localBackup.goals.length} goals · {localBackup.budgetSchedules.length} schedules</p><button className="button primary" disabled={working} onClick={() => void importLocalData()}>{working ? 'Importing…' : 'Import to my account'}</button><button className="button secondary" disabled={working} onClick={continueWithoutImport}>Create cloud account without importing</button><button className="text-button" disabled={working} onClick={() => void signOut()}>Keep local only</button></> : <button className="button secondary" onClick={() => void signOut()}>Keep local only and review backup</button>}{migrationError ? <p className="form-error" role="alert">{migrationError}</p> : null}</section></main>

  return <CloudSyncProvider userId={cloudSyncUserId(localStorage, session.user.id)}><><div className="auth-session-bar"><span>Signed in as {session.user.email}</span><button className="text-button" onClick={() => void signOut()}>Sign out</button></div>{error ? <p className="auth-session-error" role="alert">{error}</p> : null}{migrationError ? <p className="auth-session-error" role="alert">{migrationError}</p> : null}{children}</></CloudSyncProvider>
}