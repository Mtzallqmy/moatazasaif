import type { Session } from '@supabase/supabase-js'
import type { VercelRequest, VercelResponse } from './vercel.js'
import { getServerEnv } from './env.js'

const ACCESS_COOKIE = 'moataz-access-token'
const REFRESH_COOKIE = 'moataz-refresh-token'
const OAUTH_COOKIE = 'moataz-oauth-verifier'
const ACCESS_MAX_AGE = 60 * 60
const REFRESH_MAX_AGE = 60 * 60 * 24 * 30

function productionCookies() {
  return process.env.NODE_ENV === 'production'
}

function cookieName(name: string) {
  return productionCookies() ? `__Host-${name}` : name
}

function appendSetCookie(res: VercelResponse, value: string) {
  const current = res.getHeader('Set-Cookie')
  const values = Array.isArray(current) ? current.map(String) : current ? [String(current)] : []
  res.setHeader('Set-Cookie', [...values, value])
}

function serializeCookie(name: string, value: string, maxAge: number) {
  const attributes = [
    `${cookieName(name)}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${Math.max(0, Math.floor(maxAge))}`,
    'HttpOnly',
    'SameSite=Lax',
  ]
  if (productionCookies()) attributes.push('Secure')
  return attributes.join('; ')
}

export function setSessionCookies(res: VercelResponse, session: Session) {
  const accessAge = session.expires_at
    ? Math.max(60, Math.min(ACCESS_MAX_AGE, session.expires_at - Math.floor(Date.now() / 1000)))
    : ACCESS_MAX_AGE
  appendSetCookie(res, serializeCookie(ACCESS_COOKIE, session.access_token, accessAge))
  appendSetCookie(res, serializeCookie(REFRESH_COOKIE, session.refresh_token, REFRESH_MAX_AGE))
}

export function clearSessionCookies(res: VercelResponse) {
  appendSetCookie(res, serializeCookie(ACCESS_COOKIE, '', 0))
  appendSetCookie(res, serializeCookie(REFRESH_COOKIE, '', 0))
  appendSetCookie(res, serializeCookie(OAUTH_COOKIE, '', 0))
}

export function setOAuthVerifierCookie(res: VercelResponse, value: string) {
  appendSetCookie(res, serializeCookie(OAUTH_COOKIE, value, 600))
}

export function readCookie(req: VercelRequest, name: string) {
  return req.cookies?.[cookieName(name)] || undefined
}

export function readAccessToken(req: VercelRequest) {
  return readCookie(req, ACCESS_COOKIE)
}

export function readRefreshToken(req: VercelRequest) {
  return readCookie(req, REFRESH_COOKIE)
}

export function readOAuthVerifier(req: VercelRequest) {
  return readCookie(req, OAUTH_COOKIE)
}

export function publicAppOrigin() {
  let configured: string | undefined
  try {
    configured = getServerEnv().APP_URL
  } catch {
    configured = process.env.APP_URL
  }
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : undefined
  const candidates = [configured, vercel, 'https://moatazasaif.vercel.app']
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      const url = new URL(candidate)
      if (url.protocol === 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return url.origin
    } catch {
      // Ignore malformed environment values and keep the safe production fallback.
    }
  }
  return 'https://moatazasaif.vercel.app'
}

export function redirectToLogin(res: VercelResponse, params?: Record<string, string>) {
  const url = new URL('/login', publicAppOrigin())
  for (const [key, value] of Object.entries(params || {})) url.searchParams.set(key, value)
  return res.redirect(303, url.toString())
}
