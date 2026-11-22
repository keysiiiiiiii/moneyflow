import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()

export const isSupabaseConfigured = Boolean(url && publishableKey)

const publicKeyOnlyFetch: typeof fetch = async (input, init) => {
  const headers = new Headers(init?.headers)
  if (publishableKey && headers.get('Authorization') === `Bearer ${publishableKey}`) headers.delete('Authorization')
  return fetch(input, { ...init, headers })
}

export const supabase = isSupabaseConfigured
  ? createClient<Database>(url!, publishableKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
      db: { schema: 'public' },
      global: { fetch: publicKeyOnlyFetch },
    })
  : null

export async function checkSupabaseConnection() {
  if (!url || !publishableKey || !supabase) throw new Error('Supabase URL or publishable key is missing.')
  if (publishableKey.startsWith('sb_secret_')) throw new Error('VITE_SUPABASE_PUBLISHABLE_KEY contains a secret key. Replace it with the Publishable key from Supabase Dashboard → Project Settings → API Keys.')
  if (!publishableKey.startsWith('sb_publishable_')) throw new Error('VITE_SUPABASE_PUBLISHABLE_KEY must use the sb_publishable_ format from Supabase Dashboard → Project Settings → API Keys → Publishable key.')
  const headers = { apikey: publishableKey }
  const baseUrl = url.replace(/\/+$/, '')
  const authResponse = await fetch(`${baseUrl}/auth/v1/settings`, { headers, cache: 'no-store' })
  async function responseMessage(response: Response) {
    try {
      const body: unknown = await response.clone().json()
      if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string') return body.message
    } catch { return '' }
    return ''
  }
  if (!authResponse.ok) throw new Error(`Supabase Auth endpoint returned HTTP ${authResponse.status}${await responseMessage(authResponse) ? `: ${await responseMessage(authResponse)}` : ''}.`)
  const { error, status } = await supabase.from('profiles').select('user_id').limit(0)
  if (error && (error.code === 'PGRST205' || /schema cache|relation .*profiles.* does not exist/i.test(error.message))) return { authStatus: authResponse.status, databaseStatus: status, schemaReady: false }
  if (error) throw new Error(`Supabase Data API returned HTTP ${status}: ${error.message}`)
  return { authStatus: authResponse.status, databaseStatus: status, schemaReady: true }
}