import type { VercelRequest, VercelResponse } from './_lib/vercel.js'
import { authenticate, getAdminClient } from './_lib/supabase.js'
import { ApiError, methodNotAllowed, sendError, setJsonHeaders } from './_lib/http.js'
import { assertSafeProviderUrl, generateProviderText, inferProtocol, providerBaseUrl, providerDiagnostic, sanitizeProviderEndpoint, streamProviderText, type ProviderRecord, type ProviderStreamEvent } from './_lib/provider-runtime.js'
import { enforceRateLimit, enforceSessionRateLimit } from './_lib/rate-limit.js'
import { chatRequestSchema, parseRequest } from './_lib/provider-schemas.js'
import { ephemeralProviderRecord, ephemeralRateLimitParts, loadOwnedProviderCredentials } from './_lib/provider-credentials.js'
import { logTechnicalError, redactText, redactUnknown } from './_lib/redaction.js'

function writeSse(res: VercelResponse, event: ProviderStreamEvent['event'], data: unknown, extraSecrets: string[] = []) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(redactUnknown(data, extraSecrets, 0, Number.MAX_SAFE_INTEGER))}\n\n`)
}

async function saveProviderFailure(providerId: string, userId: string, diagnostic: ReturnType<typeof providerDiagnostic>) {
  const { error } = await getAdminClient().from('providers').update({
    status: 'error',
    error_message: diagnostic.providerMessage || diagnostic.message,
    diagnostic,
    last_latency_ms: diagnostic.latencyMs,
    last_http_status: diagnostic.httpStatus || null,
    updated_at: new Date().toISOString(),
  }).eq('id', providerId).eq('user_id', userId)
  if (error) logTechnicalError('[provider-chat-diagnostic-save-failed]', error, { providerId, userId })
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setJsonHeaders(res)
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])

  let savedUserId: string | undefined
  let provider: ProviderRecord | undefined
  let startedAt = Date.now()

  try {
    const body = parseRequest(chatRequestSchema, req.body)
    let apiKey: string

    if (body.credentialMode === 'session') {
      await enforceSessionRateLimit(req, 'chat_generation_session', 60, 60, ephemeralRateLimitParts(body.provider))
      provider = ephemeralProviderRecord(body.provider)
      apiKey = body.provider.apiKey
    } else {
      const auth = await authenticate(req)
      savedUserId = auth.user.id
      await enforceRateLimit(req, 'chat_generation_saved', 60, 60, savedUserId)
      const resolved = await loadOwnedProviderCredentials(getAdminClient(), savedUserId, body.providerId, { requireEnabled: true })
      provider = resolved.provider
      apiKey = resolved.apiKey
    }

    const model = body.model || provider.model || ''
    if (!model) throw new ApiError(400, 'اسم النموذج مطلوب لبدء المحادثة', 'model_required')
    await assertSafeProviderUrl(providerBaseUrl(provider))
    startedAt = Date.now()

    if (!body.stream) {
      try {
        const result = await generateProviderText(provider, apiKey, model, body.messages)
        return res.status(200).json({
          content: redactText(result.content, [apiKey], Number.MAX_SAFE_INTEGER),
          usage: result.usage,
          tokens: result.usage.totalTokens,
          model,
          provider: provider.type,
          protocol: result.protocol,
          endpoint: result.endpoint ? sanitizeProviderEndpoint(result.endpoint, [apiKey]) : undefined,
          latencyMs: Date.now() - startedAt,
        })
      } catch (providerError) {
        const diagnostic = providerDiagnostic(providerError, inferProtocol(provider.type, provider.base_url, provider.protocol), startedAt, [apiKey])
        if (savedUserId) await saveProviderFailure(provider.id, savedUserId, diagnostic)
        throw new ApiError(502, diagnostic.providerMessage || diagnostic.message, diagnostic.code || 'provider_request_failed', { diagnostic })
      }
    }

    res.statusCode = 200
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')

    const controller = new AbortController()
    const abort = () => controller.abort()
    req.once('aborted', abort)
    res.once('close', abort)
    let sentDone = false

    try {
      for await (const message of streamProviderText(provider, apiKey, model, body.messages, controller.signal)) {
        if (res.writableEnded || res.destroyed) break
        writeSse(res, message.event, message.data, [apiKey])
        if (message.event === 'done') sentDone = true
      }
      if (!sentDone && !res.writableEnded && !res.destroyed) writeSse(res, 'done', {}, [apiKey])
    } catch (providerError) {
      const diagnostic = providerDiagnostic(providerError, inferProtocol(provider.type, provider.base_url, provider.protocol), startedAt, [apiKey])
      // Log only the already-redacted diagnostic; never serialize the raw
      // upstream error, which could echo an API key in an unusual gateway.
      logTechnicalError('[provider-stream-failed]', { message: diagnostic.providerMessage, code: diagnostic.code }, { endpoint: diagnostic.endpoint, protocol: diagnostic.detectedProtocol })
      if (savedUserId) await saveProviderFailure(provider.id, savedUserId, diagnostic)
      if (!res.writableEnded && !res.destroyed && diagnostic.code !== 'aborted') {
        writeSse(res, 'error', {
          code: diagnostic.code || 'provider_stream_failed',
          message: diagnostic.providerMessage || diagnostic.message,
          category: diagnostic.category || 'unknown',
        }, [apiKey])
        writeSse(res, 'done', {}, [apiKey])
      }
    } finally {
      req.off('aborted', abort)
      res.off('close', abort)
      if (!res.writableEnded && !res.destroyed) res.end()
    }
  } catch (error) {
    return sendError(res, error)
  }
}
