import { describe, expect, it, vi } from 'vitest'
import { getOAuthProviderAvailability } from '../oauth-provider'

const config = {
  url: 'https://project-ref.supabase.co',
  publishableKey: 'sb_publishable_test_value',
}

describe('OAuth provider preflight', () => {
  it('reports enabled providers from the public Supabase Auth settings', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      external: { google: true, github: false },
    }), { status: 200 }))

    await expect(getOAuthProviderAvailability(config, 'google', fetcher)).resolves.toBe('enabled')
    expect(fetcher).toHaveBeenCalledWith('https://project-ref.supabase.co/auth/v1/settings', expect.objectContaining({
      headers: { apikey: config.publishableKey },
    }))
  })

  it('stops before redirecting when the selected provider is disabled', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      external: { google: true, github: false },
    }), { status: 200 }))

    await expect(getOAuthProviderAvailability(config, 'github', fetcher)).resolves.toBe('disabled')
  })

  it('fails closed and distinguishes an unreachable Auth host', async () => {
    const unavailable = vi.fn(async () => new Response('unavailable', { status: 503 }))
    const networkFailure = vi.fn(async () => { throw new Error('network failure') })

    await expect(getOAuthProviderAvailability(config, 'google', unavailable)).resolves.toBe('unknown')
    await expect(getOAuthProviderAvailability(config, 'google', networkFailure)).resolves.toBe('unreachable')
  })
})
