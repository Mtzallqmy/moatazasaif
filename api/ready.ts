import type { VercelRequest, VercelResponse } from './_lib/vercel.js'
import { getServerEnv } from './_lib/env.js'
import { getAdminClient } from './_lib/supabase.js'
import { methodNotAllowed, setJsonHeaders } from './_lib/http.js'
import { logTechnicalError } from './_lib/redaction.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setJsonHeaders(res)
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
  try {
    getServerEnv()
    const admin = getAdminClient()
    const [{ error: profileError }, { error: rateLimitError }] = await Promise.all([
      admin.from('profiles').select('id', { head: true, count: 'exact' }).limit(1),
      admin.rpc('consume_api_rate_limit', {
        p_key_hash: '0'.repeat(64),
        p_action: 'readiness_probe',
        p_limit: 100000,
        p_window_seconds: 60,
      }).single(),
    ])
    if (profileError) throw profileError
    if (rateLimitError) throw rateLimitError
    return res.status(200).json({ status: 'ready', timestamp: new Date().toISOString() })
  } catch (error) {
    logTechnicalError('[readiness-failed]', error)
    return res.status(503).json({ status: 'not_ready', timestamp: new Date().toISOString() })
  }
}
