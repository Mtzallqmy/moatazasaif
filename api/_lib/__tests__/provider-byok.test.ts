import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetEnvCacheForTests } from '../env.js'
import { parseRequest, providerTestRequestSchema } from '../provider-schemas.js'
import { loadOwnedProviderCredentials } from '../provider-credentials.js'
import { assertSafeProviderUrl, classifyProviderError, inferProtocol, isPrivateIpAddress, providerDiagnostic } from '../provider-runtime.js'
import { parseSseStream } from '../providers/http.js'
import { ApiError } from '../http.js'
import { enforceSessionRateLimit, resetSessionRateLimitsForTests, sessionRateLimitFingerprints } from '../rate-limit.js'

afterEach(() => {
  vi.restoreAllMocks()
  resetEnvCacheForTests()
  delete process.env.NODE_ENV
  delete process.env.ALLOW_INSECURE_PROVIDER_URLS
  delete process.env.PROVIDER_TIMEOUT_MS
  delete process.env.PROVIDER_MAX_RESPONSE_BYTES
})

describe('BYOK request contracts', () => {
  it('rejects a providerId combined with ephemeral credentials', () => {
    const result = providerTestRequestSchema.safeParse({
      credentialMode: 'session',
      providerId: '00000000-0000-0000-0000-000000000000',
      provider: { type: 'openai', apiKey: 'not-a-real-key' },
    })
    expect(result.success).toBe(false)
  })

  it('accepts exactly one saved or session credential source', () => {
    expect(parseRequest(providerTestRequestSchema, { credentialMode: 'saved', providerId: '00000000-0000-0000-0000-000000000000' }).credentialMode).toBe('saved')
    expect(parseRequest(providerTestRequestSchema, { credentialMode: 'session', provider: { type: 'dahl', apiKey: 'temporary-key' } }).credentialMode).toBe('session')
  })
})

describe('provider classification and protocol detection', () => {
  it.each([
    [401, 'authentication'], [403, 'authorization'], [404, 'endpoint'], [429, 'rate_limit'], [500, 'upstream'], [503, 'upstream'],
  ])('classifies HTTP %s', (status, category) => {
    expect(classifyProviderError({ status, message: 'provider error', protocol: 'openai-compatible' }).category).toBe(category)
  })

  it('classifies timeout and quota separately', () => {
    expect(classifyProviderError({ code: 'timeout', message: 'timed out', protocol: 'gemini' }).category).toBe('timeout')
    expect(classifyProviderError({ status: 408, message: 'request timeout', protocol: 'gemini' }).category).toBe('timeout')
    expect(classifyProviderError({ status: 429, code: 'quota_exceeded', message: 'quota', protocol: 'gemini' }).category).toBe('quota')
  })

  it('detects all native protocols without routing them through OpenAI', () => {
    expect(inferProtocol('gemini', null)).toBe('gemini')
    expect(inferProtocol('anthropic', null)).toBe('anthropic')
    expect(inferProtocol('custom', 'https://api.anthropic.com/v1')).toBe('anthropic')
    expect(inferProtocol('dahl', null)).toBe('openai-compatible')
  })
})

describe('owned provider decryption', () => {
  function fakeAdmin(row: unknown) {
    const chain: any = {
      from: () => chain,
      select: () => chain,
      eq: () => chain,
      maybeSingle: vi.fn(async () => ({ data: row, error: null })),
    }
    return chain
  }

  it('does not decrypt when ownership lookup returns no row', async () => {
    const decrypt = vi.fn(() => 'should-not-run')
    await expect(loadOwnedProviderCredentials(fakeAdmin(null), 'user-a', 'provider-a', { decrypt: decrypt as any })).rejects.toMatchObject({ code: 'provider_not_found' })
    expect(decrypt).not.toHaveBeenCalled()
  })

  it('decrypts only the owned row after the query succeeds', async () => {
    const decrypt = vi.fn(() => 'clear-key')
    const result = await loadOwnedProviderCredentials(fakeAdmin({ id: 'provider-a', user_id: 'user-a', type: 'openai', base_url: null, model: null, encrypted_key: { ciphertext: 'x', iv: 'y', authTag: 'z' } }), 'user-a', 'provider-a', { decrypt: decrypt as any })
    expect(decrypt).toHaveBeenCalledTimes(1)
    expect(result.apiKey).toBe('clear-key')
  })
})

