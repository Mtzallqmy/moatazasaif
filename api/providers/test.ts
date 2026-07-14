import type { VercelRequest, VercelResponse } from '../_lib/vercel.js'
import { authenticate, getAdminClient } from '../_lib/supabase.js'
import { methodNotAllowed, sendError, setJsonHeaders } from '../_lib/http.js'
import { testProviderConnection } from '../_lib/provider-runtime.js'
import { enforceRateLimit, enforceSessionRateLimit } from '../_lib/rate-limit.js'
import { parseRequest, providerTestRequestSchema } from '../_lib/provider-schemas.js'
import { ephemeralProviderRecord, ephemeralRateLimitParts, loadOwnedProviderCredentials } from '../_lib/provider-credentials.js'
import { logTechnicalError } from '../_lib/redaction.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setJsonHeaders(res)
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])

  try {
    const body = parseRequest(providerTestRequestSchema, req.body)
    let provider
    let apiKey: string
    let userId: string | undefined

    if (body.credentialMode === 'session') {
      await enforceSessionRateLimit(req, 'provider_test_session', 20, 300, ephemeralRateLimitParts(body.provider))
      provider = ephemeralProviderRecord(body.provider)
      apiKey = body.provider.apiKey
    } else {
      const auth = await authenticate(req)
      userId = auth.user.id
      await enforceRateLimit(req, 'provider_test_saved', 30, 300, userId)
      const resolved = await loadOwnedProviderCredentials(getAdminClient(), userId, body.providerId)
      provider = resolved.provider
      apiKey = resolved.apiKey
    }

    const diagnostic = await testProviderConnection(provider, apiKey)
    const testedAt = new Date().toISOString()

    if (body.credentialMode === 'saved' && userId) {
      const { error } = await getAdminClient().from('providers').update({
        status: diagnostic.success ? 'connected' : 'error',
        last_tested_at: testedAt,
        error_message: diagnostic.success ? null : diagnostic.providerMessage || diagnostic.message,
        models: diagnostic.models,
        detected_protocol: diagnostic.detectedProtocol,
        protocol: diagnostic.detectedProtocol,
        diagnostic,
        last_latency_ms: diagnostic.latencyMs,
        last_http_status: diagnostic.httpStatus || null,
        updated_at: testedAt,
      }).eq('id', provider.id).eq('user_id', userId)
      if (error) logTechnicalError('[provider-diagnostic-save-failed]', error, { providerId: provider.id, userId })
    }

    return res.status(diagnostic.success ? 200 : 422).json({ ...diagnostic, testedAt })
  } catch (error) {
    return sendError(res, error)
  }
}
