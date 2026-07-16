import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveProviderProtocol } from '../../shared/provider-registry.js'
import { decryptSecret } from './crypto.js'
import { getProviderRuntimeEnv } from './env.js'
import { ApiError } from './http.js'
import { logTechnicalError, redactText } from './redaction.js'
import type { ProviderRecord } from './provider-runtime.js'
import type { ProviderChatMessage } from './providers/types.js'

interface PlatformReservation {
  reservationId: string
  providerId: string
  reservedTokens: number
  requestsUsed: number
  requestsLimit: number
  tokensUsed: number
  tokensReserved: number
  tokensLimit: number
  resetAt: string
}

function asObject(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {}
}

function utcResetAt() {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString()
}

export function estimatePlatformTokens(messages: ProviderChatMessage[]) {
  let estimate = getProviderRuntimeEnv().PROVIDER_MAX_OUTPUT_TOKENS
  for (const message of messages) {
    estimate += Buffer.byteLength(message.content, 'utf8')
    for (const attachment of message.attachments || []) {
      estimate += attachment.type === 'image' ? 8_000 : Buffer.byteLength(attachment.text, 'utf8')
    }
  }
  return Math.max(1, Math.min(5_000_000, estimate))
}

export async function reservePlatformUsage(admin: SupabaseClient, userId: string, estimatedTokens: number): Promise<PlatformReservation> {
  const { data, error } = await admin.rpc('reserve_platform_provider_usage', {
    p_user_id: userId,
    p_estimated_tokens: estimatedTokens,
  })
  if (error) {
    logTechnicalError('[platform-usage-reserve-failed]', error, { userId })
    throw new ApiError(503, 'تعذر التحقق من حصة مزود المنصة', 'platform_quota_unavailable')
  }
  const result = asObject(data)
  if (!result.allowed) {
    if (result.reason === 'provider_unavailable') {
      throw new ApiError(503, 'مزود المنصة الافتراضي غير متاح حاليًا', 'platform_provider_unavailable')
    }
    if (result.reason === 'user_unavailable') {
      throw new ApiError(403, 'الحساب غير متاح لاستخدام مزود المنصة', 'platform_user_unavailable')
    }
    throw new ApiError(429, result.reason === 'request_limit'
      ? 'تم استهلاك عدد طلبات مزود المنصة لهذا اليوم'
      : 'تم استهلاك حصة رموز مزود المنصة لهذا اليوم', 'platform_quota_exceeded', {
      reason: result.reason,
      requestsUsed: result.requestsUsed,
      requestsLimit: result.requestsLimit,
      tokensUsed: Number(result.tokensUsed || 0) + Number(result.tokensReserved || 0),
      tokensLimit: result.tokensLimit,
      resetAt: result.resetAt,
    })
  }
  if (!result.reservationId || !result.providerId) throw new ApiError(503, 'استجابة حصة مزود المنصة غير مكتملة', 'platform_quota_invalid')
  return {
    reservationId: String(result.reservationId),
    providerId: String(result.providerId),
    reservedTokens: Number(result.reservedTokens || estimatedTokens),
    requestsUsed: Number(result.requestsUsed || 0),
    requestsLimit: Number(result.requestsLimit || 0),
    tokensUsed: Number(result.tokensUsed || 0),
    tokensReserved: Number(result.tokensReserved || 0),
    tokensLimit: Number(result.tokensLimit || 0),
    resetAt: String(result.resetAt || utcResetAt()),
  }
}

export async function finalizePlatformUsage(
  admin: SupabaseClient,
  reservationId: string,
  actualTokens: number,
  chargeReservedOnZero: boolean,
) {
  const { data, error } = await admin.rpc('finalize_platform_provider_usage', {
    p_reservation_id: reservationId,
    p_actual_tokens: Math.max(0, Math.min(100_000_000, Math.trunc(actualTokens || 0))),
    p_charge_reserved_on_zero: chargeReservedOnZero,
  })
  if (error || !asObject(data).finalized) {
    logTechnicalError('[platform-usage-finalize-failed]', error || data, { reservationId })
    return false
  }
  return true
}

