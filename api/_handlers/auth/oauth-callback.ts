import { createClient } from '@supabase/supabase-js'
import type { VercelRequest, VercelResponse } from '../../_lib/vercel.js'
import { getServerEnv } from '../../_lib/env.js'
import { clearOAuthVerifierCookie, clearSessionCookies, readOAuthVerifier, redirectToLogin, setSessionCookies } from '../../_lib/auth-session.js'
import { getAdminClient, getOrCreateProfile } from '../../_lib/supabase.js'
import { logTechnicalError } from '../../_lib/redaction.js'

class CookieStorage {
  constructor(private readonly values: Map<string, string>) {}
  setItem(key: string, value: string) { this.values.set(key, value) }
  getItem(key: string) { return this.values.get(key) ?? null }
  removeItem(key: string) { this.values.delete(key) }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const errorCode = typeof req.query.error_code === 'string' ? req.query.error_code : undefined
    const errorDescription = typeof req.query.error_description === 'string' ? req.query.error_description : undefined
    if (errorCode || errorDescription) {
      clearOAuthVerifierCookie(res)
      console.warn('[auth-oauth-provider-rejected]', { code: errorCode || 'oauth_failed' })
      return redirectToLogin(req, res, { error_code: errorCode || 'oauth_failed', error_description: errorDescription || 'تعذر إكمال تسجيل الدخول' })
    }

    const code = typeof req.query.code === 'string' ? req.query.code : undefined
    const verifierCookie = readOAuthVerifier(req)
    if (!code || !verifierCookie) {
      clearOAuthVerifierCookie(res)
      console.warn('[auth-oauth-callback-invalid]', { hasCode: Boolean(code), hasVerifier: Boolean(verifierCookie) })
      return redirectToLogin(req, res, { error_code: 'oauth_callback_invalid', error_description: 'انتهت جلسة تسجيل الدخول. أعد المحاولة.' })
    }

    const entries = JSON.parse(Buffer.from(verifierCookie, 'base64url').toString('utf8')) as unknown
    if (!Array.isArray(entries) || entries.some((entry) => !Array.isArray(entry) || typeof entry[0] !== 'string' || typeof entry[1] !== 'string')) {
      clearOAuthVerifierCookie(res)
      return redirectToLogin(req, res, { error_code: 'oauth_callback_invalid', error_description: 'تعذر التحقق من جلسة تسجيل الدخول.' })
    }
    const env = getServerEnv()
    const client = createClient(env.supabaseUrl, env.supabasePublishableKey, { auth: { flowType: 'pkce', persistSession: true, detectSessionInUrl: false, storage: new CookieStorage(new Map(entries as [string, string][])) } })
    const { data, error } = await client.auth.exchangeCodeForSession(code)
    if (error || !data.session || !data.user) {
      clearOAuthVerifierCookie(res)
      logTechnicalError('[auth-oauth-exchange-failed]', error || new Error('missing_oauth_session'), {
        status: error?.status,
        code: error?.code,
      })
      return redirectToLogin(req, res, { error_code: 'oauth_exchange_failed', error_description: 'تعذر إكمال تسجيل الدخول عبر المزود.' })
    }
    const profile = await getOrCreateProfile(data.user)
    if (!profile.is_active) {
      clearSessionCookies(res)
      return redirectToLogin(req, res, { error_code: 'account_disabled', error_description: 'تم إيقاف هذا الحساب.' })
    }
    const admin = getAdminClient()
    await admin.from('profiles').update({ last_login_at: new Date().toISOString() }).eq('id', data.user.id)
    clearOAuthVerifierCookie(res)
    setSessionCookies(res, data.session)
    console.info('[auth-oauth-complete]', { provider: data.user.app_metadata?.provider || 'oauth' })
    // The user object is intentionally not put in the URL; /api/auth/session fetches it after the redirect.
    return redirectToLogin(req, res)
  } catch (error) {
    clearOAuthVerifierCookie(res)
    logTechnicalError('[auth-oauth-callback-failed]', error)
    return redirectToLogin(req, res, { error_code: 'oauth_callback_failed', error_description: 'تعذر إكمال تسجيل الدخول. أعد المحاولة.' })
  }
}
