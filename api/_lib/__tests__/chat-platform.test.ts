import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../http.js'

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  getAdminClient: vi.fn(),
  enforceRateLimit: vi.fn(),
  reservePlatformUsage: vi.fn(),
  loadPlatformProviderCredentials: vi.fn(),
  finalizePlatformUsage: vi.fn(),
  estimatePlatformTokens: vi.fn(() => 5000),
  generateProviderText: vi.fn(),
}))

vi.mock('../supabase.js', () => ({ authenticate: mocks.authenticate, getAdminClient: mocks.getAdminClient }))
vi.mock('../rate-limit.js', () => ({ enforceRateLimit: mocks.enforceRateLimit, enforceSessionRateLimit: vi.fn() }))
vi.mock('../provider-credentials.js', () => ({ ephemeralProviderRecord: vi.fn(), ephemeralRateLimitParts: vi.fn(), loadOwnedProviderCredentials: vi.fn() }))
vi.mock('../platform-provider.js', () => ({
  reservePlatformUsage: mocks.reservePlatformUsage,
  loadPlatformProviderCredentials: mocks.loadPlatformProviderCredentials,
  finalizePlatformUsage: mocks.finalizePlatformUsage,
  estimatePlatformTokens: mocks.estimatePlatformTokens,
}))
vi.mock('../provider-runtime.js', () => ({
  assertSafeProviderUrl: vi.fn(),
  generateProviderText: mocks.generateProviderText,
  inferProtocol: vi.fn(() => 'openai-compatible'),
  providerBaseUrl: vi.fn(() => 'https://api.openai.com/v1'),
  providerDiagnostic: vi.fn(() => ({ message: 'failed', detectedProtocol: 'openai-compatible', models: [], latencyMs: 1 })),
  sanitizeProviderEndpoint: vi.fn((value: string) => value),
  streamProviderText: vi.fn(),
}))
vi.mock('../providers/multimodal.js', () => ({ assertMultimodalSupport: vi.fn() }))

import handler from '../../chat.js'

function responseMock() {
  const state: any = { headers: {}, statusCode: 200, body: undefined, ended: false }
  const emitter = new EventEmitter()
  const response: any = Object.assign(emitter, {
    setHeader: (key: string, value: unknown) => { state.headers[key] = value },
    status: (code: number) => { state.statusCode = code; return response },
    json: (body: unknown) => { state.body = body; state.ended = true; return response },
    end: () => { state.ended = true; return response },
    write: vi.fn(),
  })
  Object.defineProperties(response, { writableEnded: { get: () => state.ended }, destroyed: { get: () => false } })
  return { response, state }
}

function request() {
  const emitter = new EventEmitter()
  return Object.assign(emitter, {
    method: 'POST', headers: { authorization: 'Bearer valid', 'x-forwarded-for': '203.0.113.4' },
    body: { credentialMode: 'platform', messages: [{ role: 'user', content: 'hello' }], stream: false },
  }) as any
}

beforeEach(() => {
  vi.clearAllMocks()
  const admin = {}
  mocks.getAdminClient.mockReturnValue(admin)
  mocks.authenticate.mockResolvedValue({ user: { id: 'user-id' }, profile: { role: 'user' } })
  mocks.reservePlatformUsage.mockResolvedValue({ reservationId: 'reservation-id', providerId: 'provider-id', reservedTokens: 5000 })
  mocks.loadPlatformProviderCredentials.mockResolvedValue({
    provider: { id: 'provider-id', type: 'openai', protocol: 'openai-compatible', base_url: null, model: 'gpt-4o' },
    apiKey: 'platform-secret',
  })
  mocks.generateProviderText.mockResolvedValue({ content: 'answer', usage: { inputTokens: 4, outputTokens: 5, totalTokens: 9 }, protocol: 'openai-compatible', endpoint: 'https://api.openai.com/v1/chat/completions' })
  mocks.finalizePlatformUsage.mockResolvedValue(true)
})

describe('POST /api/chat platform mode', () => {
  it('requires auth, uses only the default model, hides infrastructure, and finalizes usage', async () => {
    const { response, state } = responseMock()
    await handler(request(), response)
    expect(state.statusCode).toBe(200)
    expect(state.body).toMatchObject({ content: 'answer', provider: 'platform', model: 'gpt-4o' })
    expect(state.body.endpoint).toBeUndefined()
    expect(JSON.stringify(state.body)).not.toContain('platform-secret')
    expect(mocks.authenticate).toHaveBeenCalledTimes(1)
    expect(mocks.generateProviderText).toHaveBeenCalledWith(expect.anything(), 'platform-secret', 'gpt-4o', expect.any(Array))
    expect(mocks.finalizePlatformUsage).toHaveBeenCalledWith(expect.anything(), 'reservation-id', 9, true)
  })

  it('returns quota denial before loading or calling the provider', async () => {
    mocks.reservePlatformUsage.mockRejectedValue(new ApiError(429, 'quota', 'platform_quota_exceeded', { resetAt: '2026-07-17T00:00:00Z' }))
    const { response, state } = responseMock()
    await handler(request(), response)
    expect(state.statusCode).toBe(429)
    expect(state.body.code).toBe('platform_quota_exceeded')
    expect(mocks.loadPlatformProviderCredentials).not.toHaveBeenCalled()
    expect(mocks.generateProviderText).not.toHaveBeenCalled()
  })
})
