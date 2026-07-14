import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { VercelRequest, VercelResponse } from '../../vercel'

const mocks = vi.hoisted(() => ({
  findIntegrationByWebhookSecret: vi.fn(),
  saveReceivedTelegramUpdate: vi.fn(),
  processTelegramUpdate: vi.fn(),
  scheduleTelegramWork: vi.fn(),
}))

vi.mock('../service', () => mocks)
vi.mock('../background', () => ({ scheduleTelegramWork: mocks.scheduleTelegramWork }))

import handler from '../../../_handlers/telegram/webhook'

function responseMock() {
  const state: any = { headers: {}, statusCode: 200, body: undefined, ended: false }
  const response: any = Object.assign(new EventEmitter(), {
    setHeader: (key: string, value: unknown) => { state.headers[key] = value },
    status: (code: number) => { state.statusCode = code; return response },
    json: (body: unknown) => { state.body = body; state.ended = true; return response },
    end: () => { state.ended = true; return response },
  })
  return { response: response as VercelResponse, state }
}

function request(body: unknown, secret?: string) {
  return { method: 'POST', headers: secret ? { 'x-telegram-bot-api-secret-token': secret } : {}, body } as unknown as VercelRequest
}

afterEach(() => vi.clearAllMocks())

describe('Telegram webhook authentication and deduplication', () => {
  it('rejects missing or incorrect secrets', async () => {
    const first = responseMock()
    await handler(request({ update_id: 1 }), first.response)
    expect(first.state.statusCode).toBe(401)
    mocks.findIntegrationByWebhookSecret.mockResolvedValueOnce(null)
    const second = responseMock()
    await handler(request({ update_id: 1 }, 'wrong-secret'), second.response)
    expect(second.state.statusCode).toBe(401)
  })

  it('acknowledges a duplicate update without scheduling a second processing job', async () => {
    mocks.findIntegrationByWebhookSecret.mockResolvedValueOnce({ id: 'integration-1', is_enabled: true })
    mocks.saveReceivedTelegramUpdate.mockResolvedValueOnce(false)
    const result = responseMock()
    await handler(request({ update_id: 7, message: { message_id: 1, chat: { id: 8, type: 'private' }, text: 'hello' } }, 'valid-secret'), result.response)
    expect(result.state.statusCode).toBe(200)
    expect(mocks.scheduleTelegramWork).not.toHaveBeenCalled()
  })

  it('accepts a valid update and schedules bounded background processing', async () => {
    mocks.findIntegrationByWebhookSecret.mockResolvedValueOnce({ id: 'integration-1', is_enabled: true })
    mocks.saveReceivedTelegramUpdate.mockResolvedValueOnce(true)
    const result = responseMock()
    await handler(request({ update_id: 8, message: { message_id: 1, chat: { id: 8, type: 'private' }, text: 'hello' } }, 'valid-secret'), result.response)
    expect(result.state.statusCode).toBe(200)
    expect(mocks.scheduleTelegramWork).toHaveBeenCalledTimes(1)
    expect(mocks.processTelegramUpdate).toHaveBeenCalledWith('integration-1', 8, expect.objectContaining({ update_id: 8 }))
  })
})
