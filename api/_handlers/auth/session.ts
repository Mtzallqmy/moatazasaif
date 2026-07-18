import type { Session } from '@supabase/supabase-js'
import type { VercelRequest, VercelResponse } from '../../_lib/vercel.js'
import { getPublicAuthClient, getProfile, publicUser } from '../../_lib/supabase.js'
import { ApiError, methodNotAllowed, requireString, sendError, setJsonHeaders } from '../../_lib/http.js'
import { clearSessionCookies, readAccessToken, readRefreshToken, setSessionCookies } from '../../_lib/auth-session.js'

async function respondWithSession(res: VercelResponse, session: Session) {
  const auth = getPublicAuthClient()
  const { data, error } = await auth.auth.getUser(session.access_token)
  if (error || !data.user) throw new ApiError(401, 'جلسة الدخول غير صالحة أو منتهية', 'invalid_session')
  const profile = await getProfile(data.user.id)
  if (!profile.is_active) throw new ApiError(403, 'تم إيقاف هذا الحساب. تواصل مع إدارة الموقع.', 'account_disabled')
  setSessionCookies(res, session)
  return res.status(200).json({ user: publicUser(data.user, profile) })
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setJsonHeaders(res)
  try {
    if (req.method === 'GET') {
      const accessToken = readAccessToken(req)
      const refreshToken = readRefreshToken(req)
      if (!accessToken || !refreshToken) throw new ApiError(401, 'يجب تسجيل الدخول أولاً', 'authentication_required')
      const client = getPublicAuthClient()
      const { data, error } = await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
      if (error || !data.session) throw new ApiError(401, 'جلسة الدخول غير صالحة أو منتهية', 'invalid_session')
      return await respondWithSession(res, data.session)
    }

    if (req.method === 'POST') {
      const accessToken = requireString(req.body?.access_token, 'access_token', 16_384)
      const refreshToken = requireString(req.body?.refresh_token, 'refresh_token', 16_384)
      const client = getPublicAuthClient()
      const { data, error } = await client.auth.setSession({ access_token: accessToken, refresh_token: refreshToken })
      if (error || !data.session) throw new ApiError(401, 'جلسة الدخول غير صالحة أو منتهية', 'invalid_session')
      return await respondWithSession(res, data.session)
    }

    if (req.method === 'DELETE') {
      clearSessionCookies(res)
      return res.status(204).send('')
    }

    return methodNotAllowed(res, ['GET', 'POST', 'DELETE'])
  } catch (error) {
    // Keep the response generic; the tokens are deliberately never included in diagnostics.
    return sendError(res, error)
  }
}
