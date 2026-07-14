import type { VercelRequest, VercelResponse } from '../_lib/vercel'
import { authenticate, getAdminClient } from '../_lib/supabase'
import { encryptSecret } from '../_lib/crypto'
import { ApiError, methodNotAllowed, sendError, setJsonHeaders } from '../_lib/http'
import { assertSafeProviderUrl } from '../_lib/provider-runtime'
import { enforceRateLimit } from '../_lib/rate-limit'
import { parseRequest, providerCreateSchema, providerDeleteSchema, providerPatchSchema } from '../_lib/provider-schemas'
import { getProviderDefinition, resolveProviderBaseUrl, resolveProviderProtocol } from '../../shared/provider-registry'
import { logTechnicalError, redactText, redactUnknown } from '../_lib/redaction'

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
      const { data, error } = await admin.from('providers').select('id,name,type,protocol,base_url,model,is_enabled,last_tested_at,status,error_message,models,detected_protocol,diagnostic,last_latency_ms,last_http_status,created_at,updated_at').eq('user_id', user.id).order('created_at', { ascending: false })
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
      if (body.model !== undefined) update.model = body.model || null
      if (body.isEnabled !== undefined) update.is_enabled = body.isEnabled
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
    const now = new Date().toISOString()
    const { data, error } = await admin.from('providers').insert({
      user_id: user.id,
      name: body.name,
      type: body.type,
      protocol,
      base_url: baseUrl,
      model: body.model || null,
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
