import type { VercelRequest, VercelResponse } from '../_lib/vercel.js'
import { methodNotAllowed, sendError, setJsonHeaders } from '../_lib/http.js'
import { getAdminClient } from '../_lib/supabase.js'
import { authenticateApiKey, requestId, requireScope, writeApiUsage } from '../_lib/public-api.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setJsonHeaders(res)
  const id = requestId(req, res)
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
  const started = Date.now()
  let context
  try {
    context = await authenticateApiKey(req)
    requireScope(context, 'account:read')
    const { data, error } = await getAdminClient().from('profiles').select('id,display_name,username,role,is_active,created_at').eq('id', context.userId).maybeSingle()
    if (error || !data) throw error || new Error('profile missing')
    await writeApiUsage({ context, requestId: id, endpoint: '/v1/account', method: 'GET', statusCode: 200, latencyMs: Date.now() - started, req })
    return res.status(200).json({ id: data.id, name: data.display_name, username: data.username, role: data.role, active: data.is_active, created_at: data.created_at, environment: context.environment })
  } catch (error) {
    if (context) await writeApiUsage({ context, requestId: id, endpoint: '/v1/account', method: 'GET', statusCode: (error as any)?.status || 500, latencyMs: Date.now() - started, errorCode: (error as any)?.code, safeErrorMessage: error instanceof Error ? error.message : undefined, req })
    return sendError(res, error)
  }
}
