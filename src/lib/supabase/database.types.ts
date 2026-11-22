type EntityRow = {
  id: string
  user_id: string
  client_id: string
  [key: string]: unknown
}

type ProfileRow = {
  user_id: string
  [key: string]: unknown
}

type Table<Row extends Record<string, unknown>> = {
  Row: Row
  Insert: Partial<Row>
  Update: Partial<Row>
  Relationships: []
}

type EntityTable = Table<EntityRow>

export interface Database {
  public: {
    Tables: {
      profiles: Table<ProfileRow>
      accounts: EntityTable
      goals: EntityTable
      transactions: EntityTable
      transfers: EntityTable
      balance_adjustments: EntityTable
      monthly_budgets: EntityTable
      daily_budgets: EntityTable
      budget_schedules: EntityTable
      budget_occurrences: EntityTable
      goal_contributions: EntityTable
      contributions: EntityTable
      planned_spending: EntityTable
      reservations: EntityTable
      calendar_notes: EntityTable
      notifications: EntityTable
      activity_history: EntityTable
      migration_batches: EntityTable
      sync_batches: Table<{ user_id: string; operation_id: string; payload_hash: string; created_at: string }>
    }
    Views: Record<never, never>
    Functions: {
      apply_finance_changes: { Args: { p_operation_id: string; p_changes: unknown }; Returns: { applied: number; replayed: boolean } }
      record_transfer: { Args: { p_client_id: string; p_operation_id: string; p_source_account_id: string; p_destination_account_id: string; p_amount: number; p_occurred_on: string; p_note?: string }; Returns: string }
      upsert_transaction: { Args: { p_client_id: string; p_operation_id: string; p_account_id: string; p_entry_type: string; p_amount: number; p_occurred_on: string; p_category?: string; p_description?: string; p_income_source?: string; p_notes?: string; p_saving_type?: string; p_saving_mode?: string; p_recurring?: boolean }; Returns: string }
      delete_transaction: { Args: { p_client_id: string; p_operation_id: string }; Returns: boolean }
      upsert_goal_contribution: { Args: { p_client_id: string; p_operation_id: string; p_goal_id: string; p_account_id: string; p_amount: number; p_contribution_type: string; p_occurred_on: string; p_notes?: string }; Returns: string }
      process_budget_occurrence: { Args: { p_occurrence_id: string }; Returns: string }
      reconcile_budget_occurrence: { Args: { p_occurrence_id: string; p_actual_amount: number; p_operation_id: string }; Returns: string }
    }
    Enums: Record<never, never>
    CompositeTypes: Record<never, never>
  }
}