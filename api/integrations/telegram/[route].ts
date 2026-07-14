import type { VercelRequest, VercelResponse } from '../../_lib/vercel'
import { methodNotAllowed } from '../../_lib/http'
import diagnose from '../../_handlers/telegram/diagnose'
import linkCode from '../../_handlers/telegram/link-code'
import test from '../../_handlers/telegram/test'
import webhook from '../../_handlers/telegram/webhook'

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
