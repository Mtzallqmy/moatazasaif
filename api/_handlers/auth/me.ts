import type { VercelRequest, VercelResponse } from '../../_lib/vercel.js'
import { authenticate, publicUser } from '../../_lib/supabase.js'
import { methodNotAllowed, sendError, setJsonHeaders } from '../../_lib/http.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setJsonHeaders(res)
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
  try {
    const { user, profile } = await authenticate(req)
    return res.status(200).json({ user: publicUser(user, profile) })
  } catch (error) {
    return sendError(res, error)
  }
}
