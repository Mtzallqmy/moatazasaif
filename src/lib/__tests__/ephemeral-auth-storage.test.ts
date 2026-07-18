import { describe, expect, it } from 'vitest'
import { createEphemeralAuthStorage } from '../supabase'

function storageDouble() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  }
}

describe('browser auth storage', () => {
  it('keeps Supabase sessions in memory and only stores the PKCE verifier in sessionStorage', () => {
    const sessionStore = storageDouble()
    const authStorage = createEphemeralAuthStorage(sessionStore)
    authStorage.setItem('sb-ref-auth-token', 'session-secret')
    authStorage.setItem('sb-ref-auth-token-code-verifier', 'verifier')
    expect(authStorage.getItem('sb-ref-auth-token')).toBe('session-secret')
    expect(sessionStore.getItem('sb-ref-auth-token')).toBeNull()
    expect(sessionStore.getItem('sb-ref-auth-token-code-verifier')).toBe('verifier')
  })
})
