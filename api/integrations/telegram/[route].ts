import type { VercelRequest, VercelResponse } from '../../_lib/vercel.js'
import { methodNotAllowed } from '../../_lib/http.js'
import diagnose from '../../_handlers/telegram/diagnose.js'
import linkCode from '../../_handlers/telegram/link-code.js'
import test from '../../_handlers/telegram/test.js'
import webhook from '../../_handlers/telegram/webhook.js'

const handlers: Record<string, (req: VercelRequest, res: VercelResponse) => unknown> = {
  diagnose,
  'link-code': linkCode,
  test,
  webhook,
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  const route = Array.isArray(req.query.route) ? req.query.route[0] : req.query.route
  const selected = route ? handlers[route] : undefined
  return selected ? selected(req, res) : methodNotAllowed(res, [])
}
