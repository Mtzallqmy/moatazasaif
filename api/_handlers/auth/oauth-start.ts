import { createClient } from '@supabase/supabase-js'
import type { VercelRequest, VercelResponse } from '../../_lib/vercel.js'
import { getServerEnv } from '../../_lib/env.js'
import { ApiError, methodNotAllowed, sendError } from '../../_lib/http.js'
import { publicAppOrigin, setOAuthVerifierCookie } from '../../_lib/auth-session.js'
import { enforceRateLimit } from '../../_lib/rate-limit.js'

type Provider = 'google' | 'github'

class CookieStorage {
  private readonly values = new Map<string, string>()
  setItem(key: string, value: string) { this.values.set(key, value) }
  getItem(key: string) { return this.values.get(key) ?? null }
  removeItem(key: string) { this.values.delete(key) }
  encoded() { return Buffer.from(JSON.stringify([...this.values.entries()]), 'utf8').toString('base64url') }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
  try {
    const provider = req.query.provider
    if (provider !== 'google' && provider !== 'github') throw new ApiError(400, 'مزود تسجيل دخول غير صالح', 'invalid_oauth_provider')
    await enforceRateLimit(req, 'auth_oauth_start', 20, 900, provider)
    const env = getServerEnv()
    const storage = new CookieStorage()
    const client = createClient(env.supabaseUrl, env.supabasePublishableKey, {
      auth: { flowType: 'pkce', persistSession: true, detectSessionInUrl: false, storage },
    })
    const redirectTo = new URL('/api/auth/oauth-callback', publicAppOrigin()).toString()
    const { data, error } = await client.auth.signInWithOAuth({ provider: provider as Provider, options: { redirectTo, skipBrowserRedirect: true } })
    if (error || !data.url) throw new ApiError(502, 'تعذر بدء تسجيل الدخول عبر المزود', 'oauth_start_failed')
    setOAuthVerifierCookie(res, storage.encoded())
    res.setHeader('Cache-Control', 'no-store')
    return res.redirect(303, data.url)
  } catch (error) {
    return sendError(res, error)
  }
}
