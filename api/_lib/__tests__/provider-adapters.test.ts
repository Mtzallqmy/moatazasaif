import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetEnvCacheForTests } from '../env.js'
import { anthropicAdapter } from '../providers/anthropic.js'
import { geminiAdapter } from '../providers/gemini.js'
import { openAiCompatibleAdapter } from '../providers/openai-compatible.js'
import type { ProviderConfig } from '../providers/types.js'

const base = { type: 'custom', baseUrl: 'http://localhost/v1', apiKey: 'temporary-secret-key', protocol: 'openai-compatible' as const }

afterEach(() => { vi.unstubAllGlobals(); resetEnvCacheForTests(); delete process.env.NODE_ENV; delete process.env.ALLOW_INSECURE_PROVIDER_URLS })

describe('native provider adapters', () => {
  it('uses Gemini endpoints and headers, not OpenAI chat completions', async () => {
    process.env.NODE_ENV = 'test'; process.env.ALLOW_INSECURE_PROVIDER_URLS = 'true'
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain('/models')
      expect((init?.headers as Record<string, string>)['x-goog-api-key']).toBe(base.apiKey)
      expect((init?.headers as Record<string, string>).Authorization).toBeUndefined()
      return new Response(JSON.stringify({ models: [{ name: 'models/gemini-2.0-flash', supportedGenerationMethods: ['generateContent'] }] }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const config: ProviderConfig = { ...base, protocol: 'gemini' }
    const result = await geminiAdapter.testConnection(config)
    expect(result.models).toEqual(['gemini-2.0-flash'])
    expect(fetchMock.mock.calls[0][0]).not.toContain('chat/completions')
  })

  it('uses Anthropic messages endpoints and native x-api-key auth', async () => {
    process.env.NODE_ENV = 'test'; process.env.ALLOW_INSECURE_PROVIDER_URLS = 'true'
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe('http://localhost/v1/models')
      const headers = init?.headers as Record<string, string>
      expect(headers['x-api-key']).toBe(base.apiKey)
      expect(headers.Authorization).toBeUndefined()
      return new Response(JSON.stringify({ data: [{ id: 'claude-3-5-sonnet' }] }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await anthropicAdapter.testConnection({ ...base, protocol: 'anthropic' })
    expect(result.models).toEqual(['claude-3-5-sonnet'])
  })

  it('tries a conventional /v1/models path when a root models path returns HTML', async () => {
    process.env.NODE_ENV = 'test'; process.env.ALLOW_INSECURE_PROVIDER_URLS = 'true'
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'http://localhost/models') return new Response('<!doctype html><html>challenge</html>', { status: 403, headers: { 'content-type': 'text/html' } })
      return new Response(JSON.stringify({ data: [{ id: 'free-model' }] }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await openAiCompatibleAdapter.listModels({ ...base, baseUrl: 'http://localhost' })
    expect(result.models).toEqual(['free-model'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][0]).toBe('http://localhost/v1/models')
  })

  it('streams OpenAI-compatible deltas and does not inject unsupported reasoning options', async () => {
    process.env.NODE_ENV = 'test'; process.env.ALLOW_INSECURE_PROVIDER_URLS = 'true'
    const bodyChunks = [
      'data: {"choices":[{"delta":{"content":"A"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"B"}}],"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}\n\n',
      'data: [DONE]\n\n',
    ]
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      expect(body.reasoning_effort).toBeUndefined()
      return new Response(new ReadableStream({
        pull(controller) { const next = bodyChunks.shift(); if (next) controller.enqueue(new TextEncoder().encode(next)); else controller.close() },
      }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const events: string[] = []
    for await (const event of openAiCompatibleAdapter.streamText(base, 'model-a', [{ role: 'user', content: 'hi' }])) if (event.event === 'delta') events.push(event.data.content)
    expect(events.join('')).toBe('AB')
  })

  it('retries with a minimal standards-compatible body when a model rejects optional tuning fields', async () => {
    process.env.NODE_ENV = 'test'; process.env.ALLOW_INSECURE_PROVIDER_URLS = 'true'
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body))
      if (body.temperature !== undefined || body.stream_options !== undefined) {
        return new Response(JSON.stringify({ error: { message: 'unsupported option', code: 'invalid_request' } }), { status: 400, headers: { 'content-type': 'application/json' } })
      }
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"works"}}]}\n\n'))
          controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'))
          controller.close()
        },
      }), { status: 200, headers: { 'content-type': 'text/event-stream' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const content: string[] = []
    for await (const event of openAiCompatibleAdapter.streamText(base, 'strict-model', [{ role: 'user', content: 'hi' }])) {
      if (event.event === 'delta') content.push(event.data.content)
    }
    expect(content.join('')).toBe('works')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('normalizes a JSON completion when an OpenAI-compatible gateway ignores stream mode', async () => {
    process.env.NODE_ENV = 'test'; process.env.ALLOW_INSECURE_PROVIDER_URLS = 'true'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: [{ type: 'text', text: 'JSON fallback' }] } }],
      usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 },
    }), { status: 200, headers: { 'content-type': 'application/json' } })))
    const events = []
    for await (const event of openAiCompatibleAdapter.streamText(base, 'json-model', [{ role: 'user', content: 'hi' }])) events.push(event)
    expect(events.find((event) => event.event === 'delta')?.data).toEqual({ content: 'JSON fallback' })
    expect(events.at(-1)?.event).toBe('done')
  })

  it('uses /v1/chat/completions when a gateway base URL points to its root', async () => {
    process.env.NODE_ENV = 'test'; process.env.ALLOW_INSECURE_PROVIDER_URLS = 'true'
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'http://localhost/chat/completions') return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: { 'content-type': 'application/json' } })
      return new Response(JSON.stringify({ choices: [{ message: { content: 'OK' } }], usage: { total_tokens: 2 } }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    const result = await openAiCompatibleAdapter.generateText({ ...base, baseUrl: 'http://localhost' }, 'model-a', [{ role: 'user', content: 'hi' }])
    expect(result.content).toBe('OK')
    expect(result.endpoint).toBe('http://localhost/v1/chat/completions')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
