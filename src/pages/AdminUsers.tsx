import { useEffect, useState } from 'react'
import { Copy, KeyRound, Plus, RefreshCw, Shield, Trash2, UserCheck, UserX, X } from 'lucide-react'
import { toast } from 'sonner'
import { apiJson, authHeaders } from '../lib/api'
import type { AdminUser, AppRole } from '../types'
import { useAuth } from '../contexts/AuthContext'
import { usePreferences } from '../contexts/PreferencesContext'

export default function AdminUsers() {
  const { user: actor } = useAuth()
  const { tr } = usePreferences()
  const roleLabels: Record<AppRole, string> = { owner: tr('مالك', 'Owner'), admin: tr('مدير نظام', 'Administrator'), manager: tr('مدير تشغيل', 'Manager'), editor: tr('محرر', 'Editor'), user: tr('مستخدم', 'User') }
  const [users, setUsers] = useState<AdminUser[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [credentials, setCredentials] = useState<{ username?: string; email?: string | null; temporaryPassword: string } | null>(null)
  const [form, setForm] = useState({ name: '', username: '', email: '', role: 'user' as AppRole, password: '' })

  const load = async () => {
    setLoading(true)
    try {
      const body = await apiJson<{ users: AdminUser[] }>('/api/admin/users', { headers: await authHeaders(false) })
      setUsers(body.users)
    } catch (error) { toast.error(error instanceof Error ? error.message : tr('تعذر تحميل المستخدمين', 'Could not load users')) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])

  const createUser = async () => {
    if (!form.name.trim() || !form.username.trim()) { toast.error(tr('الاسم واسم المستخدم مطلوبان', 'Name and username are required')); return }
    try {
      const body = await apiJson<{ user: AdminUser; credentials: { username: string; email: string | null; temporaryPassword: string } }>('/api/admin/users', {
        method: 'POST', headers: await authHeaders(), body: JSON.stringify({ ...form, email: form.email || undefined, password: form.password || undefined }),
      })
      setUsers((current) => [body.user, ...current])
      setCredentials(body.credentials)
      setShowCreate(false)
      setForm({ name: '', username: '', email: '', role: 'user', password: '' })
      toast.success(tr('تم إنشاء المستخدم', 'User created'))
    } catch (error) { toast.error(error instanceof Error ? error.message : tr('تعذر إنشاء المستخدم', 'Could not create user')) }
  }

  const patchUser = async (target: AdminUser, patch: Record<string, unknown>) => {
    setBusyId(target.id)
    try {
      const body = await apiJson<{ user: AdminUser; credentials?: { temporaryPassword: string } }>('/api/admin/users', {
        method: 'PATCH', headers: await authHeaders(), body: JSON.stringify({ id: target.id, ...patch }),
      })
      setUsers((current) => current.map((item) => item.id === target.id ? body.user : item))
      if (body.credentials?.temporaryPassword) setCredentials({ username: body.user.username || undefined, email: body.user.email || null, temporaryPassword: body.credentials.temporaryPassword })
      toast.success(tr('تم تحديث المستخدم', 'User updated'))
    } catch (error) { toast.error(error instanceof Error ? error.message : tr('تعذر تحديث المستخدم', 'Could not update user')) }
    finally { setBusyId(null) }
  }

  const deleteUser = async (target: AdminUser) => {
    if (!confirm(tr(`حذف المستخدم ${target.name} نهائيًا؟`, `Permanently delete ${target.name}?`))) return
    setBusyId(target.id)
    try {
      await apiJson('/api/admin/users', { method: 'DELETE', headers: await authHeaders(), body: JSON.stringify({ id: target.id }) })
      setUsers((current) => current.filter((item) => item.id !== target.id))
      toast.success(tr('تم حذف المستخدم', 'User deleted'))
    } catch (error) { toast.error(error instanceof Error ? error.message : tr('تعذر حذف المستخدم', 'Could not delete user')) }
    finally { setBusyId(null) }
  }

  const copy = async (value: string) => { await navigator.clipboard.writeText(value); toast.success(tr('تم النسخ', 'Copied')) }

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4 mb-8"><div><h1 className="text-3xl font-semibold">{tr('إدارة المستخدمين', 'User management')}</h1><p className="text-dark-400 mt-1">{tr('إنشاء حسابات، ضبط الأدوار والحالة، وإعادة تعيين كلمات المرور.', 'Create accounts, manage roles and status, and reset passwords.')}</p></div><button onClick={() => setShowCreate(true)} className="btn btn-primary"><Plus size={17} /> {tr('مستخدم جديد', 'New user')}</button></div>
      <div className="card overflow-x-auto">
        {loading ? <div className="p-12 text-center text-dark-400"><RefreshCw className="animate-spin mx-auto mb-3" /> {tr('جارٍ التحميل...', 'Loading...')}</div> : (
          <table className="table min-w-[900px]"><thead><tr><th className="p-5">{tr('المستخدم', 'User')}</th><th>{tr('الدخول', 'Sign-in')}</th><th>{tr('الدور', 'Role')}</th><th>{tr('الحالة', 'Status')}</th><th>{tr('آخر دخول', 'Last sign-in')}</th><th className="pl-5">{tr('الإجراءات', 'Actions')}</th></tr></thead><tbody>{users.map((item) => <tr key={item.id}>
            <td className="p-5"><div className="font-medium">{item.name}</div><div className="text-xs text-dark-500" dir="ltr">{item.email || item.loginEmail}</div></td>
            <td><div className="font-mono text-xs" dir="ltr">{item.username || item.email}</div>{item.mustChangePassword && <span className="text-[10px] text-amber-400">{tr('كلمة مؤقتة', 'Temporary password')}</span>}</td>
            <td><select className="input py-2 w-36" value={item.role} disabled={busyId === item.id || (item.role === 'owner' && actor?.role !== 'owner')} onChange={(e) => void patchUser(item, { role: e.target.value })}>{(['owner','admin','manager','editor','user'] as AppRole[]).filter((role) => role !== 'owner' || actor?.role === 'owner').map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></td>
            <td><span className={`inline-flex items-center gap-1 text-xs ${item.isActive ? 'text-emerald-400' : 'text-red-400'}`}>{item.isActive ? <UserCheck size={14} /> : <UserX size={14} />}{item.isActive ? tr('نشط', 'Active') : tr('موقوف', 'Suspended')}</span></td>
            <td className="text-xs text-dark-400">{item.lastLoginAt ? new Date(item.lastLoginAt).toLocaleString(tr('ar', 'en')) : tr('لم يدخل', 'Never')}</td>
            <td className="pl-5"><div className="flex gap-1"><button title={tr('إعادة تعيين كلمة المرور', 'Reset password')} disabled={busyId === item.id} onClick={() => void patchUser(item, { resetPassword: true })} className="btn btn-ghost p-2"><KeyRound size={16} /></button><button title={item.isActive ? tr('إيقاف', 'Suspend') : tr('تفعيل', 'Activate')} disabled={busyId === item.id || item.id === actor?.id} onClick={() => void patchUser(item, { isActive: !item.isActive })} className="btn btn-ghost p-2">{item.isActive ? <UserX size={16} /> : <UserCheck size={16} />}</button>{actor?.role === 'owner' && item.id !== actor.id && <button title={tr('حذف', 'Delete')} disabled={busyId === item.id} onClick={() => void deleteUser(item)} className="btn btn-ghost p-2 text-red-400"><Trash2 size={16} /></button>}</div></td>
          </tr>)}</tbody></table>
        )}
      </div>

      {showCreate && <div className="modal" onClick={() => setShowCreate(false)}><div className="modal-content p-7" onClick={(e) => e.stopPropagation()}><div className="flex justify-between mb-6"><h2 className="text-xl font-semibold">{tr('إنشاء مستخدم', 'Create user')}</h2><button onClick={() => setShowCreate(false)} aria-label={tr('إغلاق', 'Close')}><X /></button></div><div className="space-y-4"><input className="input" placeholder={tr('الاسم', 'Name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /><input className="input" dir="ltr" placeholder={tr('اسم المستخدم (مطلوب)', 'Username (required)')} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /><input className="input" dir="ltr" type="email" placeholder={tr('البريد (اختياري)', 'Email (optional)')} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /><select className="input" value={form.role} aria-label={tr('الدور', 'Role')} onChange={(e) => setForm({ ...form, role: e.target.value as AppRole })}>{(['user','editor','manager','admin','owner'] as AppRole[]).filter((role) => role !== 'owner' || actor?.role === 'owner').map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select><input className="input" type="password" placeholder={tr('كلمة مؤقتة (اتركها فارغة للتوليد الآمن)', 'Temporary password (leave blank to generate)')} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /><p className="text-xs text-dark-500">{tr('عند ترك البريد فارغًا، يُنشأ بريد داخلي ويكون الدخول باسم المستخدم. تُجبر الحسابات الجديدة على تغيير كلمة المرور.', 'If email is blank, an internal sign-in address is created. New managed accounts must change their temporary password.')}</p></div><button onClick={() => void createUser()} className="btn btn-primary w-full mt-6"><Shield size={16} /> {tr('إنشاء الحساب', 'Create account')}</button></div></div>}

      {credentials && <div className="modal"><div className="modal-content p-7"><h2 className="text-xl font-semibold mb-2">{tr('بيانات دخول مؤقتة', 'Temporary credentials')}</h2><p className="text-sm text-amber-400 mb-5">{tr('ستظهر كلمة المرور مرة واحدة فقط. انسخها الآن وأرسلها عبر قناة آمنة.', 'This password is shown once. Copy it now and share it through a secure channel.')}</p><div className="space-y-3">{credentials.username && <Credential label={tr('اسم المستخدم', 'Username')} value={credentials.username} onCopy={copy} />}{credentials.email && <Credential label={tr('البريد', 'Email')} value={credentials.email} onCopy={copy} />}<Credential label={tr('كلمة المرور المؤقتة', 'Temporary password')} value={credentials.temporaryPassword} onCopy={copy} /></div><button onClick={() => setCredentials(null)} className="btn btn-primary w-full mt-6">{tr('تم الحفظ', 'Saved')}</button></div></div>}
    </div>
  )
}

function Credential({ label, value, onCopy }: { label: string; value: string; onCopy: (value: string) => void }) {
  return <div><div className="text-xs text-dark-400 mb-1">{label}</div><div className="flex gap-2"><div className="input font-mono flex-1" dir="ltr">{value}</div><button onClick={() => void onCopy(value)} className="btn btn-secondary"><Copy size={16} /></button></div></div>
}
