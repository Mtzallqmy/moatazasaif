import type { VercelRequest, VercelResponse } from '../../_lib/vercel.js'
import { methodNotAllowed, setJsonHeaders } from '../../_lib/http.js'

export default function handler(req: VercelRequest, res: VercelResponse) {
  setJsonHeaders(res)
  res.setHeader('X-API-Version', '1')
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
  res.setHeader('Cache-Control', 'public, max-age=10, s-maxage=30')
  return res.status(200).json({ status: 'ok', apiVersion: 'v1', service: 'moataz-ai', timestamp: new Date().toISOString() })
}
