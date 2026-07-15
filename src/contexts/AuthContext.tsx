import React, { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import type { User } from '../types'
import { apiJson, authHeaders } from '../lib/api'
import { supabase } from '../lib/supabase'

interface AuthContextType {
  user: User | null
  isLoading: boolean
  login: (identifier: string, password: string) => Promise<boolean>
  requestMagicLink: (email: string) => Promise<boolean>
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

const AuthContext = createContext<AuthContextType | undefined>(undefined)

const PRODUCTION_APP_URL = 'https://moatazasaif.vercel.app'

function isLocalOrigin(value: string) {
  try {
    const url = new URL(value)
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  } catch {
    return true
  }
}

function getAuthRedirectUrl() {
  const configured = import.meta.env.VITE_APP_URL || import.meta.env.NEXT_PUBLIC_APP_URL
  const current = typeof window !== 'undefined' ? window.location.origin : ''
  const candidate = configured?.trim() || (!isLocalOrigin(current) ? current : PRODUCTION_APP_URL)

  try {
    const url = new URL(candidate)
    if (url.protocol !== 'https:' || isLocalOrigin(url.origin)) return `${PRODUCTION_APP_URL}/login`
    return `${url.origin}/login`
  } catch {
    return `${PRODUCTION_APP_URL}/login`
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const navigate = useNavigate()

  const refreshUser = useCallback(async () => {
    if (!supabase) { setUser(null); return }
    const { data, error } = await supabase.auth.getSession()
    if (error || !data.session) { setUser(null); return }
    try {
      const body = await apiJson<{ user: User }>('/api/auth/me', { headers: { Authorization: `Bearer ${data.session.access_token}` } })
      setUser(body.user)
    } catch {
      await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined)
      setUser(null)
    }
  }, [])

  useEffect(() => {
    let mounted = true
    void refreshUser().finally(() => { if (mounted) setIsLoading(false) })
    const subscription = supabase?.auth.onAuthStateChange((event, session) => {
      if (!mounted) return
      if (!session) setUser(null)
      else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') void refreshUser()
    })
    return () => { mounted = false; subscription?.data.subscription.unsubscribe() }
  }, [refreshUser])

  const installSession = async (session: ApiSession | null) => {
    if (!session || !supabase) return false
    const { error } = await supabase.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token })
    if (error) throw error
    return true
  }

  const login = async (identifier: string, password: string) => {
    if (!supabase) { toast.error('إعدادات Supabase العامة غير صالحة أو لا تطابق المشروع. راجع VITE_SUPABASE_URL ومفتاح النشر العام في Vercel.'); return false }
    try {
      const body = await apiJson<{ session: ApiSession; user: User }>('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password }),
      })
      await installSession(body.session)
      setUser(body.user)
      toast.success(`مرحباً بك، ${body.user.name}`)
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تسجيل الدخول')
      return false
    }
  }

  const requestMagicLink = async (email: string) => {
    if (!supabase) { toast.error('إعدادات Supabase العامة غير صالحة أو لا تطابق المشروع. راجع VITE_SUPABASE_URL ومفتاح النشر العام في Vercel.'); return false }
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
      toast.error(/invalid api key/i.test(message)
        ? 'مفتاح Supabase العام غير صحيح أو لا يطابق رابط المشروع. راجع VITE_SUPABASE_PUBLISHABLE_KEY أو NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY في Vercel.'
        : message)
      return false
    }
  }

  const register = async (name: string, email: string, password: string, username?: string) => {
    if (!supabase) { toast.error('إعدادات Supabase غير موجودة'); return false }
    try {
      const body = await apiJson<{ session: ApiSession | null; user: User; requiresEmailConfirmation?: boolean }>('/api/auth/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, email, password, username }),
      })
      if (body.session) {
        await installSession(body.session)
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
    await supabase?.auth.signOut({ scope: 'local' }).catch(() => undefined)
    setUser(null)
    navigate('/')
  }

  const updateUser = async (updates: Partial<User>) => {
    if (!user) throw new Error('يجب تسجيل الدخول')
    try {
      const body = await apiJson<{ user: User }>('/api/auth/profile', {
        method: 'PATCH', headers: await authHeaders(), body: JSON.stringify({ name: updates.name, avatar: updates.avatar }),
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

  return <AuthContext.Provider value={{ user, isLoading, login, requestMagicLink, register, logout, updateUser, changePassword, refreshUser }}>{children}</AuthContext.Provider>
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used within AuthProvider')
  return context
}
