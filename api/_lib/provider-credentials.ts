import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveProviderBaseUrl, resolveProviderProtocol } from '../../shared/provider-registry.js'
import { decryptSecret } from './crypto.js'
import { ApiError } from './http.js'
import type { EphemeralProviderConfig } from './provider-schemas.js'
import type { ProviderRecord } from './provider-runtime.js'
import type { ProviderManagerRecord } from './provider-manager.js'

type EncryptedSecret = { ciphertext: string; iv: string; authTag: string }

export function ephemeralProviderRecord(provider: EphemeralProviderConfig): ProviderRecord {
  return {
    id: 'session',
    name: provider.type,
    type: provider.type,
    protocol: resolveProviderProtocol(provider.type, provider.protocol, provider.baseUrl),
    base_url: resolveProviderBaseUrl(provider.type, provider.baseUrl),
    model: provider.model || null,
  }
}

export function ephemeralRateLimitParts(provider: EphemeralProviderConfig) {
  let host = 'invalid-host'
  try { host = new URL(resolveProviderBaseUrl(provider.type, provider.baseUrl)).hostname.toLowerCase() } catch { /* schema/runtime reports the URL error */ }
  return [provider.type, provider.protocol || '', host, provider.apiKey]
}

export async function loadOwnedProviderCredentials(
  admin: SupabaseClient,
  userId: string,
  providerId: string,
  options: { requireEnabled?: boolean; requireConnected?: boolean; decrypt?: typeof decryptSecret } = {},
) {
  let query = admin
    .from('providers')
    .select('id,name,type,protocol,base_url,model,encrypted_key,is_enabled,status,models,priority,timeout_ms,retries,max_connections,health_status,latency_ms,last_check_at,error_count,success_count,availability,last_error_code,last_error_message,circuit_state,circuit_failures,circuit_opened_at,circuit_next_retry_at,tags,capabilities')
    .eq('id', providerId)
    .eq('user_id', userId)
  if (options.requireEnabled) query = query.eq('is_enabled', true)
  if (options.requireConnected) query = query.eq('status', 'connected')

  const initial = await query.maybeSingle()
  type ProviderRow = Record<string, unknown> & { id: string; encrypted_key: unknown }
  let provider = initial.data as ProviderRow | null
  let error = initial.error
  if (error && /column|schema cache/i.test(error.message || '')) {
    let legacy = admin.from('providers').select('id,name,type,protocol,base_url,model,encrypted_key,is_enabled,status,models').eq('id', providerId).eq('user_id', userId)
    if (options.requireEnabled) legacy = legacy.eq('is_enabled', true)
    if (options.requireConnected) legacy = legacy.eq('status', 'connected')
    const fallback = await legacy.maybeSingle()
    provider = fallback.data as ProviderRow | null
    error = fallback.error
  }
  if (error) throw new ApiError(500, 'تعذر قراءة المزود', 'provider_read_failed')
  if (!provider) throw new ApiError(404, options.requireConnected ? 'المزود غير موجود أو غير مختبر بنجاح' : options.requireEnabled ? 'المزود غير موجود أو غير مفعّل' : 'المزود غير موجود', 'provider_not_found')

  // Deliberately decrypt only after the ownership query above succeeds.
  const decrypt = options.decrypt || decryptSecret
  return { provider: provider as unknown as ProviderManagerRecord, apiKey: decrypt(provider.encrypted_key as EncryptedSecret) }
}

/** Load failover candidates only after restricting the query to the owner. */
export async function loadOwnedProviderCredentialCandidates(
  admin: SupabaseClient,
  userId: string,
  requestedModel?: string,
) {
  const initial = await admin
    .from('providers')
    .select('id,name,type,protocol,base_url,model,encrypted_key,is_enabled,status,models,priority,timeout_ms,retries,max_connections,health_status,latency_ms,last_check_at,error_count,success_count,availability,last_error_code,last_error_message,circuit_state,circuit_failures,circuit_opened_at,circuit_next_retry_at,tags,capabilities')
    .eq('user_id', userId)
    .eq('is_enabled', true)
  type ProviderRow = Record<string, unknown> & { id: string; encrypted_key: unknown }
  let data = initial.data as ProviderRow[] | null
  let error = initial.error
  if (error && /column|schema cache/i.test(error.message || '')) {
    const fallback = await admin.from('providers').select('id,name,type,protocol,base_url,model,encrypted_key,is_enabled,status,models').eq('user_id', userId).eq('is_enabled', true)
    data = fallback.data as ProviderRow[] | null
    error = fallback.error
  }
  if (error) throw new ApiError(500, 'تعذر قراءة المزودات البديلة', 'provider_failover_read_failed')
  const model = requestedModel?.trim().toLowerCase()
  const candidates = (data || []).filter((row) => {
    if (!model) return true
    const models = Array.isArray(row.models) ? row.models.filter((item): item is string => typeof item === 'string') : []
    return typeof row.model !== 'string' || row.model.toLowerCase() === model || models.some((item) => item.toLowerCase() === model) || models.length === 0
  })
  return candidates.map((provider) => ({ provider: provider as unknown as ProviderManagerRecord, apiKey: decryptSecret(provider.encrypted_key as EncryptedSecret) }))
}
