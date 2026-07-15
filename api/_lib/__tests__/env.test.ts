import { afterEach, describe, expect, it } from 'vitest'
import { getServerEnv, getTelegramWebhookUrl, resetEnvCacheForTests } from '../env.js'

const snapshot = { ...process.env }

afterEach(() => {
  for (const key of Object.keys(process.env)) delete process.env[key]
  Object.assign(process.env, snapshot)
  resetEnvCacheForTests()
})

describe('server environment', () => {
  it('accepts blank optional values and modern publishable keys', () => {
    Object.assign(process.env, {
      NODE_ENV: 'test',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-placeholder-1234567890',
      ENCRYPTION_KEY: '12345678901234567890123456789012',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_placeholder_1234567890',
      VITE_SUPABASE_ANON_KEY: '',
      BOOTSTRAP_TOKEN: '',
      BOOTSTRAP_OWNER_PASSWORD: '',
      APP_URL: '',
    })
    resetEnvCacheForTests()
    const env = getServerEnv()
    expect(env.supabasePublishableKey).toBe('sb_publishable_placeholder_1234567890')
    expect(env.BOOTSTRAP_TOKEN).toBeUndefined()
    expect(env.APP_URL).toBeUndefined()
  })

  it('uses the production alias for Telegram when APP_URL is omitted', () => {
    Object.assign(process.env, {
      NODE_ENV: 'test',
      APP_URL: '',
      TELEGRAM_API_TIMEOUT_MS: '15000',
      TELEGRAM_WEBHOOK_PROCESSING_TIMEOUT_MS: '45000',
      TELEGRAM_MAX_CONTEXT_MESSAGES: '20',
      TELEGRAM_MAX_RESPONSE_CHARACTERS: '16000',
    })
    resetEnvCacheForTests()
    expect(getTelegramWebhookUrl()).toBe('https://moatazasaif.vercel.app/api/integrations/telegram/webhook')
  })
})
