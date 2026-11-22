import type { ValidatedBackup } from '../backup'
import { createId } from '../id'

export const cloudTables = ['accounts', 'goals', 'budget_schedules', 'transactions', 'goal_contributions', 'budget_occurrences', 'transfers', 'balance_adjustments', 'monthly_budgets', 'daily_budgets', 'contributions', 'planned_spending', 'reservations', 'calendar_notes', 'notifications', 'activity_history', 'profiles'] as const
export type CloudTable = typeof cloudTables[number]
export type CloudRow = Record<string, unknown>
export type CloudRows = Record<CloudTable, CloudRow[]>
export interface CloudChange { table: CloudTable; key: string; before: CloudRow | null; after: CloudRow | null }

export function emptyCloudRows(): CloudRows {
  return Object.fromEntries(cloudTables.map((table) => [table, [] as CloudRow[]])) as CloudRows
}

export function cloudRowKey(table: CloudTable, row: CloudRow): string {
  return String(row[table === 'profiles' ? 'user_id' : 'client_id'])
}

export function buildCloudRows(backup: ValidatedBackup, userId: string, existing: CloudRows): CloudRows {
  const result = emptyCloudRows()
  const identities = new Map<CloudTable, Map<string, string>>()
  for (const table of cloudTables) identities.set(table, new Map(existing[table].map((row) => [cloudRowKey(table, row), String(row.id)])))
  function id(table: CloudTable, clientId: string): string {
    const map = identities.get(table)!
    if (!map.has(clientId)) map.set(clientId, createId())
    return map.get(clientId)!
  }
  function reference(table: CloudTable, clientId: string | undefined): string | null {
    return clientId ? id(table, clientId) : null
  }
  function add(table: CloudTable, clientId: string, fields: CloudRow) {
    result[table].push({ id: id(table, clientId), user_id: userId, client_id: clientId, ...fields })
  }
  for (const item of backup.accounts) add('accounts', item.id, { name: item.name, institution: item.institution, kind: item.kind, opening_balance: item.openingBalance, include_in_total: item.includeInTotal, archived: item.archived, color: item.color, icon: item.icon, nickname: item.nickname })
  for (const item of backup.goals) add('goals', item.id, { name: item.name, target_amount: item.targetAmount, initial_amount: Math.max(0, item.currentAmount - backup.goalContributions.filter((entry) => entry.goalId === item.id).reduce((sum, entry) => sum + entry.amount, 0)), deadline: item.deadline, color: item.color })
  for (const item of backup.budgetSchedules) add('budget_schedules', item.id, { title: item.title, category: item.category, amount: item.amount, source_account_id: reference('accounts', item.sourceAccountId), start_date: item.startDate, end_date: item.endDate, weekdays: item.weekdays, reservation_mode: item.reservationMode, auto_post: item.autoPost, status: item.status })
  for (const item of backup.transactions) {
    const related = item.type === 'expense' ? item.goalContributionId ? ['goal_contribution', item.goalContributionId] : item.budgetOccurrenceId ? ['budget_occurrence', item.budgetOccurrenceId] : item.contributionId ? ['contribution', item.contributionId] : item.autoPlanId ? ['planned_spending', item.autoPlanId] : [null, null] : [null, null]
    add('transactions', item.id, { account_id: reference('accounts', item.accountId), entry_type: item.type, amount: item.amount, occurred_on: item.date, category: item.type === 'expense' ? item.category : null, description: item.type === 'expense' ? item.description : '', income_source: item.type === 'income' ? item.source : null, notes: item.type === 'income' ? item.notes : item.note ?? '', saving_type: item.type === 'saving' ? item.savingType : null, saving_mode: item.type === 'saving' ? item.mode ?? 'transfer' : null, related_entity_type: related[0], related_client_id: related[1], recurring: item.type === 'expense' ? item.recurring ?? false : false, provisional: item.type === 'expense' ? item.provisional ?? false : false })
  }
  for (const item of backup.goalContributions) add('goal_contributions', item.id, { goal_id: reference('goals', item.goalId), account_id: reference('accounts', item.accountId), amount: item.amount, contribution_type: item.type, occurred_on: item.date, notes: item.notes, transaction_id: reference('transactions', item.transactionId) })
  for (const item of backup.budgetOccurrences) add('budget_occurrences', item.id, { budget_schedule_id: reference('budget_schedules', item.budgetScheduleId), occurrence_date: item.date, planned_amount: item.plannedAmount, actual_amount: item.actualAmount, status: item.status, reservation_client_id: item.reservationId ?? null, posted_transaction_id: reference('transactions', item.postedTransactionId), reconciled_at: item.reconciledAt ?? null })
  for (const item of backup.transfers) add('transfers', item.id, { source_account_id: reference('accounts', item.sourceAccountId), destination_account_id: reference('accounts', item.destinationAccountId), amount: item.amount, occurred_on: item.date, note: item.note })
  for (const item of backup.balanceAdjustments) add('balance_adjustments', item.id, { account_id: reference('accounts', item.accountId), amount: item.amount, occurred_on: item.date, note: item.note })
  for (const item of backup.budgets) add('monthly_budgets', item.id, { category: item.category, amount: item.amount, month: `${item.month}-01` })
  for (const item of backup.dailyBudgets) add('daily_budgets', item.date, { budget_date: item.date, amount: item.amount })
  for (const item of backup.contributions) add('contributions', item.id, { title: item.title, category: item.category, amount: item.amount, occurred_on: item.contributionDate ?? item.date, recipient: item.recipient ?? null, account_id: reference('accounts', item.sourceAccountId ?? item.accountId), description: item.description ?? '', status: item.status, balance_effect: item.balanceEffect, include_in_expense_analytics: item.includeInExpenseAnalytics ?? false, paid_at: item.paidAt ?? null, transaction_id: reference('transactions', item.transactionId) })
  for (const item of backup.plannedSpending) add('planned_spending', item.id, { title: item.title, planned_date: item.date, expected_amount: item.expectedAmount, maximum_amount: item.maximumAmount, category: item.category, account_id: reference('accounts', item.accountId), notes: item.notes, reserve_money: item.reserveMoney, auto_post: item.autoPost, reminder: item.reminder, status: item.status, actual_amount: item.actualAmount, provisional_transaction_id: reference('transactions', item.provisionalTransactionId), reconciled_at: item.reconciledAt ?? null })
  for (const item of backup.goalContributions) if (item.type === 'reserve') add('reservations', `goal:${item.id}`, { account_id: reference('accounts', item.accountId), source_type: 'goal', source_client_id: item.id, amount: item.amount, reserved_on: item.date, status: 'active' })
  for (const item of backup.budgetOccurrences) {
    const schedule = backup.budgetSchedules.find((entry) => entry.id === item.budgetScheduleId)
    if (schedule?.reservationMode === 'reserve') add('reservations', item.reservationId ?? `budget:${item.id}`, { account_id: reference('accounts', schedule.sourceAccountId), source_type: 'budget_schedule', source_client_id: item.id, amount: item.plannedAmount, reserved_on: item.date, status: ['scheduled', 'due'].includes(item.status) ? 'active' : ['completed', 'exceeded', 'pending_reconciliation'].includes(item.status) ? 'consumed' : 'released' })
  }
  for (const item of backup.plannedSpending) if (item.reserveMoney) add('reservations', `plan:${item.id}`, { account_id: reference('accounts', item.accountId), source_type: 'planned_spending', source_client_id: item.id, amount: item.maximumAmount, reserved_on: item.date, status: ['Upcoming', 'Active', 'Due'].includes(item.status) ? 'active' : ['Completed', 'Exceeded', 'Pending Reconciliation'].includes(item.status) ? 'consumed' : 'released' })
  for (const item of backup.transactions) if (item.type === 'saving') {
    if (!item.accountId) throw new Error('Assign legacy savings to a funding account before cloud migration. The local data was preserved.')
    add('reservations', `savings:${item.id}`, { account_id: reference('accounts', item.accountId), source_type: 'savings', source_client_id: item.id, amount: item.amount, reserved_on: item.date, status: 'active' })
  }
  for (const item of backup.calendarNotes) add('calendar_notes', item.id, { note_date: item.date, title: item.title, content: item.content })
  for (const item of backup.notifications) add('notifications', item.id, { type: item.type, title: item.title, message: item.message, related_entity_type: item.relatedEntityType ?? null, related_client_id: item.relatedEntityId ?? null, priority: item.priority, created_at: item.createdAt, read_at: item.readAt ?? null })
  for (const item of backup.activityHistory) add('activity_history', item.id, { category: item.category, action: item.action, entity_type: item.entityType, entity_client_id: item.entityId, title: item.title, description: item.description, occurred_on: item.date, amount: item.amount ?? null, account_id: reference('accounts', item.accountId), category_name: item.categoryName ?? null, before_balance: item.beforeBalance ?? null, after_balance: item.afterBalance ?? null, created_at: item.createdAt })
  const profile = backup.profile
  if (profile) result.profiles.push({ user_id: userId, display_name: profile.displayName, preferred_name: profile.preferredName, photo_data_url: profile.photoDataUrl, currency: profile.currency, monthly_income_target: profile.monthlyIncomeTarget, payday: profile.payday, week_starts_on: profile.weekStartsOn, date_format: profile.dateFormat, theme: profile.theme ?? 'system', accent: profile.accent ?? 'ocean' })
  return result
}

