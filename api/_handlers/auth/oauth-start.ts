import { createClient } from '@supabase/supabase-js'
import type { VercelRequest, VercelResponse } from '../../_lib/vercel.js'
import { getServerEnv } from '../../_lib/env.js'
import { ApiError, methodNotAllowed, sendError, setJsonHeaders } from '../../_lib/http.js'
import { requestAppOrigin, setOAuthVerifierCookie } from '../../_lib/auth-session.js'
import { enforceRateLimit } from '../../_lib/rate-limit.js'
import { logTechnicalError } from '../../_lib/redaction.js'

type Provider = 'google' | 'github'

class CookieStorage {
  private readonly values = new Map<string, string>()
  setItem(key: string, value: string) { this.values.set(key, value) }
  getItem(key: string) { return this.values.get(key) ?? null }
  removeItem(key: string) { this.values.delete(key) }
  encoded() { return Buffer.from(JSON.stringify([...this.values.entries()]), 'utf8').toString('base64url') }
}

async function assertProviderEnabled(url: string, publishableKey: string, provider: Provider) {
  try {
    const response = await fetch(new URL('/auth/v1/settings', url), {
      headers: { apikey: publishableKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) return
    const settings = await response.json() as { external?: Partial<Record<Provider, boolean>> }
    if (settings.external?.[provider] === false) {
      throw new ApiError(503, 'مزود تسجيل الدخول غير مفعّل', 'oauth_provider_disabled')
    }
  } catch (error) {
    if (error instanceof ApiError) throw error
    // The authorize endpoint remains authoritative. A temporary settings
    // timeout must not disable a provider that is otherwise operational.
    console.warn('[auth-oauth-settings-unavailable]', { provider })
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
  try {
    const provider = req.query.provider
    if (provider !== 'google' && provider !== 'github') throw new ApiError(400, 'مزود تسجيل دخول غير صالح', 'invalid_oauth_provider')
    await enforceRateLimit(req, 'auth_oauth_start', 20, 900, provider)
    const env = getServerEnv()
    await assertProviderEnabled(env.supabaseUrl, env.supabasePublishableKey, provider)
    const storage = new CookieStorage()
    const client = createClient(env.supabaseUrl, env.supabasePublishableKey, {
      auth: { flowType: 'pkce', persistSession: true, detectSessionInUrl: false, storage },
    })
    const callbackOrigin = requestAppOrigin(req)
    const redirectTo = new URL('/api/auth/oauth-callback', callbackOrigin).toString()
    const { data, error } = await client.auth.signInWithOAuth({ provider: provider as Provider, options: { redirectTo, skipBrowserRedirect: true } })
    if (error || !data.url) throw new ApiError(502, 'تعذر بدء تسجيل الدخول عبر المزود', 'oauth_start_failed')
    const authorizationUrl = new URL(data.url)
    const authOrigin = new URL(env.supabaseUrl).origin
    if (authorizationUrl.origin !== authOrigin || authorizationUrl.pathname !== '/auth/v1/authorize') {
      throw new ApiError(502, 'أعاد مزود المصادقة عنوانًا غير متوقع', 'oauth_authorize_url_invalid')
    }
    setOAuthVerifierCookie(res, storage.encoded())
    res.setHeader('Cache-Control', 'no-store')
    console.info('[auth-oauth-start]', { provider, callbackOrigin })
    if (req.query.format === 'json' || String(req.headers.accept || '').includes('application/json')) {
      setJsonHeaders(res)
      return res.status(200).json({ url: authorizationUrl.toString() })
    }
    return res.redirect(303, authorizationUrl.toString())
  } catch (error) {
    logTechnicalError('[auth-oauth-start-failed]', error, { provider: req.query.provider })
    return sendError(res, error)
  }
}
