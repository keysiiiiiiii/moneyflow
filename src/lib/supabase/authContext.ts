import { createContext, useContext } from 'react'
import type { Session } from '@supabase/supabase-js'

export interface AuthContextValue {
  configured: boolean
  connectionStatus: 'not_configured' | 'checking' | 'connected' | 'migration_pending' | 'error'
  connectionError: string
  session: Session | null
  passwordRecovery: boolean
  loading: boolean
  error: string
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  resetPassword: (email: string) => Promise<void>
  updatePassword: (password: string) => Promise<void>
  clearPasswordRecovery: () => void
  clearError: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider')
  return context
}