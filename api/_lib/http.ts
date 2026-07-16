import { randomUUID } from 'node:crypto'
import type { VercelRequest, VercelResponse } from './vercel.js'
import { logTechnicalError, redactText, redactUnknown } from './redaction.js'

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code = 'request_error',
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export function setJsonHeaders(res: VercelResponse) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('Expires', '0')
  res.setHeader('X-Request-Id', randomUUID())
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, nosnippet')
}

export function methodNotAllowed(res: VercelResponse, methods: string[]) {
  res.setHeader('Allow', methods.join(', '))
  return res.status(405).json({ error: 'الطريقة غير مسموحة', code: 'method_not_allowed' })
}

export function getBearerToken(req: VercelRequest): string | null {
  const header = req.headers.authorization
  const match = typeof header === 'string' ? /^Bearer\s+(.+)$/i.exec(header.trim()) : null
  if (!match) return null
  const token = match[1].trim()
  // Supabase access tokens are small JWTs. Rejecting unusually large values
  // prevents attacker-controlled headers from being forwarded to Auth.
  return token && token.length <= 16_384 ? token : null
}

export function requireString(value: unknown, field: string, maxLength = 200) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    throw new ApiError(400, `الحقل ${field} مطلوب أو غير صالح`, 'validation_error', { field })
  }
  return value.trim()
}

export function optionalString(value: unknown, maxLength = 200): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new ApiError(400, 'قيمة نصية غير صالحة', 'validation_error')
  }
  return value.trim() || undefined
}

export function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'حدث خطأ غير متوقع'
}

export function sendError(res: VercelResponse, error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 429) {
      const resetAt = typeof error.details?.resetAt === 'string' ? Date.parse(error.details.resetAt) : Number.NaN
      if (Number.isFinite(resetAt)) {
        const retryAfter = Math.max(1, Math.min(86_400, Math.ceil((resetAt - Date.now()) / 1_000)))
        res.setHeader('Retry-After', String(retryAfter))
      }
      res.setHeader('X-RateLimit-Remaining', '0')
    }
    return res.status(error.status).json({ error: redactText(error.message), code: error.code, details: redactUnknown(error.details) })
  }

  logTechnicalError('[api-error]', error)
  return res.status(500).json({ error: 'حدث خطأ داخلي غير متوقع', code: 'internal_error' })
}