function normalized(value: unknown, key: string): string {
  if (Array.isArray(value)) return JSON.stringify([...value].sort())
  if (typeof value === 'string' && key.endsWith('_at')) return new Date(value).toISOString()
  return JSON.stringify(value ?? null)
}

function matches(row: CloudRow, desired: CloudRow): boolean {
  return Object.keys(desired).every((key) => normalized(row[key], key) === normalized(desired[key], key))
}

function isDefaultProfile(row: CloudRow): boolean {
  return row.display_name === '' && row.preferred_name === '' && row.photo_data_url === '' && row.currency === 'PHP' && row.monthly_income_target === null && row.payday === '' && row.week_starts_on === 1 && row.date_format === 'en-PH' && row.theme === 'system' && row.accent === 'ocean'
}

export function planCloudChanges(before: CloudRows | null, after: CloudRows, remote: CloudRows): CloudChange[] {
  const changes: CloudChange[] = []
  for (const table of cloudTables) {
    const previous = new Map((before?.[table] ?? []).map((row) => [cloudRowKey(table, row), row]))
    const next = new Map(after[table].map((row) => [cloudRowKey(table, row), row]))
    const hosted = new Map(remote[table].map((row) => [cloudRowKey(table, row), row]))
    for (const key of new Set([...previous.keys(), ...next.keys()])) {
      const old = previous.get(key)
      const desired = next.get(key)
      const current = hosted.get(key)
      if (old && desired && matches(old, desired)) continue
      if (desired && current && matches(current, desired)) continue
      if (!desired && !current) continue
      if (table === 'profiles' && !old && current && isDefaultProfile(current)) {
        changes.push({ table, key, before: current, after: desired ?? null })
        continue
      }
      if (old && current && !matches(current, old) || !old && current) throw new Error(`Cloud conflict in ${table} (${key}). Neither version was overwritten; review both copies.`)
      if (old && !current && desired) throw new Error(`Cloud conflict in ${table} (${key}): the hosted record was deleted.`)
      if (table === 'activity_history' && old) throw new Error('Activity History is permanent and cannot be rewritten by synchronization.')
      changes.push({ table, key, before: current ?? null, after: desired ?? null })
    }
  }
  return changes
}