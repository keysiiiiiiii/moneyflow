import { useState, type FormEvent } from 'react'
import { KeyRound, Mail, Wallet } from 'lucide-react'
import { useAuth } from '../lib/supabase/authContext'

type AuthMode = 'login' | 'signup' | 'reset' | 'update'

export function AuthScreen() {
  const { signIn, signUp, resetPassword, updatePassword, passwordRecovery, connectionStatus, connectionError, error, clearError } = useAuth()
  const [selectedMode, setSelectedMode] = useState<AuthMode>('login')
  const mode = passwordRecovery ? 'update' : selectedMode
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    clearError()
    setMessage('')
    setBusy(true)
    try {
      if (mode === 'login') await signIn(email, password)
      else if (mode === 'signup') {
        await signUp(email, password)
        setMessage('Account request sent. Check your email to confirm, then sign in.')
      } else if (mode === 'reset') {
        await resetPassword(email)
        setMessage('Password reset instructions sent if that email is registered.')
      } else {
        await updatePassword(password)
        setMessage('Password updated.')
      }
    } catch {
      // AuthProvider retains a readable error for the form.
    } finally { setBusy(false) }
  }

  return <main className="auth-screen"><section className="auth-panel"><div className="auth-brand"><span className="brand-mark"><Wallet size={20} /></span><span>money<span>flow</span></span></div><p className="eyebrow">PRIVATE FINANCE</p><h1>{mode === 'login' ? 'Welcome back' : mode === 'signup' ? 'Create your account' : mode === 'update' ? 'Choose a new password' : 'Reset password'}</h1><p className="auth-intro">{mode === 'reset' ? 'We’ll send a secure reset link to your email.' : mode === 'update' ? 'Set a new password for your MoneyFlow account.' : 'Sign in to access your MoneyFlow workspace.'}</p><p className={`auth-connection ${connectionStatus}`} role="status">{connectionStatus === 'connected' ? 'Database connected' : connectionStatus === 'migration_pending' ? 'Supabase API connected · migration pending' : connectionStatus === 'checking' ? 'Connecting to Supabase…' : connectionStatus === 'error' ? 'Supabase connection failed' : 'Supabase not configured'}</p>{connectionError ? <p className="form-error" role="alert">{connectionError}</p> : null}
    <form onSubmit={(event) => void submit(event)}>{mode !== 'update' ? <label className="field"><span>Email</span><span className="auth-input"><Mail size={17} /><input autoComplete="email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></span></label> : null}{mode !== 'reset' ? <label className="field"><span>{mode === 'update' ? 'New password' : 'Password'}</span><span className="auth-input"><KeyRound size={17} /><input autoComplete={mode === 'login' ? 'current-password' : 'new-password'} type="password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /></span></label> : null}{error ? <p className="form-error" role="alert">{error}</p> : null}{message ? <p className="form-success" role="status">{message}</p> : null}<button className="button primary auth-submit" type="submit" disabled={busy}>{busy ? 'Working…' : mode === 'login' ? 'Sign in' : mode === 'signup' ? 'Create account' : mode === 'update' ? 'Update password' : 'Send reset link'}</button></form>
    <div className="auth-links">{mode === 'login' ? <><button className="text-button" onClick={() => { setSelectedMode('signup'); clearError(); setMessage('') }}>Create account</button><button className="text-button" onClick={() => { setSelectedMode('reset'); clearError(); setMessage('') }}>Forgot password?</button></> : mode !== 'update' ? <button className="text-button" onClick={() => { setSelectedMode('login'); clearError(); setMessage('') }}>Back to sign in</button> : null}</div>
  </section></main>
}