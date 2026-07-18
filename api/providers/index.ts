import type { VercelRequest, VercelResponse } from '../_lib/vercel.js'
import { authenticate, getAdminClient } from '../_lib/supabase.js'
import { encryptSecret } from '../_lib/crypto.js'
import { ApiError, methodNotAllowed, sendError, setJsonHeaders } from '../_lib/http.js'
import { assertSafeProviderUrl, canonicalProviderModel } from '../_lib/provider-runtime.js'
import { enforceRateLimit } from '../_lib/rate-limit.js'
import { parseRequest, providerCreateSchema, providerDeleteSchema, providerPatchSchema } from '../_lib/provider-schemas.js'
import { getProviderDefinition, resolveProviderBaseUrl, resolveProviderProtocol } from '../../shared/provider-registry.js'
import { logTechnicalError, redactText, redactUnknown } from '../_lib/redaction.js'

export function publicProvider(provider: any) {
  return {
    id: provider.id,
    name: provider.name,
    type: provider.type,
    protocol: provider.protocol || resolveProviderProtocol(provider.type, undefined, provider.base_url),
    baseUrl: provider.base_url || undefined,
    model: provider.model || undefined,
    isEnabled: provider.is_enabled !== false,
    lastTested: provider.last_tested_at || undefined,
    status: provider.status || 'untested',
    errorMessage: provider.error_message ? redactText(String(provider.error_message)) : undefined,
    models: Array.isArray(provider.models) ? provider.models.map((model: unknown) => redactText(String(model), [], 1_000)) : [],
    detectedProtocol: provider.detected_protocol || undefined,
    diagnostic: provider.diagnostic ? redactUnknown(provider.diagnostic) : undefined,
    lastLatencyMs: provider.last_latency_ms ?? undefined,
    lastHttpStatus: provider.last_http_status ?? undefined,
    isPlatformShared: provider.is_platform_shared === true,
    isPlatformDefault: provider.is_platform_default === true,
    platformDailyRequestLimit: provider.platform_daily_request_limit ?? undefined,
    platformDailyTokenLimit: provider.platform_daily_token_limit ?? undefined,
    priority: provider.priority ?? 100,
    timeout: provider.timeout_ms ?? 45_000,
    retries: provider.retries ?? 2,
    maxConnections: provider.max_connections ?? 4,
    healthStatus: provider.health_status || 'unknown',
    latency: provider.latency_ms ?? provider.last_latency_ms ?? null,
    lastCheck: provider.last_check_at || provider.last_tested_at || undefined,
    errorCount: provider.error_count ?? 0,
    successCount: provider.success_count ?? 0,
    availability: provider.availability ?? 1,
    lastError: provider.last_error_code || provider.last_error_message ? { code: provider.last_error_code || undefined, message: provider.last_error_message ? redactText(String(provider.last_error_message)) : undefined } : undefined,
    circuit: { state: provider.circuit_state || 'closed', failures: provider.circuit_failures ?? 0, nextRetryAt: provider.circuit_next_retry_at || undefined },
    tags: Array.isArray(provider.tags) ? provider.tags : [],
    capabilities: provider.capabilities && typeof provider.capabilities === 'object' ? provider.capabilities : {},
    createdAt: provider.created_at,
    updatedAt: provider.updated_at,
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setJsonHeaders(res)
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method || '')) return methodNotAllowed(res, ['GET', 'POST', 'PATCH', 'DELETE'])

  try {
    const { user } = await authenticate(req)
    await enforceRateLimit(req, req.method === 'GET' ? 'providers_read' : 'providers_write', req.method === 'GET' ? 120 : 40, req.method === 'GET' ? 60 : 300, user.id)
    const admin = getAdminClient()

    if (req.method === 'GET') {
      const initial = await admin.from('providers').select('id,name,type,protocol,base_url,model,is_enabled,last_tested_at,status,error_message,models,detected_protocol,diagnostic,last_latency_ms,last_http_status,is_platform_shared,is_platform_default,platform_daily_request_limit,platform_daily_token_limit,priority,timeout_ms,retries,max_connections,health_status,latency_ms,last_check_at,error_count,success_count,availability,last_error_code,last_error_message,circuit_state,circuit_failures,circuit_next_retry_at,tags,capabilities,created_at,updated_at').eq('user_id', user.id).order('priority', { ascending: true }).order('created_at', { ascending: false })
      let data = initial.data as Array<Record<string, unknown>> | null
      let error = initial.error
      if (error && /column|schema cache/i.test(error.message || '')) {
        const fallback = await admin.from('providers').select('id,name,type,protocol,base_url,model,is_enabled,last_tested_at,status,error_message,models,detected_protocol,diagnostic,last_latency_ms,last_http_status,is_platform_shared,is_platform_default,platform_daily_request_limit,platform_daily_token_limit,created_at,updated_at').eq('user_id', user.id).order('created_at', { ascending: false })
        data = fallback.data as Array<Record<string, unknown>> | null
        error = fallback.error
      }
      if (error) throw new ApiError(500, 'تعذر تحميل المزودات', 'providers_read_failed')
      return res.status(200).json({ providers: (data || []).map(publicProvider) })
    }

    if (req.method === 'DELETE') {
      const { id } = parseRequest(providerDeleteSchema, req.body)
      const { error } = await admin.from('providers').delete().eq('id', id).eq('user_id', user.id)
      if (error) throw new ApiError(500, 'تعذر حذف المزود', 'provider_delete_failed')
      return res.status(204).end()
    }

    if (req.method === 'PATCH') {
      const body = parseRequest(providerPatchSchema, req.body)
      const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (body.apiKey !== undefined) {
        update.encrypted_key = encryptSecret(body.apiKey)
        update.status = 'untested'
        update.health_status = 'unknown'
        update.error_message = null
        update.diagnostic = null
        update.circuit_state = 'closed'
        update.circuit_failures = 0
        update.circuit_opened_at = null
        update.circuit_next_retry_at = null
      }
      if (body.model !== undefined) {
        if (!body.model) update.model = null
        else {
          const { data: current, error: currentError } = await admin.from('providers').select('type,base_url').eq('id', body.id).eq('user_id', user.id).maybeSingle()
          if (currentError) throw new ApiError(500, 'تعذر قراءة المزود', 'provider_read_failed')
          if (!current) throw new ApiError(404, 'المزود غير موجود', 'provider_not_found')
          update.model = canonicalProviderModel({ type: current.type, base_url: current.base_url }, body.model)
        }
      }
      if (body.isEnabled !== undefined) update.is_enabled = body.isEnabled
      if (body.priority !== undefined) update.priority = body.priority
      if (body.timeout !== undefined) update.timeout_ms = body.timeout
      if (body.retries !== undefined) update.retries = body.retries
      if (body.maxConnections !== undefined) update.max_connections = body.maxConnections
      if (body.tags !== undefined) update.tags = body.tags
      if (body.name !== undefined) update.name = body.name
      if (body.protocol !== undefined) {
        // A built-in provider has one canonical protocol. Only custom rows
        // may switch protocol; this keeps the DB contract aligned with the
        // central registry instead of allowing a mismatched runtime adapter.
        const { data: current, error: currentError } = await admin
          .from('providers')
          .select('id,type')
          .eq('id', body.id)
          .eq('user_id', user.id)
          .maybeSingle()
        if (currentError) throw new ApiError(500, 'تعذر قراءة المزود', 'provider_read_failed')
        if (!current) throw new ApiError(404, 'المزود غير موجود', 'provider_not_found')
        const definition = getProviderDefinition(current.type)
        if (definition && current.type !== 'custom' && body.protocol !== definition.protocol) {
          throw new ApiError(400, 'لا يمكن تغيير بروتوكول مزود مدمج', 'provider_protocol_mismatch')
        }
        update.protocol = body.protocol
      }
      if (body.baseUrl) {
        await assertSafeProviderUrl(body.baseUrl)
        update.base_url = body.baseUrl.replace(/\/+$/, '')
      }
      const { data, error } = await admin.from('providers').update(update).eq('id', body.id).eq('user_id', user.id).select('*').maybeSingle()
      if (error) throw new ApiError(500, 'تعذر تحديث المزود', 'provider_update_failed')
      if (!data) throw new ApiError(404, 'المزود غير موجود', 'provider_not_found')
      return res.status(200).json({ provider: publicProvider(data) })
    }

    const body = parseRequest(providerCreateSchema, req.body)
    const baseUrl = resolveProviderBaseUrl(body.type, body.baseUrl)
    await assertSafeProviderUrl(baseUrl)
    const protocol = resolveProviderProtocol(body.type, body.protocol, baseUrl)
    const model = body.model ? canonicalProviderModel({ type: body.type, base_url: baseUrl }, body.model) : null
    const now = new Date().toISOString()
    const { data, error } = await admin.from('providers').insert({
      user_id: user.id,
      name: body.name,
      type: body.type,
      protocol,
      base_url: baseUrl,
      model,
      encrypted_key: encryptSecret(body.apiKey),
      is_enabled: true,
      status: 'untested',
      models: [],
      diagnostic: null,
      created_at: now,
      updated_at: now,
    }).select('*').single()
    if (error) {
      logTechnicalError('[provider-create-failed]', error, { userId: user.id, type: body.type })
      throw new ApiError(500, 'تعذر حفظ المزود', 'provider_create_failed')
    }
    return res.status(201).json({ provider: publicProvider(data) })
  } catch (error) {
    return sendError(res, error)
  }
}
