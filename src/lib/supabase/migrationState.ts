import type { ValidatedBackup } from '../backup'

type MigrationStorage = Pick<Storage, 'getItem' | 'setItem'>

export function recordImportedBackup(storage: MigrationStorage, userId: string, backup: ValidatedBackup): void {
  storage.setItem(`moneyflow-sync-baseline-${userId}`, JSON.stringify(backup))
  storage.setItem(`moneyflow-cloud-migration-${userId}`, 'imported')
}

export function recordSkippedImport(storage: MigrationStorage, userId: string): void {
  storage.setItem(`moneyflow-cloud-migration-${userId}`, 'skipped')
}

export function cloudSyncUserId(storage: MigrationStorage, userId: string): string | null {
  return storage.getItem(`moneyflow-cloud-migration-${userId}`) === 'skipped' ? null : userId
}