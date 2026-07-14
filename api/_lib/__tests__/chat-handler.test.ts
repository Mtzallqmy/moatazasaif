import { afterEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import handler from '../../chat.js'
import type { VercelRequest, VercelResponse } from '../vercel.js'
import { resetEnvCacheForTests } from '../env.js'

function responseMock() {
  const state: any = { headers: {}, statusCode: 200, chunks: [] as string[], ended: false }
  const emitter = new EventEmitter()
  const response: any = Object.assign(emitter, {
    setHeader: (key: string, value: unknown) => { state.headers[key] = value },
    status: (code: number) => { state.statusCode = code; return response },
    json: (body: unknown) => { state.body = body; state.ended = true; return response },
    end: () => { state.ended = true; return response },
    write: (chunk: string) => { state.chunks.push(String(chunk)); return true },
  })
  Object.defineProperties(response, {
    writableEnded: { get: () => state.ended },
    destroyed: { get: () => false },
  })
  return { response: response as VercelResponse, state }
}

function request(body: unknown) {
  const emitter = new EventEmitter()
  return Object.assign(emitter, {
    method: 'POST', headers: { 'x-forwarded-for': '203.0.113.25' }, body,
  }) as unknown as VercelRequest
}

afterEach(() => {
  vi.unstubAllGlobals()
  resetEnvCacheForTests()
  for (const key of ['NODE_ENV', 'ALLOW_INSECURE_PROVIDER_URLS', 'PROVIDER_TIMEOUT_MS']) delete process.env[key]
})

describe('POST /api/chat session mode', () => {
  it('streams a real OpenAI-compatible response without Supabase or exposing the key', async () => {
    process.env.NODE_ENV = 'test'
    process.env.ALLOW_INSECURE_PROVIDER_URLS = 'true'
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>
      expect(headers.Authorization).toBe('Bearer temporary-secret-key')
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"hello"}}]}\n\n'))
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
          controller.close()
        },
      }), { status: 200, headers: { 'content-type': 'text/event-stream' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { response, state } = responseMock()
    await handler(request({
      credentialMode: 'session',
      provider: { type: 'openai-compatible', baseUrl: 'http://localhost/v1', apiKey: 'temporary-secret-key', model: 'model-a' },
      model: 'model-a', messages: [{ role: 'user', content: 'hi' }], stream: true,
    }), response)

    expect(state.statusCode).toBe(200)
    expect(state.ended).toBe(true)
    expect(state.chunks.join('')).toContain('event: delta')
    expect(state.chunks.join('')).toContain('"content":"hello"')
    expect(state.chunks.join('')).toContain('event: done')
    expect(state.chunks.join('')).not.toContain('temporary-secret-key')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
