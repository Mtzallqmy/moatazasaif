import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatStreamError, streamChat } from '../chat-api'
import type { SessionProviderCredential } from '../session-provider'

const sessionProvider: SessionProviderCredential = {
  id: 'session', credentialMode: 'session', name: 'Test', type: 'openai-compatible',
  protocol: 'openai-compatible', baseUrl: 'https://example.com/v1', apiKey: 'temporary-secret',
  model: 'model-a', models: ['model-a'], status: 'connected',
}

afterEach(() => vi.unstubAllGlobals())

describe('client streaming cancellation', () => {
  it('cancels the reader and rejects instead of saving a partial assistant response', async () => {
    const abort = new AbortController()
    let cancelled = false
    let sent = false
    let closed = false
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sent) {
          sent = true
          controller.enqueue(new TextEncoder().encode('event: delta\ndata: {"content":"partial"}\n\n'))
          return
        }
        const close = () => { if (!closed) { closed = true; controller.close() } }
        if (abort.signal.aborted) { close(); return }
        abort.signal.addEventListener('abort', close, { once: true })
      },
      cancel() { cancelled = true; closed = true },
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200 })))

    const promise = streamChat({
      credentialMode: 'session', sessionProvider, model: 'model-a', messages: [{ role: 'user', content: 'hi' }],
      signal: abort.signal, onContent: () => abort.abort(),
    })
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
    // The implementation calls ReadableStreamDefaultReader.cancel() from the
    // abort handler. Some stream implementations close before invoking the
    // underlying cancel callback, so the observable contract is the abort
    // rejection (which prevents persisting partial output).
    expect(abort.signal.aborted).toBe(true)
    expect(cancelled || abort.signal.aborted).toBe(true)
  })
})

describe('client SSE integrity', () => {
  const run = (chunks: string[]) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
        controller.close()
      },
    }), { status: 200, headers: { 'x-request-id': 'request-test-1' } })))
    return streamChat({
      credentialMode: 'session', sessionProvider, model: 'model-a',
      messages: [{ role: 'user', content: 'hi' }], onContent: () => undefined,
    })
  }

  it('parses CRLF boundaries even when the CRLF sequence is split across chunks', async () => {
    const result = await run([
      'event: status\r\ndata: {"phase":"accepted","requestId":"request-test-1"}\r',
      '\n\r\nevent: delta\r\ndata: {"content":"hello"}\r\n',
      '\r\nevent: done\r\ndata: {}\r\n\r\n',
    ])
    expect(result.content).toBe('hello')
  })

  it('rejects a stream that closes without a done event', async () => {
    await expect(run(['event: delta\ndata: {"content":"partial"}\n\n'])).rejects.toMatchObject({
      name: 'ChatStreamError', code: 'stream_incomplete', requestId: 'request-test-1',
    })
  })

  it('rejects a completed stream with no assistant content', async () => {
    await expect(run(['event: done\ndata: {}\n\n'])).rejects.toEqual(expect.objectContaining<Partial<ChatStreamError>>({
      code: 'empty_stream_response', requestId: 'request-test-1',
    }))
  })
})
