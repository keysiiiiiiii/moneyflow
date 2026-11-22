import type { SupabaseClient } from '@supabase/supabase-js'
import { sha256 } from '@noble/hashes/sha2.js'
import { createBackup, parseBackup, type ValidatedBackup } from '../backup'
import { createId } from '../id'
import type { Account, FinanceState, Transaction } from '../../types'
import type { Database } from './database.types'
import { buildCloudRows, cloudTables, emptyCloudRows, planCloudChanges, type CloudChange, type CloudRows } from './cloudRows'

type EntityTable = Exclude<keyof Database['public']['Tables'], 'profiles' | 'migration_batches' | 'sync_batches'>
type DbRow = Record<string, unknown>

function readString(row: DbRow, key: string, fallback = ''): string {
  return typeof row[key] === 'string' ? row[key] as string : fallback
}

function readNumber(row: DbRow, key: string, fallback = 0): number {
  return typeof row[key] === 'number' ? row[key] as number : Number(row[key] ?? fallback)
}

function readBoolean(row: DbRow, key: string, fallback = false): boolean {
  return typeof row[key] === 'boolean' ? row[key] as boolean : fallback
}

async function fetchRows(client: SupabaseClient<Database>, table: EntityTable, userId: string): Promise<DbRow[]> {
  const rows: DbRow[] = []
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await client.from(table).select('*').eq('user_id', userId).order('id').range(offset, offset + 499)
    if (error) throw error
    rows.push(...(data ?? []) as DbRow[])
    if (!data || data.length < 500) return rows
  }
}

export interface ImportResult {
  alreadyImported: boolean
  contentHash: string
  importedCounts: Record<string, number>
}

