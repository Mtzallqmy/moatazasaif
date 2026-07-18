import type { VercelRequest, VercelResponse } from '../../_lib/vercel.js'
import { clearSessionCookies } from '../../_lib/auth-session.js'
import { methodNotAllowed, setJsonHeaders } from '../../_lib/http.js'

export default function handler(req: VercelRequest, res: VercelResponse) {
  setJsonHeaders(res)
  if (req.method !== 'POST' && req.method !== 'DELETE') return methodNotAllowed(res, ['POST', 'DELETE'])
  clearSessionCookies(res)
  return res.status(204).send('')
}
