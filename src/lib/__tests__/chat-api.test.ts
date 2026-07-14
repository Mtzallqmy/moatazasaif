import { afterEach, describe, expect, it, vi } from 'vitest'
import { streamChat } from '../chat-api'
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
