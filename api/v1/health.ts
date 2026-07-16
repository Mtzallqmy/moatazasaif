import type { VercelRequest, VercelResponse } from '../_lib/vercel.js'
import { methodNotAllowed, sendError, setJsonHeaders } from '../_lib/http.js'
import { getAdminClient } from '../_lib/supabase.js'
import { requestId } from '../_lib/public-api.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setJsonHeaders(res)
  requestId(req, res)
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
  try {
    const started = Date.now()
    const { error } = await getAdminClient().from('profiles').select('id', { head: true, count: 'exact' }).limit(1)
    if (error) throw error
    return res.status(200).json({
      status: 'ok',
      service: 'moataz-public-api',
      version: 'v1',
      database: 'ready',
      latency_ms: Date.now() - started,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    return sendError(res, error)
  }
}
