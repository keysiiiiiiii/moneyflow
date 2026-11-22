import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { checkSupabaseConnection, isSupabaseConfigured, supabase } from './client'
import { AuthContext, type AuthContextValue } from './authContext'
import { getAuthRedirectOptions } from './authRedirect'

function configurationError() {
  return new Error('Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY, then restart the app.')
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [passwordRecovery, setPasswordRecovery] = useState(false)
  const [loading, setLoading] = useState(Boolean(supabase))
  const [error, setError] = useState('')
  const [connectionStatus, setConnectionStatus] = useState<AuthContextValue['connectionStatus']>(supabase ? 'checking' : 'not_configured')
  const [connectionError, setConnectionError] = useState('')

  useEffect(() => {
    if (!supabase) return
    let active = true
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (active) { setSession(nextSession); setPasswordRecovery(event === 'PASSWORD_RECOVERY'); setLoading(false) }
    })
    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return
      if (sessionError) setError(sessionError.message)
      setSession(data.session)
      setLoading(false)
    })
    return () => { active = false; subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    if (!supabase) return
    let active = true
    void checkSupabaseConnection().then((result) => {
      if (active) setConnectionStatus(result.schemaReady ? 'connected' : 'migration_pending')
    }).catch((failure: unknown) => {
      if (active) {
        setConnectionStatus('error')
        setConnectionError(failure instanceof Error ? failure.message : 'Could not reach the Supabase project.')
      }
    })
    return () => { active = false }
  }, [])

  const value = useMemo<AuthContextValue>(() => ({
    configured: isSupabaseConfigured,
    connectionStatus,
    connectionError,
    session,
    passwordRecovery,
    loading,
    error,
    clearError: () => setError(''),
    signIn: async (email, password) => {
      if (!supabase) throw configurationError()
      setError('')
      const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (authError) { setError(authError.message); throw authError }
    },
    signUp: async (email, password) => {
      if (!supabase) throw configurationError()
      setError('')
      const { error: authError } = await supabase.auth.signUp({ email: email.trim(), password, options: getAuthRedirectOptions().signup })
      if (authError) { setError(authError.message); throw authError }
    },
    signOut: async () => {
      if (!supabase) throw configurationError()
      const { error: authError } = await supabase.auth.signOut()
      if (authError) { setError(authError.message); throw authError }
    },
    resetPassword: async (email) => {
      if (!supabase) throw configurationError()
      setError('')
      const { error: authError } = await supabase.auth.resetPasswordForEmail(email.trim(), getAuthRedirectOptions().passwordReset)
      if (authError) { setError(authError.message); throw authError }
    },
    updatePassword: async (password) => {
      if (!supabase) throw configurationError()
      setError('')
      const { error: authError } = await supabase.auth.updateUser({ password })
      if (authError) { setError(authError.message); throw authError }
      setPasswordRecovery(false)
    },
    clearPasswordRecovery: () => setPasswordRecovery(false),
  }), [session, passwordRecovery, loading, error, connectionStatus, connectionError])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}