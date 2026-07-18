import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import type { User } from '../types'
import { apiJson, authHeaders } from '../lib/api'
import { getSupabaseBrowserConfig, supabase } from '../lib/supabase'
import { getAuthRedirectUrl } from '../lib/auth-redirect'
import { getOAuthProviderAvailability, type OAuthProvider } from '../lib/oauth-provider'
import { usePreferences } from './PreferencesContext'

export type { OAuthProvider } from '../lib/oauth-provider'

interface AuthContextType {
  user: User | null
  isLoading: boolean
  login: (identifier: string, password: string) => Promise<boolean>
  requestMagicLink: (email: string) => Promise<boolean>
  signInWithOAuth: (provider: OAuthProvider) => Promise<boolean>
  register: (name: string, email: string, password: string, username?: string) => Promise<boolean>
  logout: () => Promise<void>
  updateUser: (updates: Partial<User>) => Promise<void>
  changePassword: (password: string) => Promise<boolean>
  refreshUser: () => Promise<void>
}

interface ApiSession {
  access_token: string
  refresh_token: string
  expires_in?: number
  expires_at?: number
}

interface SessionResponse { user: User }

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const navigate = useNavigate()
  const { tr } = usePreferences()

  const persistSessionCookie = useCallback(async (session: ApiSession | null) => {
    if (!session) return
    await apiJson<SessionResponse>('/api/auth/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(session),
    })
  }, [])

  const refreshUser = useCallback(async () => {
    if (!supabase) { setUser(null); return }
    const { data, error } = await supabase.auth.getSession()
    if (!error && data.session) {
      await persistSessionCookie({ access_token: data.session.access_token, refresh_token: data.session.refresh_token, expires_in: data.session.expires_in, expires_at: data.session.expires_at }).catch(() => undefined)
      await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
    }
    try {
      const restored = await apiJson<SessionResponse>('/api/auth/session')
      setUser(restored.user)
      return
    } catch {
      try {
        const local = (await supabase.auth.getSession()).data.session
        if (local) {
          await persistSessionCookie({ access_token: local.access_token, refresh_token: local.refresh_token, expires_in: local.expires_in, expires_at: local.expires_at })
          await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
          const restored = await apiJson<SessionResponse>('/api/auth/session')
          setUser(restored.user)
          return
        }
      } catch {
        // Fall through to the anonymous state without surfacing token details.
      }
    }
    setUser(null)
  }, [persistSessionCookie])

  useEffect(() => {
    let mounted = true
    void refreshUser().finally(() => { if (mounted) setIsLoading(false) })
    const subscription = supabase?.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return
      if (!session) setUser(null)
      else {
        void persistSessionCookie({ access_token: session.access_token, refresh_token: session.refresh_token, expires_in: session.expires_in, expires_at: session.expires_at }).catch(() => undefined)
        window.setTimeout(() => { if (mounted) void refreshUser() }, 0)
      }
    })
    return () => { mounted = false; subscription?.data.subscription.unsubscribe() }
  }, [persistSessionCookie, refreshUser])

  const login = async (identifier: string, password: string) => {
    if (!supabase) { toast.error(tr('خدمة تسجيل الدخول غير متاحة مؤقتًا. حاول لاحقًا.', 'Sign-in is temporarily unavailable. Please try again later.')); return false }
    try {
      const body = await apiJson<{ user: User }>('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password }),
      })
      setUser(body.user)
      toast.success(`مرحباً بك، ${body.user.name}`)
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تسجيل الدخول')
      return false
    }
  }

  const requestMagicLink = async (email: string) => {
    if (!supabase) { toast.error(tr('خدمة تسجيل الدخول غير متاحة مؤقتًا. حاول لاحقًا.', 'Sign-in is temporarily unavailable. Please try again later.')); return false }
    try {
      const normalizedEmail = email.trim().toLowerCase()
      if (!normalizedEmail || !normalizedEmail.includes('@')) throw new Error('أدخل بريدًا إلكترونيًا صالحًا')
      const { error } = await supabase.auth.signInWithOtp({
        email: normalizedEmail,
        options: { emailRedirectTo: getAuthRedirectUrl() },
      })
      if (error) throw error
      toast.success('تم إرسال رابط دخول آمن إلى بريدك الإلكتروني')
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'تعذر إرسال رابط الدخول'
      toast.error(/invalid api key/i.test(message) ? tr('تعذر الاتصال بخدمة تسجيل الدخول.', 'Could not connect to the sign-in service.') : message)
      return false
    }
  }

  const signInWithOAuth = async (provider: OAuthProvider) => {
    if (!supabase) {
      toast.error(tr('خدمة تسجيل الدخول غير متاحة مؤقتًا.', 'Sign-in is temporarily unavailable.'))
      return false
    }
    try {
      const browserConfig = getSupabaseBrowserConfig()
      if (!browserConfig) throw new Error(tr('خدمة تسجيل الدخول غير مهيأة', 'The sign-in service is not configured'))

      const availability = await getOAuthProviderAvailability(browserConfig, provider)
      if (availability === 'disabled') {
        toast.error(tr(`تسجيل الدخول عبر ${provider === 'google' ? 'Google' : 'GitHub'} غير متاح حاليًا.`, `Sign-in with ${provider === 'google' ? 'Google' : 'GitHub'} is currently unavailable.`))
        return false
      }
      if (availability === 'unreachable') {
        toast.error(tr('تعذر الوصول إلى خدمة تسجيل الدخول. تحقق من الشبكة أو DNS ثم أعد المحاولة.', 'The sign-in service could not be reached. Check your network or DNS and try again.'))
        return false
      }
      if (availability === 'unknown') {
        toast.error(tr('تعذر التحقق من خدمة تسجيل الدخول الآن. أعد المحاولة.', 'The sign-in service could not be verified. Please try again.'))
        return false
      }

      // The authorization code is exchanged by a Vercel Function, which sets
      // HttpOnly Secure cookies. No provider token is exposed to the page URL.
      const query = new URLSearchParams({ provider })
      window.location.assign(`/api/auth/oauth-start?${query.toString()}`)
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'تعذر بدء تسجيل الدخول عبر المزود'
      if (/provider.*(not enabled|disabled|unsupported)/i.test(message)) {
        toast.error(tr(`تسجيل الدخول عبر ${provider === 'google' ? 'Google' : 'GitHub'} غير متاح حاليًا.`, `Sign-in with ${provider === 'google' ? 'Google' : 'GitHub'} is currently unavailable.`))
      } else if (/redirect|url.*not allowed/i.test(message)) {
        toast.error(tr('تعذر إكمال تسجيل الدخول بسبب إعداد عنوان العودة. تواصل مع إدارة الموقع.', 'Sign-in could not complete because of a return URL configuration. Contact the site administrator.'))
      } else {
        toast.error(message)
      }
      return false
    }
  }

  const register = async (name: string, email: string, password: string, username?: string) => {
    if (!supabase) { toast.error(tr('خدمة إنشاء الحساب غير متاحة مؤقتًا.', 'Account creation is temporarily unavailable.')); return false }
    try {
      const body = await apiJson<{ user: User; requiresEmailConfirmation?: boolean }>('/api/auth/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email, password, username }),
      })
      if (!body.requiresEmailConfirmation) {
        setUser(body.user)
        toast.success('تم إنشاء الحساب وتسجيل الدخول')
        return true
      }
      setUser(null)
      toast.success('تم إنشاء الحساب. تحقق من بريدك لتأكيده ثم سجّل الدخول.')
      return false
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر إنشاء الحساب')
      return false
    }
  }

  const logout = async () => {
    await fetch('/api/auth/session', { method: 'DELETE', credentials: 'same-origin' }).catch(() => undefined)
    await supabase?.auth.signOut({ scope: 'local' }).catch(() => undefined)
    setUser(null)
    navigate('/')
  }

  const updateUser = async (updates: Partial<User>) => {
    if (!user) throw new Error('يجب تسجيل الدخول')
    try {
      const body = await apiJson<{ user: User }>('/api/auth/profile', {
        method: 'PATCH', headers: await authHeaders(), body: JSON.stringify({ name: updates.name, avatar: updates.avatar, preferences: updates.preferences }),
      })
      setUser(body.user)
      toast.success('تم تحديث الملف الشخصي')
    } catch (error) { toast.error(error instanceof Error ? error.message : 'تعذر تحديث الملف الشخصي') }
  }

  const changePassword = async (password: string) => {
    try {
      await apiJson('/api/auth/password', { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ password }) })
      setUser((current) => current ? { ...current, forcePasswordChange: false } : current)
      toast.success('تم تغيير كلمة المرور')
      return true
    } catch (error) { toast.error(error instanceof Error ? error.message : 'تعذر تغيير كلمة المرور'); return false }
  }

  return <AuthContext.Provider value={{ user, isLoading, login, requestMagicLink, signInWithOAuth, register, logout, updateUser, changePassword, refreshUser }}>{children}</AuthContext.Provider>
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
