import { createContext, useContext } from 'react'
import type { GoalContribution, Transaction, Transfer } from '../../types'

export type CloudMutationInput =
  | { kind: 'transfer'; value: Transfer }
  | { kind: 'goal_contribution'; value: GoalContribution }
  | { kind: 'transaction'; value: Transaction }
  | { kind: 'delete_transaction'; value: { id: string } }

export type SyncStatus = 'synced' | 'pending' | 'error'

export interface CloudSyncValue {
  enabled: boolean
  status: SyncStatus
  pendingCount: number
  error: string
  retry: () => void
  runMutation: (mutation: CloudMutationInput) => Promise<boolean>
}

export const defaultCloudSync: CloudSyncValue = { enabled: false, status: 'synced', pendingCount: 0, error: '', retry: () => {}, runMutation: async () => false }
export const CloudSyncContext = createContext<CloudSyncValue>(defaultCloudSync)

export function useCloudSync() {
  return useContext(CloudSyncContext)
}