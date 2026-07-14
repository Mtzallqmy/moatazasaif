import { createHash, createHmac, randomBytes } from 'node:crypto'
import type { VercelRequest } from './vercel.js'
import { ApiError } from './http.js'
import { getAdminClient } from './supabase.js'
import { logTechnicalError } from './redaction.js'

function clientIp(req: VercelRequest) {
  const forwarded = req.headers['x-forwarded-for']
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded
  return value?.split(',')[0]?.trim() || String(req.headers['x-real-ip'] || 'unknown')
}

interface MemoryBucket { count: number; resetAt: number }
const sessionBuckets = new Map<string, MemoryBucket>()
const sessionFingerprintSalt = randomBytes(32)

/**
 * A Supabase-free limiter for ephemeral BYOK requests. Only an HMAC fingerprint is
 * retained in process memory; neither the IP nor the API key is stored.
 * Vercel should additionally keep its platform firewall/rate limits enabled.
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
  const fingerprints = [
    createHmac('sha256', sessionFingerprintSalt).update([action, ip].join('\u001f')).digest('hex'),
    createHmac('sha256', sessionFingerprintSalt).update([action, ip, ...fingerprintParts].join('\u001f')).digest('hex'),
  ]
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
  const source = `${action}:${clientIp(req)}:${subject || 'anonymous'}`
  const keyHash = createHash('sha256').update(source).digest('hex')
  const { data, error } = await getAdminClient().rpc('consume_api_rate_limit', {
    p_key_hash: keyHash,
    p_action: action,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  }).single()

  if (error || !data) {
    logTechnicalError('[rate-limit-failed]', error, { action })
    throw new ApiError(503, 'خدمة الحماية من كثرة الطلبات غير جاهزة', 'rate_limit_unavailable')
  }

  const result = data as { allowed: boolean; remaining: number; reset_at: string }
  if (!result.allowed) {
    throw new ApiError(429, 'طلبات كثيرة جدًا. حاول مجددًا لاحقًا.', 'rate_limited', {
      resetAt: result.reset_at,
      remaining: result.remaining,
    })
  }
  return result
}

export async function enforceRateLimitKey(action: string, limit: number, windowSeconds: number, parts: string[]) {
  const keyHash = createHash('sha256').update([action, ...parts].join('\u001f')).digest('hex')
  const { data, error } = await getAdminClient().rpc('consume_api_rate_limit', {
    p_key_hash: keyHash,
    p_action: action,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  }).single()
  if (error || !data) {
    logTechnicalError('[rate-limit-key-failed]', error, { action })
    throw new ApiError(503, 'خدمة الحماية من كثرة الطلبات غير جاهزة', 'rate_limit_unavailable')
  }
  const result = data as { allowed: boolean; remaining: number; reset_at: string }
  if (!result.allowed) throw new ApiError(429, 'طلبات كثيرة جدًا. حاول مجددًا لاحقًا.', 'rate_limited', { resetAt: result.reset_at, remaining: result.remaining })
  return result
}
