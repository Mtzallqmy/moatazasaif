import type { VercelRequest, VercelResponse } from '../../_lib/vercel.js'
import { authenticate } from '../../_lib/supabase.js'
import { methodNotAllowed, sendError, setJsonHeaders } from '../../_lib/http.js'
import { enforceRateLimit } from '../../_lib/rate-limit.js'
import { parseRequest } from '../../_lib/provider-schemas.js'
import { externalIntegrationTestSchema } from '../../_lib/integrations/schemas.js'
import { testExternalCredentials } from '../../_lib/integrations/service.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setJsonHeaders(res)
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
  try {
    const auth = await authenticate(req)
    await enforceRateLimit(req, 'external_integration_test', 20, 300, auth.user.id)
    return res.status(200).json(await testExternalCredentials(parseRequest(externalIntegrationTestSchema, req.body)))
  } catch (error) {
    return sendError(res, error)
  }
}
