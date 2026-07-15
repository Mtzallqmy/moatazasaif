import { z } from 'zod'

const emptyToUndefined = (value: unknown) => typeof value === 'string' && value.trim() === '' ? undefined : value
const optionalUrl = z.preprocess(emptyToUndefined, z.string().url().optional())
const optionalKey = z.preprocess(emptyToUndefined, z.string().min(20).optional())
const optionalPassword = z.preprocess(emptyToUndefined, z.string().min(8).optional())
const optionalToken = z.preprocess(emptyToUndefined, z.string().min(24).optional())

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value !== 'string') return value
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}, z.boolean())

const rawSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SUPABASE_URL: optionalUrl,
  VITE_SUPABASE_URL: optionalUrl,
  SUPABASE_PUBLISHABLE_KEY: optionalKey,
  SUPABASE_ANON_KEY: optionalKey,
  VITE_SUPABASE_PUBLISHABLE_KEY: optionalKey,
  VITE_SUPABASE_ANON_KEY: optionalKey,
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  ENCRYPTION_KEY: z.string().min(32),
  ALLOW_PUBLIC_SIGNUP: booleanFromEnv.default(false),
  ALLOW_INSECURE_PROVIDER_URLS: booleanFromEnv.default(false),
  BOOTSTRAP_OWNER_EMAIL: z.string().email().default('mtzallqmy@gmail.com'),
  BOOTSTRAP_OWNER_PASSWORD: optionalPassword,
  BOOTSTRAP_TOKEN: optionalToken,
  USERNAME_EMAIL_DOMAIN: z.string().regex(/^[a-z0-9.-]+$/i).default('users.moataz.invalid'),
  APP_URL: optionalUrl,
  PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(120_000).default(45_000),
  PROVIDER_MAX_RESPONSE_BYTES: z.coerce.number().int().min(64_000).max(20_000_000).default(5_000_000),
  PROVIDER_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(1).max(32_768).default(4_096),
  TELEGRAM_API_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(30_000).default(15_000),
  TELEGRAM_WEBHOOK_PROCESSING_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(55_000).default(45_000),
  TELEGRAM_MAX_CONTEXT_MESSAGES: z.coerce.number().int().min(1).max(50).default(20),
  TELEGRAM_MAX_RESPONSE_CHARACTERS: z.coerce.number().int().min(4_096).max(40_000).default(16_000),
})

const providerRuntimeSchema = rawSchema.pick({
  NODE_ENV: true,
  ALLOW_INSECURE_PROVIDER_URLS: true,
  APP_URL: true,
  PROVIDER_TIMEOUT_MS: true,
  PROVIDER_MAX_RESPONSE_BYTES: true,
  PROVIDER_MAX_OUTPUT_TOKENS: true,
})

const telegramRuntimeSchema = rawSchema.pick({
  APP_URL: true,
  TELEGRAM_API_TIMEOUT_MS: true,
  TELEGRAM_WEBHOOK_PROCESSING_TIMEOUT_MS: true,
  TELEGRAM_MAX_CONTEXT_MESSAGES: true,
  TELEGRAM_MAX_RESPONSE_CHARACTERS: true,
})

export type ServerEnv = z.infer<typeof rawSchema> & {
  supabaseUrl: string
  supabasePublishableKey: string
}

let cached: ServerEnv | undefined
let providerRuntimeCached: z.infer<typeof providerRuntimeSchema> | undefined
let telegramRuntimeCached: z.infer<typeof telegramRuntimeSchema> | undefined

/** Runtime settings used by session BYOK. This deliberately has no Supabase dependency. */
export function getProviderRuntimeEnv() {
  if (providerRuntimeCached) return providerRuntimeCached
  const parsed = providerRuntimeSchema.safeParse(process.env)
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join('.') || 'environment').join(', ')
    throw new Error(`إعدادات تشغيل المزود غير صالحة: ${fields}`)
  }
  providerRuntimeCached = parsed.data
  return providerRuntimeCached
}

export function getServerEnv(): ServerEnv {
  if (cached) return cached

  const parsed = rawSchema.safeParse(process.env)
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join('.') || 'environment').join(', ')
    throw new Error(`متغيرات الخادم غير مكتملة أو غير صالحة: ${fields}`)
  }

  const supabaseUrl = parsed.data.SUPABASE_URL || parsed.data.VITE_SUPABASE_URL
  const supabasePublishableKey = parsed.data.SUPABASE_PUBLISHABLE_KEY
    || parsed.data.SUPABASE_ANON_KEY
    || parsed.data.VITE_SUPABASE_PUBLISHABLE_KEY
    || parsed.data.VITE_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error('إعدادات Supabase الخلفية غير مكتملة: SUPABASE_URL وSUPABASE_PUBLISHABLE_KEY مطلوبان')
  }

  cached = { ...parsed.data, supabaseUrl, supabasePublishableKey }
  return cached
}

export function getTelegramRuntimeEnv() {
  if (telegramRuntimeCached) return telegramRuntimeCached
  const parsed = telegramRuntimeSchema.safeParse(process.env)
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join('.') || 'environment').join(', ')
    throw new Error(`إعدادات Telegram غير صالحة: ${fields}`)
  }
  telegramRuntimeCached = parsed.data
  return telegramRuntimeCached
}

export function getTelegramWebhookUrl() {
  // APP_URL remains the preferred explicit configuration. The production
  // alias is a safe fallback so a newly connected bot cannot silently fail
  // just because a Vercel environment variable was omitted. Preview/custom
  // domains should still set APP_URL explicitly.
  const appUrl = getTelegramRuntimeEnv().APP_URL
    || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined)
    || 'https://moatazasaif.vercel.app'
  const url = new URL('/api/integrations/telegram/webhook', appUrl)
  if (url.protocol !== 'https:') throw new Error('APP_URL يجب أن يستخدم HTTPS لتسجيل Telegram Webhook')
  return url.toString()
}

export function resetEnvCacheForTests() {
  cached = undefined
  providerRuntimeCached = undefined
  telegramRuntimeCached = undefined
}
