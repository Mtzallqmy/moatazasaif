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
})
