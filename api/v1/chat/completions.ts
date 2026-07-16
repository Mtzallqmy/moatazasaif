import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { VercelRequest, VercelResponse } from '../../_lib/vercel.js'
import { ApiError, methodNotAllowed, sendError, setJsonHeaders } from '../../_lib/http.js'
import { authenticateApiKey, assertModelAllowed, requestId, requireScope, writeApiUsage } from '../../_lib/public-api.js'
import { enforceRateLimit } from '../../_lib/rate-limit.js'
import { getAdminClient } from '../../_lib/supabase.js'
import { assertSafeProviderUrl, generateProviderText, inferProtocol, providerBaseUrl, type ProviderRecord } from '../../_lib/provider-runtime.js'
import { decryptSecret } from '../../_lib/crypto.js'

const requestSchema = z.object({
  model: z.string().trim().min(1).max(300),
  messages: z.array(z.object({
    role: z.enum(['system','user','assistant']),
    content: z.string().max(100_000),
  }).strict()).min(1).max(100),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().gt(0).max(1).optional(),
  max_tokens: z.number().int().min(1).max(32_768).optional(),
  stream: z.boolean().default(false),
  stop: z.union([z.string().max(500), z.array(z.string().max(500)).max(8)]).optional(),
  user: z.string().max(200).optional(),
}).strict()

function completionId() {
  return `chatcmpl_${randomUUID().replace(/-/g, '')}`
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setJsonHeaders(res)
  const id = requestId(req, res)
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
  const started = Date.now()
  let context
  let model
  try {
    context = await authenticateApiKey(req)
    requireScope(context, 'chat:write')
    const parsed = requestSchema.safeParse(req.body)
    if (!parsed.success) throw new ApiError(422, 'بيانات الطلب غير صالحة', 'validation_error', { issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })) })
    if (parsed.data.stream) throw new ApiError(422, 'Streaming غير مفعّل بعد في واجهة v1 العامة', 'streaming_not_enabled')
    if (parsed.data.temperature !== undefined || parsed.data.top_p !== undefined || parsed.data.stop !== undefined) {
      throw new ApiError(422, 'temperature وtop_p وstop غير مدعومة بعد عبر البوابة الموحدة', 'unsupported_parameter')
    }
    model = parsed.data.model
    assertModelAllowed(context, model)
    const limit = Math.min(context.rateLimitPerMinute, 60)
    const rate = await enforceRateLimit(req, 'public_api_chat', limit, 60, context.id)
    res.setHeader('X-RateLimit-Limit', String(limit))
    res.setHeader('X-RateLimit-Remaining', String(rate.remaining))
    res.setHeader('X-RateLimit-Reset', String(Math.ceil(Date.parse(rate.reset_at) / 1000)))

    const admin = getAdminClient()
    const { data: provider, error } = await admin.from('providers')
      .select('id,user_id,name,type,protocol,base_url,model,models,encrypted_key,is_enabled,status')
      .eq('is_platform_shared', true).eq('is_platform_default', true).eq('is_enabled', true).eq('status', 'connected').maybeSingle()
    if (error || !provider) throw new ApiError(503, 'مزود المنصة الافتراضي غير متاح', 'provider_unavailable')
    const available = new Set(Array.isArray(provider.models) ? provider.models : [provider.model])
    if (!available.has(model)) throw new ApiError(403, 'النموذج غير متاح عبر مزود المنصة', 'model_not_allowed')
    const record = provider as ProviderRecord
    await assertSafeProviderUrl(providerBaseUrl(record))
    const apiKey = decryptSecret(provider.encrypted_key)
    const providerStarted = Date.now()
    const result = await generateProviderText(record, apiKey, model, parsed.data.messages)
    const providerLatency = Date.now() - providerStarted
    const inputTokens = Number(result.usage.inputTokens || 0)
    const outputTokens = Number(result.usage.outputTokens || 0)
    await writeApiUsage({ context, requestId: id, endpoint: '/v1/chat/completions', method: 'POST', statusCode: 200, service: 'ai', model, latencyMs: Date.now() - started, providerLatencyMs: providerLatency, inputTokens, outputTokens, req })
    return res.status(200).json({
      id: completionId(),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, message: { role: 'assistant', content: result.content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: inputTokens, completion_tokens: outputTokens, total_tokens: inputTokens + outputTokens },
      system_fingerprint: `moataz-${inferProtocol(record.type, record.base_url, record.protocol)}`,
    })
  } catch (error) {
    if (context) await writeApiUsage({ context, requestId: id, endpoint: '/v1/chat/completions', method: 'POST', statusCode: (error as any)?.status || 500, service: 'ai', model, latencyMs: Date.now() - started, errorCode: (error as any)?.code, safeErrorMessage: error instanceof Error ? error.message : undefined, req })
    return sendError(res, error)
  }
}
