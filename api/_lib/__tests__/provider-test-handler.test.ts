import { afterEach, describe, expect, it, vi } from 'vitest'
import handler from '../../providers/test'
import type { VercelRequest, VercelResponse } from '../vercel'
import { resetEnvCacheForTests } from '../env'

function responseMock() {
  const state: any = { headers: {}, statusCode: 200, body: undefined, ended: false }
  const response: any = {
    ...state,
    setHeader: (key: string, value: unknown) => { state.headers[key] = value },
    status: (code: number) => { state.statusCode = code; return response },
    json: (body: unknown) => { state.body = body; state.ended = true; return response },
    end: () => { state.ended = true; return response },
    write: vi.fn(),
    get writableEnded() { return state.ended },
    get destroyed() { return false },
  }
  return { response: response as VercelResponse, state }
}

function request(body: unknown) {
  return { method: 'POST', headers: { 'x-forwarded-for': '203.0.113.20' }, body } as unknown as VercelRequest
}

afterEach(() => { vi.unstubAllGlobals(); resetEnvCacheForTests(); for (const key of ['NODE_ENV', 'ALLOW_INSECURE_PROVIDER_URLS', 'PROVIDER_TIMEOUT_MS']) delete process.env[key] })

describe('POST /api/providers/test session mode', () => {
  it('tests a real ephemeral provider without initializing Supabase or persisting its key', async () => {
    process.env.NODE_ENV = 'test'
    process.env.ALLOW_INSECURE_PROVIDER_URLS = 'true'
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect((init?.headers as Record<string, string>).Authorization).toContain('Bearer')
      return new Response(JSON.stringify({ data: [{ id: 'model-a' }] }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { response, state } = responseMock()
    await handler(request({ credentialMode: 'session', provider: { type: 'openai-compatible', baseUrl: 'http://localhost/v1', apiKey: 'temporary-secret-key' } }), response)
    expect(state.statusCode).toBe(200)
    expect(state.body.success).toBe(true)
    expect(state.body.models).toEqual(['model-a'])
    expect(JSON.stringify(state.body)).not.toContain('temporary-secret-key')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
