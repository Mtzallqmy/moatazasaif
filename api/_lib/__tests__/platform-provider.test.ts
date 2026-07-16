import { afterEach, describe, expect, it, vi } from 'vitest'
import { estimatePlatformTokens, getPlatformProviderSummary, reservePlatformUsage } from '../platform-provider.js'
import { resetEnvCacheForTests } from '../env.js'

afterEach(() => {
  resetEnvCacheForTests()
  delete process.env.PROVIDER_MAX_OUTPUT_TOKENS
})

describe('platform provider quotas', () => {
  it('reserves a conservative token estimate including text and images', () => {
    process.env.PROVIDER_MAX_OUTPUT_TOKENS = '1000'
    resetEnvCacheForTests()
    expect(estimatePlatformTokens([{
      role: 'user', content: 'hello', attachments: [
        { type: 'text', mimeType: 'text/plain', text: 'world' },
        { type: 'image', mimeType: 'image/png', dataUrl: 'data:image/png;base64,eA==' },
      ],
    }])).toBe(9_010)
  })

  it('maps an atomic quota denial to a 429 without exposing provider credentials', async () => {
    const admin: any = { rpc: vi.fn(async () => ({ data: {
      allowed: false, reason: 'token_limit', requestsUsed: 2, requestsLimit: 10,
      tokensUsed: 900, tokensReserved: 100, tokensLimit: 1000, resetAt: '2026-07-17T00:00:00Z',
    }, error: null })) }
    await expect(reservePlatformUsage(admin, 'user-id', 100)).rejects.toMatchObject({
      status: 429,
      code: 'platform_quota_exceeded',
      details: { tokensUsed: 1000, tokensLimit: 1000 },
    })
  })

  it('returns the authenticated discovery contract with aggregate usage', async () => {
    const rows: Record<string, any> = {
      providers: { id: 'real-id', user_id: 'owner-id', name: 'Default', type: 'openai', protocol: 'openai-compatible', base_url: null, model: 'gpt-4o', models: ['gpt-4o'], platform_daily_request_limit: 50, platform_daily_token_limit: 100000 },
      profiles: { role: 'owner', is_active: true },
      platform_provider_usage: { request_count: 4, token_count: 1200, reserved_tokens: 300 },
    }
    const admin: any = {
      from(table: string) {
        const chain: any = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: rows[table], error: null }) }
        return chain
      },
    }
    await expect(getPlatformProviderSummary(admin, 'user-id')).resolves.toMatchObject({
      provider: { id: 'platform', credentialMode: 'platform', model: 'gpt-4o', status: 'connected' },
      usage: { requestsUsed: 4, requestsLimit: 50, tokensUsed: 1500, tokensLimit: 100000 },
    })
  })
})
