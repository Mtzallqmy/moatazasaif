import type { VercelRequest, VercelResponse } from '../_lib/vercel.js'
import { methodNotAllowed } from '../_lib/http.js'
import login from '../_handlers/auth/login.js'
import me from '../_handlers/auth/me.js'
import password from '../_handlers/auth/password.js'
import profile from '../_handlers/auth/profile.js'
import register from '../_handlers/auth/register.js'

const handlers: Record<string, (req: VercelRequest, res: VercelResponse) => unknown> = { login, me, password, profile, register }

export default function handler(req: VercelRequest, res: VercelResponse) {
  const route = Array.isArray(req.query.route) ? req.query.route[0] : req.query.route
  const selected = route ? handlers[route] : undefined
  return selected ? selected(req, res) : methodNotAllowed(res, [])
}
