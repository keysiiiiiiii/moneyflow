const localFinanceKey = 'moneyflow-data-v1'
let activeUserId: string | null = null
let suppressFinanceStorageWrites = false

export function setFinanceStorageUser(userId: string | null) {
  activeUserId = userId
}

export function setFinanceStorageWritesSuppressed(suppressed: boolean) {
  suppressFinanceStorageWrites = suppressed
}

export function areFinanceStorageWritesSuppressed() {
  return suppressFinanceStorageWrites
}

export function getFinanceStorageKey() {
  return activeUserId ? `moneyflow-data-user-${activeUserId}` : localFinanceKey
}

export function getFinanceRecoveryKey() {
  return activeUserId ? `moneyflow-recovery-user-${activeUserId}` : 'moneyflow-recovery-v1'
}

export function getFinanceLastBackupKey() {
  return activeUserId ? `moneyflow-last-backup-user-${activeUserId}` : 'moneyflow-last-backup'
}