export async function fingerprint(value: unknown): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify(value))
  return Array.from(sha256(data), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function readIdMap(client: SupabaseClient<Database>, table: 'accounts' | 'goals' | 'budget_schedules' | 'budget_occurrences' | 'transactions', userId: string) {
  const { data, error } = await client.from(table).select('id,client_id').eq('user_id', userId)
  if (error) throw error
  return new Map((data ?? []).map((row) => [row.client_id, row.id]))
}

/** Imports a validated local backup without deleting or replacing its LocalStorage copy. */
export class SupabaseFinanceRepository {
  private readonly client: SupabaseClient<Database>

  constructor(client: SupabaseClient<Database>) { this.client = client }

  private async assertOwner(userId: string) {
    const { data, error } = await this.client.auth.getUser()
    if (error) throw error
    if (data.user?.id !== userId) throw new Error('The active user does not match the requested sync owner.')
  }

  async readCloudRows(userId: string): Promise<CloudRows> {
    await this.assertOwner(userId)
    const result = emptyCloudRows()
    await Promise.all(cloudTables.map(async (table) => {
      if (table !== 'profiles') result[table] = await fetchRows(this.client, table, userId)
      else {
        const { data, error } = await this.client.from('profiles').select('*').eq('user_id', userId).maybeSingle()
        if (error) throw error
        result.profiles = data ? [data] : []
      }
    }))
    return result
  }

  async prepareSync(userId: string, before: ValidatedBackup | null, after: ValidatedBackup): Promise<CloudChange[]> {
    const remote = await this.readCloudRows(userId)
    const previous = before ? buildCloudRows(parseBackup(before), userId, remote) : null
    const identities = emptyCloudRows()
    for (const table of cloudTables) identities[table] = [...remote[table], ...(previous?.[table] ?? [])]
    return planCloudChanges(previous, buildCloudRows(parseBackup(after), userId, identities), remote)
  }

  async isSyncCommitted(userId: string, operationId: string): Promise<boolean> {
    await this.assertOwner(userId)
    const { data, error } = await this.client.from('sync_batches').select('operation_id').eq('user_id', userId).eq('operation_id', operationId).maybeSingle()
    if (error) throw new Error(`Atomic cloud sync is unavailable. Deploy migration 20261022000100_atomic_cloud_sync.sql before retrying. ${error.message}`)
    return Boolean(data)
  }

  async applySync(userId: string, operationId: string, changes: CloudChange[]): Promise<void> {
    await this.assertOwner(userId)
    const { error } = await this.client.rpc('apply_finance_changes', { p_operation_id: operationId, p_changes: changes })
    if (error) throw new Error(`Cloud sync failed; the local copy and outbox were retained: ${error.message}`)
  }

  async synchronizeBackup(userId: string, before: ValidatedBackup | null, after: ValidatedBackup, operationId = createId()): Promise<void> {
    if (await this.isSyncCommitted(userId, operationId)) return
    await this.applySync(userId, operationId, await this.prepareSync(userId, before, after))
  }

  async upsertAccount(userId: string, account: Account, expected?: Account): Promise<string> {
    const { data: authData, error: authError } = await this.client.auth.getUser()
    if (authError) throw authError
    if (authData.user?.id !== userId) throw new Error('The active user does not match the account owner.')
    const fields = (value: Account) => ({ user_id: userId, client_id: value.id, name: value.name, institution: value.institution, kind: value.kind, opening_balance: value.openingBalance, include_in_total: value.includeInTotal, archived: value.archived, color: value.color, icon: value.icon, nickname: value.nickname })
    const desired = fields(account)
    const matches = (row: Record<string, unknown>, value: Account) => Object.entries(fields(value)).every(([key, field]) => row[key] === field)
    const read = () => this.client.from('accounts').select('*').eq('user_id', userId).eq('client_id', account.id).maybeSingle()
    const initial = await read()
    if (initial.error) throw initial.error
    let existing = initial.data
    if (!existing) {
      const inserted = await this.client.from('accounts').insert(desired).select('*').single()
      if (!inserted.error) return inserted.data.id
      if (inserted.error.code !== '23505') throw inserted.error
      const raced = await read()
      if (raced.error) throw raced.error
      existing = raced.data
    }
    if (!existing) throw new Error('The cloud account could not be verified.')
    if (matches(existing, account)) return existing.id
    if (!expected || !matches(existing, expected)) throw new Error('Account conflict: the cloud account differs from the expected local version. Neither copy was overwritten.')
    const updated = await this.client.from('accounts').update(desired).eq('user_id', userId).eq('client_id', account.id).eq('updated_at', readString(existing, 'updated_at')).select('id').maybeSingle()
    if (updated.error) throw updated.error
    if (!updated.data) throw new Error('Account conflict: the cloud account changed during this edit. Refresh and review both versions.')
    return updated.data.id
  }

  async importLocalBackup(userId: string, rawBackup: ValidatedBackup, sourceKey = 'moneyflow-local-v1'): Promise<ImportResult> {
    const backup = parseBackup(rawBackup)
    const { data: authData, error: authError } = await this.client.auth.getUser()
    if (authError) throw authError
    if (!authData.user || authData.user.id !== userId) throw new Error('The active Supabase user does not match the requested migration owner.')

    const contentHash = await fingerprint({ ...backup, exportedAt: undefined })
    const { data: priorBatch, error: batchReadError } = await this.client.from('migration_batches').select('content_hash,record_counts').eq('user_id', userId).eq('source_key', sourceKey).maybeSingle()
    if (batchReadError) throw batchReadError
    if (priorBatch?.content_hash === contentHash) return { alreadyImported: true, contentHash, importedCounts: priorBatch.record_counts as Record<string, number> }
    if (priorBatch) throw new Error('A different local dataset was already imported for this migration source. No cloud records were changed; use the current cloud data or start an explicitly reviewed migration source.')

    await this.synchronizeBackup(userId, null, backup)
    const importedCounts = {
      accounts: backup.accounts.length,
      transactions: backup.transactions.length,
      transfers: backup.transfers.length,
      goals: backup.goals.length,
      goalContributions: backup.goalContributions.length,
      schedules: backup.budgetSchedules.length,
      occurrences: backup.budgetOccurrences.length,
      notes: backup.calendarNotes.length,
      notifications: backup.notifications.length,
      history: backup.activityHistory.length,
    }
    const { error: batchWriteError } = await this.client.from('migration_batches').upsert({ user_id: userId, source_key: sourceKey, content_hash: contentHash, record_counts: importedCounts }, { onConflict: 'user_id,source_key' })
    if (batchWriteError) throw batchWriteError
    return { alreadyImported: false, contentHash, importedCounts }
  }

  async importCurrentLocalState(userId: string, state: FinanceState, sourceKey?: string) {
    return this.importLocalBackup(userId, createBackup(state), sourceKey)
  }

  async loadUserBackup(userId: string): Promise<ValidatedBackup> {
    const { data: authData, error: authError } = await this.client.auth.getUser()
    if (authError) throw authError
    if (!authData.user || authData.user.id !== userId) throw new Error('The active Supabase user does not match the requested data owner.')
    const [accountRows, goalRows, transactionRows, transferRows, adjustmentRows, monthlyRows, dailyRows, scheduleRows, occurrenceRows, goalContributionRows, contributionRows, planRows, noteRows, notificationRows, historyRows] = await Promise.all([
      fetchRows(this.client, 'accounts', userId), fetchRows(this.client, 'goals', userId), fetchRows(this.client, 'transactions', userId),
      fetchRows(this.client, 'transfers', userId), fetchRows(this.client, 'balance_adjustments', userId), fetchRows(this.client, 'monthly_budgets', userId),
      fetchRows(this.client, 'daily_budgets', userId), fetchRows(this.client, 'budget_schedules', userId), fetchRows(this.client, 'budget_occurrences', userId),
      fetchRows(this.client, 'goal_contributions', userId), fetchRows(this.client, 'contributions', userId), fetchRows(this.client, 'planned_spending', userId),
      fetchRows(this.client, 'calendar_notes', userId), fetchRows(this.client, 'notifications', userId), fetchRows(this.client, 'activity_history', userId),
    ])
    const { data: profileRow, error: profileError } = await this.client.from('profiles').select('*').eq('user_id', userId).maybeSingle()
    if (profileError) throw profileError

    const accountIds = new Map(accountRows.map((row) => [readString(row, 'id'), readString(row, 'client_id')]))
    const goalIds = new Map(goalRows.map((row) => [readString(row, 'id'), readString(row, 'client_id')]))
    const scheduleIds = new Map(scheduleRows.map((row) => [readString(row, 'id'), readString(row, 'client_id')]))
    const transactionIds = new Map(transactionRows.map((row) => [readString(row, 'id'), readString(row, 'client_id')]))
    const goalContributionTotals = new Map<string, number>()
    for (const row of goalContributionRows) {
      const localGoalId = goalIds.get(readString(row, 'goal_id'))
      if (localGoalId) goalContributionTotals.set(localGoalId, (goalContributionTotals.get(localGoalId) ?? 0) + readNumber(row, 'amount'))
    }

    const accounts = accountRows.map((row) => ({ id: readString(row, 'client_id'), name: readString(row, 'name'), institution: readString(row, 'institution'), kind: readString(row, 'kind'), openingBalance: readNumber(row, 'opening_balance'), includeInTotal: readBoolean(row, 'include_in_total', true), archived: readBoolean(row, 'archived'), color: readString(row, 'color', '#3ba7ff'), icon: readString(row, 'icon', 'wallet'), nickname: readString(row, 'nickname') }))
    const goals = goalRows.map((row) => { const id = readString(row, 'client_id'); return { id, name: readString(row, 'name'), targetAmount: readNumber(row, 'target_amount'), currentAmount: readNumber(row, 'initial_amount') + (goalContributionTotals.get(id) ?? 0), deadline: readString(row, 'deadline'), color: readString(row, 'color', 'blue') } })
    const transactions = transactionRows.map((row) => {
      const common = { id: readString(row, 'client_id'), amount: readNumber(row, 'amount'), date: readString(row, 'occurred_on'), accountId: accountIds.get(readString(row, 'account_id')) }
      const type = readString(row, 'entry_type')
      if (type === 'income') return { ...common, type, source: readString(row, 'income_source'), notes: readString(row, 'notes') }
      if (type === 'saving') return { ...common, type, savingType: readString(row, 'saving_type'), mode: readString(row, 'saving_mode', 'transfer') }
      const relatedType = readString(row, 'related_entity_type')
      const relatedClientId = readString(row, 'related_client_id')
      return { ...common, type: 'expense', category: readString(row, 'category'), description: readString(row, 'description'), recurring: readBoolean(row, 'recurring'), provisional: readBoolean(row, 'provisional'), ...(relatedType === 'goal_contribution' ? { goalContributionId: relatedClientId } : {}), ...(relatedType === 'budget_occurrence' ? { budgetOccurrenceId: relatedClientId } : {}), ...(relatedType === 'contribution' ? { contributionId: relatedClientId } : {}), ...(relatedType === 'planned_spending' ? { autoPlanId: relatedClientId } : {}) }
    })
    const budgetSchedules = scheduleRows.map((row) => ({ id: readString(row, 'client_id'), userId, title: readString(row, 'title'), category: readString(row, 'category'), amount: readNumber(row, 'amount'), sourceAccountId: accountIds.get(readString(row, 'source_account_id')) ?? '', startDate: readString(row, 'start_date'), endDate: readString(row, 'end_date'), weekdays: Array.isArray(row.weekdays) ? row.weekdays as number[] : [], reservationMode: readString(row, 'reservation_mode', 'none'), autoPost: readBoolean(row, 'auto_post'), status: readString(row, 'status', 'active'), createdAt: readString(row, 'created_at'), updatedAt: readString(row, 'updated_at') }))
    const budgetOccurrences = occurrenceRows.map((row) => ({ id: readString(row, 'client_id'), budgetScheduleId: scheduleIds.get(readString(row, 'budget_schedule_id')) ?? '', date: readString(row, 'occurrence_date'), plannedAmount: readNumber(row, 'planned_amount'), actualAmount: row.actual_amount === null ? null : readNumber(row, 'actual_amount'), status: readString(row, 'status', 'scheduled'), reservationId: typeof row.reservation_client_id === 'string' ? row.reservation_client_id : undefined, postedTransactionId: transactionIds.get(readString(row, 'posted_transaction_id')), reconciledAt: typeof row.reconciled_at === 'string' ? row.reconciled_at : undefined }))
    const goalContributions = goalContributionRows.map((row) => ({ id: readString(row, 'client_id'), goalId: goalIds.get(readString(row, 'goal_id')) ?? '', amount: readNumber(row, 'amount'), accountId: accountIds.get(readString(row, 'account_id')) ?? '', type: readString(row, 'contribution_type'), date: readString(row, 'occurred_on'), notes: readString(row, 'notes'), transactionId: transactionIds.get(readString(row, 'transaction_id')), createdAt: readString(row, 'created_at'), updatedAt: readString(row, 'updated_at') }))
    const backup = {
      schemaVersion: 7,
      exportedAt: new Date().toISOString(),
      accounts,
      goals,
      transactions,
      budgets: monthlyRows.map((row) => ({ id: readString(row, 'client_id'), category: readString(row, 'category'), amount: readNumber(row, 'amount'), month: readString(row, 'month').slice(0, 7) })),
      dailyBudgets: dailyRows.map((row) => ({ date: readString(row, 'budget_date'), amount: readNumber(row, 'amount') })),
      goalContributions,
      budgetSchedules,
      budgetOccurrences,
      transfers: transferRows.map((row) => ({ id: readString(row, 'client_id'), sourceAccountId: accountIds.get(readString(row, 'source_account_id')) ?? '', destinationAccountId: accountIds.get(readString(row, 'destination_account_id')) ?? '', amount: readNumber(row, 'amount'), date: readString(row, 'occurred_on'), note: readString(row, 'note') })),
      balanceAdjustments: adjustmentRows.map((row) => ({ id: readString(row, 'client_id'), accountId: accountIds.get(readString(row, 'account_id')) ?? '', amount: readNumber(row, 'amount'), date: readString(row, 'occurred_on'), note: readString(row, 'note') })),
      contributions: contributionRows.map((row) => ({ id: readString(row, 'client_id'), title: readString(row, 'title'), category: readString(row, 'category'), amount: readNumber(row, 'amount'), date: readString(row, 'occurred_on'), contributionDate: readString(row, 'occurred_on'), recipient: readString(row, 'recipient'), accountId: accountIds.get(readString(row, 'account_id')), sourceAccountId: accountIds.get(readString(row, 'account_id')), description: readString(row, 'description'), status: readString(row, 'status'), balanceEffect: readString(row, 'balance_effect'), includeInExpenseAnalytics: readBoolean(row, 'include_in_expense_analytics'), paidAt: typeof row.paid_at === 'string' ? row.paid_at : undefined, transactionId: transactionIds.get(readString(row, 'transaction_id')), createdAt: readString(row, 'created_at'), updatedAt: readString(row, 'updated_at') })),
      plannedSpending: planRows.map((row) => ({ id: readString(row, 'client_id'), title: readString(row, 'title'), date: readString(row, 'planned_date'), expectedAmount: readNumber(row, 'expected_amount'), maximumAmount: readNumber(row, 'maximum_amount'), category: readString(row, 'category'), accountId: accountIds.get(readString(row, 'account_id')) ?? '', notes: readString(row, 'notes'), reserveMoney: readBoolean(row, 'reserve_money'), autoPost: readBoolean(row, 'auto_post'), reminder: readBoolean(row, 'reminder'), status: readString(row, 'status'), actualAmount: row.actual_amount === null ? null : readNumber(row, 'actual_amount'), provisionalTransactionId: transactionIds.get(readString(row, 'provisional_transaction_id')), reconciledAt: typeof row.reconciled_at === 'string' ? row.reconciled_at : undefined })),
      calendarNotes: noteRows.map((row) => ({ id: readString(row, 'client_id'), userId, date: readString(row, 'note_date'), title: readString(row, 'title'), content: readString(row, 'content'), createdAt: readString(row, 'created_at'), updatedAt: readString(row, 'updated_at') })),
      notifications: notificationRows.map((row) => ({ id: readString(row, 'client_id'), userId, type: readString(row, 'type'), title: readString(row, 'title'), message: readString(row, 'message'), relatedEntityType: readString(row, 'related_entity_type') || undefined, relatedEntityId: readString(row, 'related_client_id') || undefined, createdAt: readString(row, 'created_at'), readAt: typeof row.read_at === 'string' ? row.read_at : undefined, priority: readString(row, 'priority', 'normal') })),
      activityHistory: historyRows.map((row) => ({ id: readString(row, 'client_id'), userId, category: readString(row, 'category'), action: readString(row, 'action'), entityType: readString(row, 'entity_type'), entityId: readString(row, 'entity_client_id'), title: readString(row, 'title'), description: readString(row, 'description'), date: readString(row, 'occurred_on'), createdAt: readString(row, 'created_at'), amount: typeof row.amount === 'number' ? row.amount : undefined, accountId: accountIds.get(readString(row, 'account_id')), categoryName: readString(row, 'category_name') || undefined, beforeBalance: typeof row.before_balance === 'number' ? row.before_balance : undefined, afterBalance: typeof row.after_balance === 'number' ? row.after_balance : undefined })),
      profile: profileRow ? { displayName: readString(profileRow, 'display_name'), preferredName: readString(profileRow, 'preferred_name'), photoDataUrl: readString(profileRow, 'photo_data_url'), currency: 'PHP', monthlyIncomeTarget: typeof profileRow.monthly_income_target === 'number' ? profileRow.monthly_income_target : null, payday: readString(profileRow, 'payday'), weekStartsOn: readNumber(profileRow, 'week_starts_on', 1), dateFormat: readString(profileRow, 'date_format', 'en-PH'), theme: readString(profileRow, 'theme', 'system'), accent: readString(profileRow, 'accent', 'ocean') } : { displayName: '', preferredName: '', photoDataUrl: '', currency: 'PHP', monthlyIncomeTarget: null, payday: '', weekStartsOn: 1, dateFormat: 'en-PH' },
      migrationReport: [],
    }
    return parseBackup(backup)
  }

  async recordTransfer(userId: string, input: { id: string; sourceAccountId: string; destinationAccountId: string; amount: number; date: string; note: string }, operationId: string = createId()) {
    const accountIds = await readIdMap(this.client, 'accounts', userId)
    const sourceAccountId = accountIds.get(input.sourceAccountId)
    const destinationAccountId = accountIds.get(input.destinationAccountId)
    if (!sourceAccountId || !destinationAccountId) throw new Error("Transfer account is not present in this user's cloud records.")
    const { data, error } = await this.client.rpc('record_transfer', { p_client_id: input.id, p_operation_id: operationId, p_source_account_id: sourceAccountId, p_destination_account_id: destinationAccountId, p_amount: input.amount, p_occurred_on: input.date, p_note: input.note })
    if (error) throw error
    return data
  }

  async upsertTransaction(userId: string, entry: Transaction, operationId: string = createId()) {
    if (!entry.accountId) throw new Error('A cloud transaction requires a funding account.')
    const accountIds = await readIdMap(this.client, 'accounts', userId)
    const accountId = accountIds.get(entry.accountId)
    if (!accountId) throw new Error("Transaction account is not present in this user's cloud records.")
    const values = entry.type === 'income'
      ? { p_income_source: entry.source, p_notes: entry.notes }
      : entry.type === 'saving'
        ? { p_saving_type: entry.savingType, p_saving_mode: entry.mode ?? 'transfer' }
        : { p_category: entry.category, p_description: entry.description, p_recurring: entry.recurring ?? false }
    const { data, error } = await this.client.rpc('upsert_transaction', { p_client_id: entry.id, p_operation_id: operationId, p_account_id: accountId, p_entry_type: entry.type, p_amount: entry.amount, p_occurred_on: entry.date, ...values })
    if (error) throw error
    return data
  }

  async deleteTransaction(userId: string, clientId: string, operationId: string = createId()) {
    const { data: authData, error: authError } = await this.client.auth.getUser()
    if (authError) throw authError
    if (!authData.user || authData.user.id !== userId) throw new Error('The active Supabase user does not match the requested transaction owner.')
    const { data, error } = await this.client.rpc('delete_transaction', { p_client_id: clientId, p_operation_id: operationId })
    if (error) throw error
    return data
  }

  async upsertGoalContribution(userId: string, input: { id: string; goalId: string; accountId: string; amount: number; type: 'reserve' | 'paid'; date: string; notes: string }, operationId: string = createId()) {
    const [goalIds, accountIds] = await Promise.all([readIdMap(this.client, 'goals', userId), readIdMap(this.client, 'accounts', userId)])
    const goalId = goalIds.get(input.goalId)
    const accountId = accountIds.get(input.accountId)
    if (!goalId || !accountId) throw new Error("Goal or funding account is not present in this user's cloud records.")
    const { data, error } = await this.client.rpc('upsert_goal_contribution', { p_client_id: input.id, p_operation_id: operationId, p_goal_id: goalId, p_account_id: accountId, p_amount: input.amount, p_contribution_type: input.type, p_occurred_on: input.date, p_notes: input.notes })
    if (error) throw error
    return data
  }

  async processBudgetOccurrence(userId: string, occurrenceClientId: string) {
    const occurrenceIds = await readIdMap(this.client, 'budget_occurrences', userId)
    const occurrenceId = occurrenceIds.get(occurrenceClientId)
    if (!occurrenceId) throw new Error("Budget occurrence is not present in this user's cloud records.")
    const { data, error } = await this.client.rpc('process_budget_occurrence', { p_occurrence_id: occurrenceId })
    if (error) throw error
    return data
  }

  async reconcileBudgetOccurrence(userId: string, occurrenceClientId: string, actualAmount: number) {
    const occurrenceIds = await readIdMap(this.client, 'budget_occurrences', userId)
    const occurrenceId = occurrenceIds.get(occurrenceClientId)
    if (!occurrenceId) throw new Error("Budget occurrence is not present in this user's cloud records.")
    const { data, error } = await this.client.rpc('reconcile_budget_occurrence', { p_occurrence_id: occurrenceId, p_actual_amount: actualAmount, p_operation_id: createId() })
    if (error) throw error
    return data
  }

}