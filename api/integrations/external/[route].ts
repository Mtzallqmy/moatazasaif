import type { VercelRequest, VercelResponse } from '../../_lib/vercel.js'
import { methodNotAllowed } from '../../_lib/http.js'
import test from '../../_handlers/external/test.js'

const handlers: Record<string, (req: VercelRequest, res: VercelResponse) => unknown> = { test }

export default function handler(req: VercelRequest, res: VercelResponse) {
  const route = Array.isArray(req.query.route) ? req.query.route[0] : req.query.route
  const selected = route ? handlers[route] : undefined
  return selected ? selected(req, res) : methodNotAllowed(res, [])
}
