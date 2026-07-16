import type { VercelRequest, VercelResponse } from './_lib/vercel.js'
import { authenticate, getAdminClient } from './_lib/supabase.js'
import { ApiError, methodNotAllowed, sendError, setJsonHeaders } from './_lib/http.js'
import { enforceRateLimit } from './_lib/rate-limit.js'
import { parseRequest, providerPlatformConfigSchema } from './_lib/provider-schemas.js'
import { configurePlatformProvider, getPlatformProviderSummary } from './_lib/platform-provider.js'
import { recordAudit } from './_lib/audit.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setJsonHeaders(res)
  if (!['GET', 'PATCH'].includes(req.method || '')) return methodNotAllowed(res, ['GET', 'PATCH'])
  try {
    const auth = await authenticate(req)
    await enforceRateLimit(req, req.method === 'GET' ? 'platform_provider_read' : 'platform_provider_write', req.method === 'GET' ? 120 : 20, req.method === 'GET' ? 60 : 300, auth.user.id)
    const admin = getAdminClient()

    if (req.method === 'GET') return res.status(200).json(await getPlatformProviderSummary(admin, auth.user.id))
    if (auth.profile.role !== 'owner') throw new ApiError(403, 'المالك فقط يستطيع ضبط مزود المنصة', 'owner_role_required')

    const input = parseRequest(providerPlatformConfigSchema, req.body)
    const configuration = await configurePlatformProvider(admin, auth.user.id, input)
    await recordAudit(auth.user.id, auth.user.id, 'PLATFORM_PROVIDER_CONFIGURED', {
      providerId: input.providerId,
      isShared: configuration.isShared,
      isDefault: configuration.isDefault,
      dailyRequestLimit: configuration.dailyRequestLimit,
      dailyTokenLimit: configuration.dailyTokenLimit,
    })
    return res.status(200).json({ configuration, ...(await getPlatformProviderSummary(admin, auth.user.id)) })
  } catch (error) {
    return sendError(res, error)
  }
}