export async function loadPlatformProviderCredentials(admin: SupabaseClient, providerId: string) {
  const { data: provider, error } = await admin
    .from('providers')
    .select('id,user_id,name,type,protocol,base_url,model,encrypted_key,is_enabled,status,models')
    .eq('id', providerId)
    .eq('is_platform_shared', true)
    .eq('is_platform_default', true)
    .eq('is_enabled', true)
    .eq('status', 'connected')
    .maybeSingle()
  if (error) throw new ApiError(500, 'تعذر قراءة مزود المنصة', 'platform_provider_read_failed')
  if (!provider || !provider.model) throw new ApiError(503, 'مزود المنصة غير متاح حاليًا', 'platform_provider_unavailable')
  return { provider: provider as ProviderRecord, apiKey: decryptSecret(provider.encrypted_key) }
}

export async function getPlatformProviderSummary(admin: SupabaseClient, userId: string) {
  const { data: provider, error } = await admin
    .from('providers')
    .select('id,user_id,name,type,protocol,base_url,model,models,platform_daily_request_limit,platform_daily_token_limit')
    .eq('is_platform_shared', true)
    .eq('is_platform_default', true)
    .eq('is_enabled', true)
    .eq('status', 'connected')
    .maybeSingle()
  if (error) throw new ApiError(500, 'تعذر قراءة مزود المنصة', 'platform_provider_read_failed')
  if (!provider?.model) return { provider: null, usage: null }

  const { data: ownerProfile } = await admin.from('profiles').select('role,is_active').eq('id', provider.user_id).maybeSingle()
  if (!ownerProfile || ownerProfile.role !== 'owner' || !ownerProfile.is_active) return { provider: null, usage: null }

  const today = new Date().toISOString().slice(0, 10)
  const { data: usage, error: usageError } = await admin
    .from('platform_provider_usage')
    .select('request_count,token_count,reserved_tokens')
    .eq('user_id', userId)
    .eq('provider_id', provider.id)
    .eq('usage_date', today)
    .maybeSingle()
  if (usageError) throw new ApiError(500, 'تعذر قراءة استهلاك مزود المنصة', 'platform_usage_read_failed')

  return {
    provider: {
      id: 'platform',
      name: redactText(provider.name, [], 200),
      type: provider.type,
      protocol: provider.protocol || resolveProviderProtocol(provider.type, undefined, provider.base_url),
      model: provider.model,
      models: Array.isArray(provider.models) ? provider.models.map((model: unknown) => redactText(String(model), [], 300)).slice(0, 1_000) : [],
      status: 'connected',
      isEnabled: true,
      credentialMode: 'platform',
    },
    usage: {
      requestsUsed: Number(usage?.request_count || 0),
      requestsLimit: Number(provider.platform_daily_request_limit),
      tokensUsed: Number(usage?.token_count || 0) + Number(usage?.reserved_tokens || 0),
      tokensLimit: Number(provider.platform_daily_token_limit),
      resetAt: utcResetAt(),
    },
  }
}

export async function configurePlatformProvider(
  admin: SupabaseClient,
  actorId: string,
  input: { providerId: string; isShared?: boolean; isDefault?: boolean; dailyRequestLimit?: number; dailyTokenLimit?: number },
) {
  const { data, error } = await admin.rpc('configure_platform_provider', {
    p_actor_id: actorId,
    p_provider_id: input.providerId,
    p_is_shared: input.isShared ?? null,
    p_is_default: input.isDefault ?? null,
    p_daily_request_limit: input.dailyRequestLimit ?? null,
    p_daily_token_limit: input.dailyTokenLimit ?? null,
  })
  if (error) {
    const status = error.code === '42501' ? 403 : error.code === 'P0002' ? 404 : error.code === '23505' ? 409 : 400
    throw new ApiError(status, status === 403
      ? 'المالك فقط يستطيع ضبط مزود المنصة'
      : status === 404
        ? 'المزود غير موجود أو ليس مملوكًا لك'
        : 'تعذر ضبط مزود المنصة؛ يجب أن يكون متصلًا ومفعّلًا وله نموذج', 'platform_provider_config_failed')
  }
  return asObject(data)
}
