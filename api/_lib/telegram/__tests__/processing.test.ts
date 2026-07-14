import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const integration = {
    id: 'integration-1', user_id: 'user-1', name: 'Bot', bot_id: '123', bot_username: 'bot', bot_first_name: 'Bot',
    encrypted_bot_token: { ciphertext: 'x', iv: 'y', authTag: 'z' }, webhook_secret_hash: 'hash', provider_id: 'provider-1', model: 'model-a',
    is_enabled: true, status: 'connected', webhook_url: 'https://example.com/api/integrations/telegram/webhook', pending_update_count: 0,
    last_error_message: null, last_webhook_checked_at: null, last_update_at: null, created_at: '', updated_at: '',
  }
  const link = { id: 'link-1', integration_id: 'integration-1', telegram_chat_id: '55', telegram_user_id: '77', chat_type: 'private', is_allowed: true }
  const rows = [{ role: 'user', content: 'previous' }, { role: 'user', content: 'hello' }]
  const admin = {
    from(table: string) {
      const chain: any = {
        select: () => chain, update: () => chain, insert: () => chain, delete: () => chain,
        eq: () => chain, in: () => chain, order: () => chain, limit: async () => table === 'telegram_messages' ? { data: rows, error: null } : { data: [], error: null },
        maybeSingle: async () => table === 'telegram_integrations' ? { data: integration, error: null } : table === 'telegram_chat_links' ? { data: link, error: null } : { data: null, error: null },
        single: async () => ({ data: integration, error: null }),
      }
      return chain
    },
  }
  return {
    integration, admin, generateProviderText: vi.fn(async () => ({ content: 'real answer', usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 } })),
    loadOwnedProviderCredentials: vi.fn(async () => ({ provider: { id: 'provider-1', type: 'openai', protocol: 'openai-compatible', base_url: 'https://example.com/v1', model: 'model-a' }, apiKey: 'provider-secret' })),
    sendMessage: vi.fn(async () => ({})), sendChatAction: vi.fn(async () => true), enforceRateLimitKey: vi.fn(async () => ({ allowed: true })),
    recordAudit: vi.fn(async () => undefined), decryptSecret: vi.fn(() => 'telegram-secret'),
  }
})

vi.mock('../../supabase', () => ({ getAdminClient: () => mocks.admin }))
vi.mock('../../provider-runtime', () => ({ generateProviderText: mocks.generateProviderText }))
vi.mock('../../provider-credentials', () => ({ loadOwnedProviderCredentials: mocks.loadOwnedProviderCredentials }))
vi.mock('../../telegram/client', () => ({ sendMessage: mocks.sendMessage, sendChatAction: mocks.sendChatAction }))
vi.mock('../../rate-limit', () => ({ enforceRateLimitKey: mocks.enforceRateLimitKey }))
vi.mock('../../audit', () => ({ recordAudit: mocks.recordAudit }))
vi.mock('../../crypto', () => ({ decryptSecret: mocks.decryptSecret }))
vi.mock('../../env', () => ({ getTelegramRuntimeEnv: () => ({ TELEGRAM_MAX_CONTEXT_MESSAGES: 20, TELEGRAM_MAX_RESPONSE_CHARACTERS: 16_000, TELEGRAM_WEBHOOK_PROCESSING_TIMEOUT_MS: 45_000 }) }))

import { processTelegramUpdate } from '../service'

afterEach(() => vi.clearAllMocks())

describe('Telegram provider processing', () => {
  it('uses the saved provider adapter for a linked chat and sends the real response', async () => {
    await processTelegramUpdate('integration-1', 10, { update_id: 10, message: { message_id: 3, from: { id: 77, is_bot: false }, chat: { id: 55, type: 'private' }, text: 'hello' } })
    expect(mocks.loadOwnedProviderCredentials).toHaveBeenCalledWith(expect.anything(), 'user-1', 'provider-1', { requireEnabled: true, requireConnected: true })
    expect(mocks.generateProviderText).toHaveBeenCalledWith(expect.objectContaining({ id: 'provider-1' }), 'provider-secret', 'model-a', expect.arrayContaining([{ role: 'user', content: 'hello' }]), expect.any(AbortSignal))
    expect(mocks.sendMessage).toHaveBeenCalledWith('telegram-secret', { chat_id: '55', text: 'real answer' }, expect.any(AbortSignal))
    expect(mocks.recordAudit).toHaveBeenCalledWith('user-1', 'user-1', 'telegram.message.processed', expect.any(Object))
  })
})
