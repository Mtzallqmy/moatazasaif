import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveProviderBaseUrl, resolveProviderProtocol } from '../../shared/provider-registry'
import { decryptSecret } from './crypto'
import { ApiError } from './http'
import type { EphemeralProviderConfig } from './provider-schemas'
import type { ProviderRecord } from './provider-runtime'

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
    .select('id,name,type,protocol,base_url,model,encrypted_key,is_enabled,status,models')
    .eq('id', providerId)
    .eq('user_id', userId)
  if (options.requireEnabled) query = query.eq('is_enabled', true)
  if (options.requireConnected) query = query.eq('status', 'connected')

  const { data: provider, error } = await query.maybeSingle()
  if (error) throw new ApiError(500, 'تعذر قراءة المزود', 'provider_read_failed')
  if (!provider) throw new ApiError(404, options.requireConnected ? 'المزود غير موجود أو غير مختبر بنجاح' : options.requireEnabled ? 'المزود غير موجود أو غير مفعّل' : 'المزود غير موجود', 'provider_not_found')

  // Deliberately decrypt only after the ownership query above succeeds.
  const decrypt = options.decrypt || decryptSecret
  return { provider: provider as ProviderRecord, apiKey: decrypt(provider.encrypted_key) }
}
