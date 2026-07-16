import { createHmac, randomBytes } from 'node:crypto'
import type { VercelRequest } from './vercel.js'
import { ApiError } from './http.js'
import { getAdminClient } from './supabase.js'
import { logTechnicalError } from './redaction.js'

function clientIp(req: VercelRequest) {
  const forwarded = req.headers['x-forwarded-for']
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded
  return (value?.split(',')[0]?.trim() || String(req.headers['x-real-ip'] || 'unknown')).slice(0, 200)
}

interface MemoryBucket { count: number; resetAt: number }
const sessionBuckets = new Map<string, MemoryBucket>()
const sessionFingerprintSalt = randomBytes(32)

function distributedSessionRateLimitAvailable() {
  const hasUrl = Boolean(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)
  const hasPublishableKey = Boolean(
    process.env.SUPABASE_PUBLISHABLE_KEY
    || process.env.SUPABASE_ANON_KEY
    || process.env.VITE_SUPABASE_PUBLISHABLE_KEY
    || process.env.VITE_SUPABASE_ANON_KEY,
  )
  return hasUrl && hasPublishableKey && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
}

export function sessionRateLimitFingerprints(action: string, ip: string, fingerprintParts: string[]) {
  // ENCRYPTION_KEY is already required in the persisted production mode and
  // gives serverless instances a stable HMAC salt. The random fallback keeps
  // the Supabase-free local/session mode from persisting raw identifiers.
  const salt = process.env.ENCRYPTION_KEY || sessionFingerprintSalt
  return [
    createHmac('sha256', salt).update([action, ip].join('\u001f')).digest('hex'),
    createHmac('sha256', salt).update([action, ip, ...fingerprintParts].join('\u001f')).digest('hex'),
  ]
}

function rateLimitFingerprint(parts: string[]) {
  // Persist only a keyed digest. A plain SHA-256 of a predictable email/IP
  // could be brute-forced from the server-only rate-limit table.
  const salt = process.env.ENCRYPTION_KEY || sessionFingerprintSalt
  return createHmac('sha256', salt).update(parts.join('\u001f')).digest('hex')
}

export function authRateLimitFingerprints(action: string, ip: string, subject: string) {
  return [
    rateLimitFingerprint([action, 'ip', ip]),
    rateLimitFingerprint([action, 'subject', subject.trim().toLowerCase()]),
  ]
}

async function enforceDistributedSessionLimit(action: string, limit: number, windowSeconds: number, fingerprints: string[]) {
  let strictest: { allowed: boolean; remaining: number; reset_at: string } | undefined
  for (const keyHash of fingerprints) {
    const { data, error } = await getAdminClient().rpc('consume_api_rate_limit', {
      p_key_hash: keyHash,
      p_action: action,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    }).single()
    if (error || !data) {
      logTechnicalError('[session-rate-limit-failed]', error, { action })
      throw new ApiError(503, 'خدمة الحماية من كثرة الطلبات غير جاهزة', 'rate_limit_unavailable')
    }
    const result = data as { allowed: boolean; remaining: number; reset_at: string }
    if (!result.allowed) {
      throw new ApiError(429, 'طلبات كثيرة جدًا. حاول مجددًا لاحقًا.', 'rate_limited', {
        resetAt: result.reset_at,
        remaining: result.remaining,
      })
    }
    if (!strictest || result.remaining < strictest.remaining) strictest = result
  }
  return { allowed: true, remaining: strictest?.remaining ?? 0, resetAt: strictest?.reset_at }
}

/**
 * A limiter for ephemeral BYOK requests. Production uses the distributed
 * Supabase counter when configured; the fully Supabase-free mode falls back to
 * an in-process bucket. Only HMAC fingerprints are retained or transmitted.
 * Neither the IP nor the API key is stored.
 */
export async function enforceSessionRateLimit(
  req: VercelRequest,
  action: string,
  limit: number,
  windowSeconds: number,
  fingerprintParts: string[],
) {
  const now = Date.now()
  if (sessionBuckets.size > 5_000) {
    for (const [key, bucket] of sessionBuckets) if (bucket.resetAt <= now) sessionBuckets.delete(key)
  }

  const ip = clientIp(req)
  const fingerprints = sessionRateLimitFingerprints(action, ip, fingerprintParts)
  if (distributedSessionRateLimitAvailable()) {
    return enforceDistributedSessionLimit(action, limit, windowSeconds, fingerprints)
  }
  const buckets = fingerprints.map((key) => {
    const current = sessionBuckets.get(key)
    const bucket = !current || current.resetAt <= now
      ? { count: 1, resetAt: now + windowSeconds * 1_000 }
      : { count: current.count + 1, resetAt: current.resetAt }
    sessionBuckets.set(key, bucket)
    return bucket
  })
  const blocked = buckets.find((bucket) => bucket.count > limit)
  if (blocked) {
    throw new ApiError(429, 'طلبات كثيرة جدًا. حاول مجددًا لاحقًا.', 'rate_limited', {
      resetAt: new Date(blocked.resetAt).toISOString(),
      remaining: 0,
    })
  }
  const bucket = buckets.reduce((current, next) => current.count >= next.count ? current : next)
  return { allowed: true, remaining: Math.max(limit - bucket.count, 0), resetAt: new Date(bucket.resetAt).toISOString() }
}

export function resetSessionRateLimitsForTests() {
  sessionBuckets.clear()
}

export async function enforceRateLimit(
  req: VercelRequest,
  action: string,
  limit: number,
  windowSeconds: number,
  subject?: string,
) {
  const keyHash = rateLimitFingerprint([action, clientIp(req), subject || 'anonymous'])
  return consumeRateLimit(action, limit, windowSeconds, keyHash, '[rate-limit-failed]')
}

/**
 * Authentication limiter with independent IP and account buckets. This stops
 * both username rotation from one source and distributed guessing of one
 * account while retaining only keyed, irreversible identifiers.
 */
export async function enforceAuthRateLimit(
  req: VercelRequest,
  action: string,
  limit: number,
  windowSeconds: number,
  subject: string,
) {
  let strictest: { allowed: boolean; remaining: number; reset_at: string } | undefined
  for (const keyHash of authRateLimitFingerprints(action, clientIp(req), subject)) {
    const result = await consumeRateLimit(action, limit, windowSeconds, keyHash, '[auth-rate-limit-failed]')
    if (!strictest || result.remaining < strictest.remaining) strictest = result
  }
  return strictest!
}

export async function enforceRateLimitKey(action: string, limit: number, windowSeconds: number, parts: string[]) {
  const keyHash = rateLimitFingerprint([action, ...parts])
  return consumeRateLimit(action, limit, windowSeconds, keyHash, '[rate-limit-key-failed]')
}

async function consumeRateLimit(action: string, limit: number, windowSeconds: number, keyHash: string, logScope: string) {
  const { data, error } = await getAdminClient().rpc('consume_api_rate_limit', {
    p_key_hash: keyHash,
    p_action: action,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  }).single()
  if (error || !data) {
    logTechnicalError(logScope, error, { action })
    throw new ApiError(503, 'خدمة الحماية من كثرة الطلبات غير جاهزة', 'rate_limit_unavailable')
  }
  const result = data as { allowed: boolean; remaining: number; reset_at: string }
  if (!result.allowed) throw new ApiError(429, 'طلبات كثيرة جدًا. حاول مجددًا لاحقًا.', 'rate_limited', { resetAt: result.reset_at, remaining: result.remaining })
  return result
}
