import { createClient, type SupabaseClient, type User as AuthUser } from '@supabase/supabase-js'
import type { VercelRequest } from './vercel.js'
import { ApiError, getBearerToken } from './http.js'
import { getServerEnv } from './env.js'
import { normalizeUserPreferences, type UserPreferences } from '../../shared/user-preferences.js'
import { readAccessToken } from './auth-session.js'

export type AppRole = 'owner' | 'admin' | 'manager' | 'editor' | 'user'

export interface ProfileRow {
  id: string
  username: string | null
  display_name: string
  avatar_url: string | null
  role: AppRole
  is_active: boolean
  must_change_password: boolean
  is_internal_email: boolean
  created_by: string | null
  last_login_at: string | null
  created_at: string
  updated_at: string
  preferences: UserPreferences
}

const OWNER_EMAILS = new Set(['mtzallqmy@gmail.com', 'moataz77549@gmail.com'])

let adminClient: SupabaseClient | undefined

export function getAdminClient(): SupabaseClient {
  if (!adminClient) {
    const env = getServerEnv()
    adminClient = createClient(env.supabaseUrl, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    })
  }
  return adminClient
}

export function getPublicAuthClient(): SupabaseClient {
  const env = getServerEnv()
  return createClient(env.supabaseUrl, env.supabasePublishableKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
}

export function getUserClient(token: string): SupabaseClient {
  const env = getServerEnv()
  return createClient(env.supabaseUrl, env.supabasePublishableKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
}

export async function getProfile(userId: string): Promise<ProfileRow> {
  const admin = getAdminClient()
  const { data, error } = await admin.from('profiles').select('*').eq('id', userId).maybeSingle()
  if (error) throw new ApiError(500, 'تعذر قراءة ملف المستخدم', 'profile_read_failed')
  if (!data) throw new ApiError(403, 'حساب المستخدم غير مهيأ في قاعدة البيانات', 'profile_missing')
  return data as ProfileRow
}

/**
 * OAuth can create an Auth user even when an older installation is missing
 * the profile trigger. Repair only the absent row and always default to the
 * least-privileged role; ownership is restricted to the two verified emails.
 */
export async function getOrCreateProfile(user: AuthUser): Promise<ProfileRow> {
  try {
    return await getProfile(user.id)
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== 'profile_missing') throw error
  }

  const email = (user.email || '').trim().toLowerCase()
  const metadataName = typeof user.user_metadata?.full_name === 'string'
    ? user.user_metadata.full_name.trim()
    : typeof user.user_metadata?.name === 'string'
      ? user.user_metadata.name.trim()
      : ''
  const displayName = (metadataName || email.split('@')[0] || 'مستخدم').slice(0, 120)
  const admin = getAdminClient()
  const { error } = await admin.from('profiles').upsert({
    id: user.id,
    display_name: displayName,
    role: OWNER_EMAILS.has(email) ? 'owner' : 'user',
    is_active: true,
    must_change_password: false,
    is_internal_email: false,
  }, { onConflict: 'id', ignoreDuplicates: true })
  if (error) throw new ApiError(500, 'تعذر تهيئة ملف المستخدم', 'profile_create_failed')
  return getProfile(user.id)
}

export async function authenticate(req: VercelRequest): Promise<{
  token: string
  user: AuthUser
  profile: ProfileRow
  client: SupabaseClient
}> {
  const token = getBearerToken(req) || readAccessToken(req)
  if (!token) throw new ApiError(401, 'يجب تسجيل الدخول أولاً', 'authentication_required')

  const client = getUserClient(token)
  const { data, error } = await client.auth.getUser(token)
  if (error || !data.user) throw new ApiError(401, 'جلسة الدخول غير صالحة أو منتهية', 'invalid_session')

  const profile = await getOrCreateProfile(data.user)
  if (!profile.is_active) throw new ApiError(403, 'تم إيقاف هذا الحساب. تواصل مع إدارة الموقع.', 'account_disabled')

  return { token, user: data.user, profile, client }
}

export async function requireRoles(req: VercelRequest, roles: AppRole[]) {
  const auth = await authenticate(req)
  if (!roles.includes(auth.profile.role)) {
    throw new ApiError(403, 'ليس لديك صلاحية لتنفيذ هذه العملية', 'insufficient_role')
  }
  return auth
}

export function publicUser(user: AuthUser, profile: ProfileRow) {
  return {
    id: user.id,
    name: profile.display_name || user.email?.split('@')[0] || 'مستخدم',
    username: profile.username,
    email: profile.is_internal_email ? '' : (user.email || ''),
    loginEmail: user.email || '',
    avatar: profile.avatar_url || undefined,
    role: profile.role,
    roles: [profile.role],
    isActive: profile.is_active,
    forcePasswordChange: profile.must_change_password,
    preferences: normalizeUserPreferences(profile.preferences),
    createdAt: profile.created_at || user.created_at,
  }
}
