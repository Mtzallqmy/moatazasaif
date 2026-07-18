import { randomUUID } from 'node:crypto'
import type { VercelRequest, VercelResponse } from '../_lib/vercel.js'
import { authenticate, getAdminClient } from '../_lib/supabase.js'
import { ApiError, methodNotAllowed, sendError, setJsonHeaders } from '../_lib/http.js'
import { enforceRateLimit } from '../_lib/rate-limit.js'
import { parseRequest, providerManagerActionSchema } from '../_lib/provider-schemas.js'
import { discoverProviderModels, inferProtocol, providerDiagnostic } from '../_lib/provider-runtime.js'
import { loadOwnedProviderCredentials } from '../_lib/provider-credentials.js'
import { loadManagerProviders, publicManagerProvider, recordProviderOutcome, runProviderHealthCheck } from '../_lib/provider-manager.js'
import { redactText, redactUnknown, logTechnicalError } from '../_lib/redaction.js'

function queryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function csvCell(value: unknown) {
  const text = redactText(typeof value === 'string' ? value : JSON.stringify(value) || '')
  return `"${text.replace(/"/g, '""')}"`
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setJsonHeaders(res)
  if (!['GET', 'POST'].includes(req.method || '')) return methodNotAllowed(res, ['GET', 'POST'])
  try {
    const auth = await authenticate(req)
    await enforceRateLimit(req, 'provider_manager', req.method === 'GET' ? 120 : 40, 60, auth.user.id)
    const admin = getAdminClient()
    const providerId = queryValue(req.query.providerId)

    if (req.method === 'GET') {
      const format = queryValue(req.query.format) || 'json'
      const providers = await loadManagerProviders(admin, auth.user.id, providerId)
      if (queryValue(req.query.logs) === 'true' || format === 'csv') {
        if (!providers.length || providers.some((provider) => !provider.manager_schema_ready)) {
          if (format === 'csv') {
            res.setHeader('Content-Type', 'text/csv; charset=utf-8')
            res.setHeader('Content-Disposition', 'attachment; filename="provider-logs.csv"')
            return res.status(200).send('created_at,provider_id,model,status_code,category,code,message,duration_ms,request_id')
          }
          return res.status(200).json({ logs: [], schemaReady: false })
        }
        let logsQuery = admin.from('provider_manager_logs').select('created_at,provider_id,model,status_code,category,code,message,duration_ms,request_id').eq('user_id', auth.user.id).order('created_at', { ascending: false }).limit(500)
        if (providerId) logsQuery = logsQuery.eq('provider_id', providerId)
        const { data: logs, error } = await logsQuery
        if (error) throw new ApiError(500, 'تعذر تحميل سجلات المزود', 'provider_logs_read_failed')
        const rows = logs || []
        if (format === 'csv') {
          res.setHeader('Content-Type', 'text/csv; charset=utf-8')
          res.setHeader('Content-Disposition', 'attachment; filename="provider-logs.csv"')
          const header = ['created_at', 'provider_id', 'model', 'status_code', 'category', 'code', 'message', 'duration_ms', 'request_id'].join(',')
          return res.status(200).send([header, ...rows.map((row) => [row.created_at, row.provider_id, row.model, row.status_code, row.category, row.code, row.message, row.duration_ms, row.request_id].map(csvCell).join(','))].join('\n'))
        }
        return res.status(200).json({ logs: rows.map((row) => redactUnknown(row)) })
      }
      return res.status(200).json({ providers: providers.map(publicManagerProvider) })
    }

    const body = parseRequest(providerManagerActionSchema, req.body)
    if (body.action === 'reset-circuit') {
      const { data, error } = await admin.from('providers').update({ circuit_state: 'closed', circuit_failures: 0, circuit_opened_at: null, circuit_next_retry_at: null, updated_at: new Date().toISOString() }).eq('id', body.providerId).eq('user_id', auth.user.id).select('id').maybeSingle()
      if (error) throw new ApiError(500, 'تعذر إعادة ضبط دائرة المزود', 'provider_circuit_reset_failed')
      if (!data) throw new ApiError(404, 'المزود غير موجود', 'provider_not_found')
      return res.status(200).json({ success: true, providerId: body.providerId })
    }
    if (body.action === 'reload') {
      const providers = await loadManagerProviders(admin, auth.user.id, body.providerId)
      if (!providers[0]) throw new ApiError(404, 'المزود غير موجود', 'provider_not_found')
      return res.status(200).json({ provider: publicManagerProvider(providers[0]) })
    }
    if (body.action === 'health' || body.action === 'test') {
      const result = await runProviderHealthCheck(admin, auth.user.id, body.providerId)
      return res.status(result.diagnostic.success ? 200 : 422).json({ ...result.diagnostic, provider: result.provider })
    }

    const resolved = await loadOwnedProviderCredentials(admin, auth.user.id, body.providerId)
    const startedAt = Date.now()
    try {
      const result = await discoverProviderModels(resolved.provider, resolved.apiKey)
      const now = new Date().toISOString()
      const managerSchemaReady = Object.prototype.hasOwnProperty.call(resolved.provider, 'availability')
      const managerUpdate = managerSchemaReady
        ? { models: result.models, detected_protocol: result.protocol, protocol: result.protocol, capabilities: { models: true, chat: true, streaming: true }, health_status: 'healthy', latency_ms: Date.now() - startedAt, last_check_at: now, updated_at: now }
        : { models: result.models, detected_protocol: result.protocol, protocol: result.protocol, updated_at: now }
      const { error } = await admin.from('providers').update(managerUpdate).eq('id', body.providerId).eq('user_id', auth.user.id)
      if (error) logTechnicalError('[provider-models-save-failed]', error, { providerId: body.providerId, userId: auth.user.id })
      await recordProviderOutcome(admin, body.providerId, auth.user.id, {
        success: true,
        latencyMs: Date.now() - startedAt,
        model: resolved.provider.model || undefined,
        diagnostic: { success: true, detectedProtocol: result.protocol, models: result.models, endpoint: result.endpoint, latencyMs: Date.now() - startedAt, message: 'اكتشاف النماذج نجح فعليًا' },
      })
      return res.status(200).json({ success: true, protocol: result.protocol, models: result.models, endpoint: result.endpoint, latencyMs: Date.now() - startedAt, message: `تم اكتشاف ${result.models.length} نموذجًا فعليًا` })
    } catch (error) {
      const diagnostic = providerDiagnostic(error, inferProtocol(resolved.provider.type, resolved.provider.base_url, resolved.provider.protocol), startedAt, [resolved.apiKey])
      await recordProviderOutcome(admin, body.providerId, auth.user.id, { success: false, latencyMs: Date.now() - startedAt, diagnostic, model: resolved.provider.model || undefined })
      return res.status(422).json({ ...diagnostic, code: diagnostic.code || 'models_discovery_failed', message: 'تعذر اكتشاف النماذج', providerMessage: redactText(diagnostic.providerMessage || (error instanceof Error ? error.message : 'فشل الطلب'), [resolved.apiKey]) })
    }
  } catch (error) {
    return sendError(res, error)
  }
}