describe('SSE parsing and safety', () => {
  it('parses chunks split at irregular boundaries', async () => {
    process.env.NODE_ENV = 'test'
    const chunks = ['event: delta\ndata: {"content":"he', 'llo"}\n\n', 'event: usage\ndata: {"totalTokens":2}\n\n', 'event: done\ndata: {}\n\n']
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks.shift()
        if (!chunk) { controller.close(); return }
        controller.enqueue(new TextEncoder().encode(chunk))
      },
    })
    const response = new Response(stream, { status: 200 })
    const events: Array<{ event?: string; data: string }> = []
    for await (const event of parseSseStream(response, 'https://example.com/v1/stream')) events.push(event)
    expect(events.map((event) => event.event)).toEqual(['delta', 'usage', 'done'])
    expect(events[0].data).toBe('{"content":"hello"}')
  })

  it('parses CRLF SSE boundaries split across network packets', async () => {
    process.env.NODE_ENV = 'test'
    const chunks = ['event: delta\r', '\ndata: {"content":"A"}\r\n\r', '\nevent: done\r\ndata: {}\r\n\r\n']
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks.shift()
        if (!chunk) { controller.close(); return }
        controller.enqueue(new TextEncoder().encode(chunk))
      },
    })
    const events: Array<{ event?: string; data: string }> = []
    for await (const event of parseSseStream(new Response(stream), 'https://example.com/stream')) events.push(event)
    expect(events).toEqual([
      { event: 'delta', data: '{"content":"A"}' },
      { event: 'done', data: '{}' },
    ])
  })

  it('does not expose secrets in a normalized diagnostic', () => {
    const diagnostic = providerDiagnostic(new Error('Authorization: Bearer sk-super-secret-value'), 'openai-compatible', Date.now())
    expect(JSON.stringify(diagnostic)).not.toContain('sk-super-secret-value')
  })

  it('recognizes private address families', () => {
    expect(isPrivateIpAddress('127.0.0.1')).toBe(true)
    expect(isPrivateIpAddress('::1')).toBe(true)
    expect(isPrivateIpAddress('0:0:0:0:0:0:0:1')).toBe(true)
    expect(isPrivateIpAddress('fc00::42')).toBe(true)
    expect(isPrivateIpAddress('8.8.8.8')).toBe(false)
  })

  it('blocks localhost and HTTP endpoints under the production SSRF policy', async () => {
    process.env.NODE_ENV = 'production'
    process.env.ALLOW_INSECURE_PROVIDER_URLS = 'false'
    await expect(assertSafeProviderUrl('http://127.0.0.1/v1')).rejects.toMatchObject({ code: 'https_required' })
    await expect(assertSafeProviderUrl('https://127.0.0.1/v1')).rejects.toMatchObject({ code: 'private_provider_host' })
    await expect(assertSafeProviderUrl('https://[::1]/v1')).rejects.toMatchObject({ code: 'private_provider_host' })
  })

  it('redacts an arbitrary provider key from a diagnostic when supplied as a secret', () => {
    const secret = 'dahl-live-key-9f3a8b7c'
    const diagnostic = providerDiagnostic(new Error(`gateway echoed ${secret}`), 'openai-compatible', Date.now(), [secret])
    expect(JSON.stringify(diagnostic)).not.toContain(secret)
  })

  it('keeps Base URL diagnostics actionable instead of turning them into generic network errors', () => {
    const diagnostic = providerDiagnostic(new ApiError(400, 'Base URL غير صالح', 'invalid_provider_url'), 'openai-compatible', Date.now())
    expect(diagnostic.category).toBe('endpoint')
    expect(diagnostic.code).toBe('invalid_provider_url')
  })

  it('enforces the ephemeral limit by IP even when the request fingerprint changes', async () => {
    const request = { headers: { 'x-forwarded-for': '203.0.113.77' } } as any
    resetSessionRateLimitsForTests()
    await enforceSessionRateLimit(request, 'test', 1, 60, ['key-a'])
    await expect(enforceSessionRateLimit(request, 'test', 1, 60, ['key-b'])).rejects.toMatchObject({ code: 'rate_limited' })
    resetSessionRateLimitsForTests()
  })

  it('uses irreversible stable fingerprints without retaining the session key', () => {
    process.env.ENCRYPTION_KEY = 'production-test-encryption-key-32-bytes-minimum'
    const secret = 'provider-key-that-must-never-be-persisted'
    const first = sessionRateLimitFingerprints('provider_test_session', '203.0.113.4', ['custom', secret])
    const second = sessionRateLimitFingerprints('provider_test_session', '203.0.113.4', ['custom', secret])
    expect(first).toEqual(second)
    expect(first).toHaveLength(2)
    expect(JSON.stringify(first)).not.toContain(secret)
    delete process.env.ENCRYPTION_KEY
  })
})
