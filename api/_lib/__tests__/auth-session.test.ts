import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearOAuthVerifierCookie, clearSessionCookies, readAccessToken, readRefreshToken, requestAppOrigin, setSessionCookies } from '../auth-session.js'

function responseDouble() {
  const headers = new Map<string, string | string[]>()
  const response: any = {
    setHeader: vi.fn((name: string, value: string | string[]) => headers.set(name.toLowerCase(), value)),
    getHeader: vi.fn((name: string) => headers.get(name.toLowerCase())),
  }
  return { response, headers }
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('secure auth cookies', () => {
  it('sets HttpOnly, SameSite and Secure production cookies without exposing token names in JSON', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { response, headers } = responseDouble()
    setSessionCookies(response, {
      access_token: 'access-secret',
      refresh_token: 'refresh-secret',
      expires_at: Math.floor(Date.now() / 1000) + 1800,
      expires_in: 1800,
      token_type: 'bearer',
      user: {} as never,
    })
    const values = headers.get('set-cookie') as string[]
    expect(values).toHaveLength(2)
    expect(values[0]).toContain('__Host-moataz-access-token=access-secret')
    expect(values[0]).toContain('HttpOnly')
    expect(values[0]).toContain('Secure')
    expect(values[0]).toContain('SameSite=Lax')
    expect(values[0]).toContain('Path=/')
    expect(values.join('\n')).not.toContain('Authorization')
  })

  it('reads and clears cookies using the same production names', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const request = { cookies: { '__Host-moataz-access-token': 'a', '__Host-moataz-refresh-token': 'r' } } as any
    expect(readAccessToken(request)).toBe('a')
    expect(readRefreshToken(request)).toBe('r')
    const { response, headers } = responseDouble()
    clearSessionCookies(response)
    expect((headers.get('set-cookie') as string[]).every((value) => value.includes('Max-Age=0'))).toBe(true)
  })

  it('keeps OAuth callbacks on the Vercel host that started the flow', () => {
    vi.stubEnv('APP_URL', 'https://moatazalalqami.online')
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'moatazasaif.vercel.app')
    const request = { headers: { host: 'moatazasaif.vercel.app' } } as any
    expect(requestAppOrigin(request)).toBe('https://moatazasaif.vercel.app')
  })

  it('clears the short-lived OAuth verifier independently', () => {
    vi.stubEnv('NODE_ENV', 'production')
    const { response, headers } = responseDouble()
    clearOAuthVerifierCookie(response)
    expect(headers.get('set-cookie')).toEqual([
      expect.stringContaining('__Host-moataz-oauth-verifier=; Path=/; Max-Age=0'),
    ])
  })
})
