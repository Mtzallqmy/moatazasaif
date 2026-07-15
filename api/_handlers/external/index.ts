import type { VercelRequest, VercelResponse } from '../../_lib/vercel.js'
import { authenticate } from '../../_lib/supabase.js'
import { ApiError, methodNotAllowed, sendError, setJsonHeaders } from '../../_lib/http.js'
import { enforceRateLimit } from '../../_lib/rate-limit.js'
import { parseRequest } from '../../_lib/provider-schemas.js'
import { externalIntegrationCreateSchema, externalIntegrationDeleteSchema, externalIntegrationPatchSchema } from '../../_lib/integrations/schemas.js'
import { checkExternalIntegration, createExternalIntegration, deleteExternalIntegration, getExternalRepositories, listExternalIntegrations, sendExternalWhatsAppMessage, setExternalIntegrationEnabled } from '../../_lib/integrations/service.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setJsonHeaders(res)
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method || '')) return methodNotAllowed(res, ['GET', 'POST', 'PATCH', 'DELETE'])
  try {
    const auth = await authenticate(req)
    await enforceRateLimit(req, `external_integration_${(req.method || 'GET').toLowerCase()}`, req.method === 'GET' ? 120 : 30, req.method === 'GET' ? 60 : 300, auth.user.id)
    if (req.method === 'GET') return res.status(200).json({ integrations: await listExternalIntegrations(auth.user.id) })
    if (req.method === 'POST') return res.status(201).json({ integration: await createExternalIntegration(auth.user.id, parseRequest(externalIntegrationCreateSchema, req.body)) })
    if (req.method === 'DELETE') return res.status(200).json(await deleteExternalIntegration(auth.user.id, parseRequest(externalIntegrationDeleteSchema, req.body).id))

    const body = parseRequest(externalIntegrationPatchSchema, req.body)
    if (body.action === 'check') return res.status(200).json({ integration: await checkExternalIntegration(auth.user.id, body.integrationId) })
    if (body.action === 'repositories') return res.status(200).json({ repositories: await getExternalRepositories(auth.user.id, body.integrationId) })
    if (body.action === 'send-message') return res.status(200).json(await sendExternalWhatsAppMessage(auth.user.id, body.integrationId, body.recipient, body.message))
    if (body.action === 'set-enabled') return res.status(200).json({ integration: await setExternalIntegrationEnabled(auth.user.id, body.integrationId, body.isEnabled) })
    throw new ApiError(400, 'إجراء التكامل غير معروف', 'integration_action_invalid')
  } catch (error) {
    return sendError(res, error)
  }
}
