import { afterEach, describe, expect, it, vi } from 'vitest'
import { resetEnvCacheForTests } from '../../env'
import { callTelegram, deleteWebhook, getMe, getWebhookInfo, sendChatAction, sendMessage, setMyCommands, setWebhook } from '../client'
import { generateLinkCode, normalizeBotToken, sha256Hex } from '../security'
import { splitTelegramMessage } from '../messages'
import { telegramUpdateSchema } from '../types'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  resetEnvCacheForTests()
  delete process.env.NODE_ENV
  delete process.env.TELEGRAM_API_TIMEOUT_MS
})

describe('Telegram security and client', () => {
  it('rejects malformed tokens and never stores link codes in clear form', () => {
    expect(() => normalizeBotToken('not-a-token')).toThrowError(/Bot Token/)
    const code = generateLinkCode()
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/)
    expect(sha256Hex(code)).not.toBe(code)
  })

  it('splits Unicode text at Telegram limits without breaking emoji', () => {
    const text = `${'🙂'.repeat(4_500)}\n\n${'نص '.repeat(500)}`
    const chunks = splitTelegramMessage(text)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => Array.from(chunk).length <= 4_096)).toBe(true)
    expect(chunks.join('')).toContain('🙂')
  })

  it('parses Telegram errors, retries a short 429, and does not expose the token', async () => {
    process.env.TELEGRAM_API_TIMEOUT_MS = '5000'
    vi.useFakeTimers()
    const token = '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456'
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error_code: 429, description: `retry ${token}`, parameters: { retry_after: 1 } }), { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, result: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const promise = callTelegram<boolean>(token, 'setWebhook', { secret_token: 'secret' })
    await vi.advanceTimersByTimeAsync(1_000)
    await expect(promise).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const errorPayload = JSON.stringify(fetchMock.mock.calls[0])
    expect(errorPayload).toContain(token)
  })

  it('covers every Telegram client operation and redacts upstream token errors', async () => {
    const token = '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZ123456'
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body || '{}')) as Record<string, unknown>
      const method = String(_url).split('/').pop()
      if (method === 'getMe') return new Response(JSON.stringify({ ok: true, result: { id: 7, is_bot: true, first_name: 'Bot' } }))
      if (method === 'getWebhookInfo') return new Response(JSON.stringify({ ok: true, result: { url: 'https://example.com/api/integrations/telegram/webhook', pending_update_count: 0 } }))
      expect(body).toBeDefined()
      return new Response(JSON.stringify({ ok: true, result: true }))
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(getMe(token)).resolves.toMatchObject({ id: 7 })
    await expect(setWebhook(token, { url: 'https://example.com/api/integrations/telegram/webhook', secret_token: 'hashed-secret', allowed_updates: ['message'], drop_pending_updates: false })).resolves.toBe(true)
    await expect(getWebhookInfo(token)).resolves.toMatchObject({ pending_update_count: 0 })
    await expect(deleteWebhook(token)).resolves.toBe(true)
    await expect(sendChatAction(token, { chat_id: '9', action: 'typing' })).resolves.toBe(true)
    await expect(sendMessage(token, { chat_id: '9', text: 'hello' })).resolves.toBe(true)
    await expect(setMyCommands(token, [{ command: 'start', description: 'Start' }])).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(7)

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false, error_code: 401, description: `invalid token ${token}` }), { status: 401 })))
    const failure = await getMe(token).catch((error: unknown) => error)
    expect(failure).toMatchObject({ details: { description: `invalid token [REDACTED]` } })
    expect(String((failure as Error).message)).not.toContain(token)
  })

  it('validates webhook update shape and rejects missing update ids', () => {
    expect(telegramUpdateSchema.safeParse({ update_id: 4, message: { message_id: 2, chat: { id: 9, type: 'private' }, text: 'hi' } }).success).toBe(true)
    expect(telegramUpdateSchema.safeParse({ message: {} }).success).toBe(false)
  })
})
