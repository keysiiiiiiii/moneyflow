import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAuthRedirectOptions } from '../src/lib/supabase/authRedirect'

afterEach(() => vi.unstubAllGlobals())

describe('Supabase authentication redirects', () => {
  it.each([
    ['local development', 'http://localhost:5173'],
    ['Vercel production', 'https://moneyflow-blush-pi.vercel.app'],
  ])('uses the active origin for signup and password reset on %s', (_environment, origin) => {
    vi.stubGlobal('window', { location: { origin } })

    expect(getAuthRedirectOptions()).toEqual({
      signup: { emailRedirectTo: origin },
      passwordReset: { redirectTo: origin },
    })
  })
})
