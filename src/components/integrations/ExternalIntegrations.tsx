import { useEffect, useState } from 'react'
import { CheckCircle, ExternalLink, Github, Loader2, MessageCircle, Power, RefreshCw, Send, ShieldCheck, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { apiJson, authHeaders } from '../../lib/api'

type ExternalIntegration = {
  id: string
  kind: 'github' | 'whatsapp'
  name: string
  accountId: string
  accountName?: string
  config: Record<string, unknown>
  isEnabled: boolean
  status: 'connected' | 'error' | 'disabled'
  lastCheckedAt?: string
  lastErrorMessage?: string
}

type GitHubRepository = { id: string; fullName: string; private: boolean; url: string; defaultBranch: string }

export default function ExternalIntegrations() {
  const [integrations, setIntegrations] = useState<ExternalIntegration[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [tested, setTested] = useState<'github' | 'whatsapp' | null>(null)
  const [repositories, setRepositories] = useState<Record<string, GitHubRepository[]>>({})
  const [github, setGithub] = useState({ name: 'GitHub', token: '' })
  const [whatsapp, setWhatsapp] = useState({ name: 'WhatsApp', accessToken: '', phoneNumberId: '', apiVersion: 'v25.0' })
  const [message, setMessage] = useState({ integrationId: '', recipient: '', text: 'رسالة اختبار من Moataz AI — الاتصال يعمل بنجاح.' })

  const load = async () => {
    setLoading(true)
    try {
      const body = await apiJson<{ integrations: ExternalIntegration[] }>('/api/integrations/external', { headers: await authHeaders(false) })
      setIntegrations(body.integrations || [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر تحميل تكاملات المنصات')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const testCredentials = async (kind: 'github' | 'whatsapp') => {
    setBusy(`test:${kind}`)
    try {
      const payload = kind === 'github'
        ? { kind, token: github.token }
        : { kind, accessToken: whatsapp.accessToken, phoneNumberId: whatsapp.phoneNumberId, apiVersion: whatsapp.apiVersion }
      await apiJson('/api/integrations/external/test', { method: 'POST', headers: await authHeaders(), body: JSON.stringify(payload) })
      setTested(kind)
      toast.success(kind === 'github' ? 'تم التحقق من حساب GitHub فعليًا' : 'تم التحقق من رقم WhatsApp Cloud API فعليًا')
    } catch (error) {
      setTested(null)
      toast.error(error instanceof Error ? error.message : 'فشل اختبار بيانات الاتصال')
    } finally {
      setBusy(null)
    }
  }

  const create = async (kind: 'github' | 'whatsapp') => {
    if (tested !== kind) { toast.error('اختبر بيانات الاتصال أولًا'); return }
    setBusy(`create:${kind}`)
    try {
      const payload = kind === 'github'
        ? { kind, name: github.name, token: github.token }
        : { kind, name: whatsapp.name, accessToken: whatsapp.accessToken, phoneNumberId: whatsapp.phoneNumberId, apiVersion: whatsapp.apiVersion }
      const body = await apiJson<{ integration: ExternalIntegration }>('/api/integrations/external', { method: 'POST', headers: await authHeaders(), body: JSON.stringify(payload) })
      setIntegrations((current) => [body.integration, ...current])
      if (kind === 'github') setGithub({ name: 'GitHub', token: '' })
      else setWhatsapp({ name: 'WhatsApp', accessToken: '', phoneNumberId: '', apiVersion: 'v25.0' })
      setTested(null)
      toast.success('تم حفظ بيانات الاتصال مشفّرة في الخادم')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر حفظ التكامل')
    } finally {
      setBusy(null)
    }
  }

  const action = async (integration: ExternalIntegration, actionName: 'check' | 'repositories' | 'set-enabled') => {
    setBusy(`${actionName}:${integration.id}`)
    try {
      const body = await apiJson<{ integration?: ExternalIntegration; repositories?: GitHubRepository[] }>('/api/integrations/external', {
        method: 'PATCH', headers: await authHeaders(), body: JSON.stringify({ action: actionName, integrationId: integration.id, ...(actionName === 'set-enabled' ? { isEnabled: !integration.isEnabled } : {}) }),
      })
      if (body.integration) setIntegrations((current) => current.map((item) => item.id === integration.id ? body.integration! : item))
      if (body.repositories) setRepositories((current) => ({ ...current, [integration.id]: body.repositories! }))
      toast.success(actionName === 'repositories' ? `تم تحميل ${body.repositories?.length || 0} مستودع` : actionName === 'check' ? 'الاتصال سليم' : integration.isEnabled ? 'تم تعطيل التكامل' : 'تم تفعيل التكامل')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'فشل تنفيذ العملية')
      if (actionName === 'check') void load()
    } finally {
      setBusy(null)
    }
  }

  const sendWhatsApp = async (integration: ExternalIntegration) => {
    setBusy(`send:${integration.id}`)
    try {
      await apiJson('/api/integrations/external', { method: 'PATCH', headers: await authHeaders(), body: JSON.stringify({ action: 'send-message', integrationId: integration.id, recipient: message.recipient, message: message.text }) })
      toast.success('أكد WhatsApp Cloud API إرسال الرسالة')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر إرسال رسالة الاختبار')
    } finally {
      setBusy(null)
    }
  }

  const remove = async (integration: ExternalIntegration) => {
    if (!confirm(`حذف تكامل ${integration.name}؟`)) return
    setBusy(`delete:${integration.id}`)
    try {
      await apiJson('/api/integrations/external', { method: 'DELETE', headers: await authHeaders(), body: JSON.stringify({ id: integration.id }) })
      setIntegrations((current) => current.filter((item) => item.id !== integration.id))
      toast.success('تم حذف التكامل وبيانات اعتماده المشفّرة')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر حذف التكامل')
    } finally {
      setBusy(null)
    }
  }

  return <section className="mt-8 space-y-5">
    <div>
      <h2 className="text-2xl font-semibold">اتصالات المنصات</h2>
      <p className="text-sm text-dark-400 mt-1 leading-7">اختبار فعلي من الخادم، تشفير AES-256-GCM، وحدود طلبات وسجل تدقيق. لا تعاد التوكنات إلى المتصفح بعد الحفظ.</p>
    </div>

    <div className="grid xl:grid-cols-2 gap-5">
      <details className="card p-5 group" open>
        <summary className="cursor-pointer list-none flex items-center justify-between gap-3"><span className="flex items-center gap-3 font-semibold text-lg"><Github /> ربط GitHub</span><span className="text-xs text-dark-500">Fine-grained token</span></summary>
        <div className="mt-5 space-y-4">
          <p className="text-xs text-dark-400 leading-6">أنشئ توكن محدود المستودعات والصلاحيات. لعمليات آلية طويلة الأجل يظل GitHub App هو الخيار الأفضل، لأن Installation Tokens قصيرة العمر.</p>
          <label className="block text-sm">اسم الاتصال<input className="input mt-1.5" value={github.name} onChange={(event) => { setGithub({ ...github, name: event.target.value }); setTested(null) }} /></label>
          <label className="block text-sm">Personal access token<input type="password" autoComplete="new-password" dir="ltr" className="input mt-1.5 font-mono" value={github.token} onChange={(event) => { setGithub({ ...github, token: event.target.value }); setTested(null) }} placeholder="github_pat_..." /></label>
          <div className="flex flex-wrap gap-2"><button className="btn btn-secondary" disabled={!github.token || busy === 'test:github'} onClick={() => void testCredentials('github')}>{busy === 'test:github' ? <Loader2 className="animate-spin" size={16} /> : <ShieldCheck size={16} />} اختبار حقيقي</button><button className="btn btn-primary" disabled={tested !== 'github' || busy === 'create:github'} onClick={() => void create('github')}>{busy === 'create:github' ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle size={16} />} تشفير وحفظ</button></div>
        </div>
      </details>

      <details className="card p-5 group">
        <summary className="cursor-pointer list-none flex items-center justify-between gap-3"><span className="flex items-center gap-3 font-semibold text-lg"><MessageCircle className="text-emerald-400" /> ربط WhatsApp</span><span className="text-xs text-dark-500">Cloud API</span></summary>
        <div className="mt-5 space-y-4">
          <p className="text-xs text-dark-400 leading-6">استخدم System User access token دائمًا وPhone Number ID من Meta. هذه المرحلة تختبر الرقم وترسل رسائل فعلية؛ استقبال Webhook يحتاج App Secret وVerify Token ويضاف عند تهيئة تطبيق Meta.</p>
          <div className="grid sm:grid-cols-2 gap-3"><label className="block text-sm">اسم الاتصال<input className="input mt-1.5" value={whatsapp.name} onChange={(event) => { setWhatsapp({ ...whatsapp, name: event.target.value }); setTested(null) }} /></label><label className="block text-sm">Phone Number ID<input inputMode="numeric" dir="ltr" className="input mt-1.5 font-mono" value={whatsapp.phoneNumberId} onChange={(event) => { setWhatsapp({ ...whatsapp, phoneNumberId: event.target.value }); setTested(null) }} /></label></div>
          <label className="block text-sm">System User access token<input type="password" autoComplete="new-password" dir="ltr" className="input mt-1.5 font-mono" value={whatsapp.accessToken} onChange={(event) => { setWhatsapp({ ...whatsapp, accessToken: event.target.value }); setTested(null) }} /></label>
          <div className="flex flex-wrap gap-2"><button className="btn btn-secondary" disabled={!whatsapp.accessToken || !whatsapp.phoneNumberId || busy === 'test:whatsapp'} onClick={() => void testCredentials('whatsapp')}>{busy === 'test:whatsapp' ? <Loader2 className="animate-spin" size={16} /> : <ShieldCheck size={16} />} اختبار حقيقي</button><button className="btn btn-primary" disabled={tested !== 'whatsapp' || busy === 'create:whatsapp'} onClick={() => void create('whatsapp')}>{busy === 'create:whatsapp' ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle size={16} />} تشفير وحفظ</button></div>
        </div>
      </details>
    </div>

    {loading ? <div className="card p-10 text-center text-dark-400"><Loader2 className="animate-spin mx-auto mb-3" />جارٍ تحميل الاتصالات...</div> : integrations.length === 0 ? <div className="card p-8 text-center text-dark-400">لا توجد اتصالات GitHub أو WhatsApp محفوظة بعد.</div> : <div className="grid xl:grid-cols-2 gap-5">{integrations.map((integration) => <article key={integration.id} className="card p-5">
      <div className="flex items-start justify-between gap-3"><div className="flex items-center gap-3">{integration.kind === 'github' ? <Github /> : <MessageCircle className="text-emerald-400" />}<div><h3 className="font-semibold">{integration.name}</h3><p className="text-xs text-dark-500" dir="ltr">{integration.accountName || integration.accountId}</p></div></div><span className={`provider-badge ${integration.status === 'connected' ? 'text-emerald-400 border-emerald-700' : integration.status === 'error' ? 'text-red-400 border-red-700' : 'text-amber-400 border-amber-700'}`}>{integration.status === 'connected' ? 'متصل' : integration.status === 'error' ? 'خطأ' : 'معطل'}</span></div>
      {integration.lastErrorMessage && <p className="mt-3 p-3 rounded-xl bg-red-500/10 text-xs text-red-300">{integration.lastErrorMessage}</p>}
      <div className="flex flex-wrap gap-2 mt-4"><button className="btn btn-secondary text-xs" disabled={busy === `check:${integration.id}`} onClick={() => void action(integration, 'check')}><RefreshCw size={14} className={busy === `check:${integration.id}` ? 'animate-spin' : ''} /> فحص</button><button className="btn btn-secondary text-xs" onClick={() => void action(integration, 'set-enabled')}><Power size={14} /> {integration.isEnabled ? 'تعطيل' : 'تفعيل'}</button>{integration.kind === 'github' && <button className="btn btn-secondary text-xs" disabled={!integration.isEnabled || busy === `repositories:${integration.id}`} onClick={() => void action(integration, 'repositories')}><Github size={14} /> المستودعات</button>}<button className="btn btn-ghost text-red-400 text-xs" disabled={busy === `delete:${integration.id}`} onClick={() => void remove(integration)}><Trash2 size={14} /> حذف</button></div>
      {repositories[integration.id] && <div className="mt-4 max-h-52 overflow-auto rounded-xl border border-dark-700 divide-y divide-dark-700">{repositories[integration.id].map((repository) => <a key={repository.id} href={repository.url} target="_blank" rel="noreferrer" className="flex items-center justify-between gap-3 p-3 text-sm hover:bg-dark-900"><span className="truncate" dir="ltr">{repository.fullName}</span><span className="flex items-center gap-2 text-xs text-dark-500">{repository.private ? 'خاص' : 'عام'} <ExternalLink size={12} /></span></a>)}</div>}
      {integration.kind === 'whatsapp' && <div className="mt-4 space-y-3 border-t border-dark-700 pt-4"><label className="block text-xs">رقم الاختبار بصيغة دولية<input inputMode="tel" dir="ltr" className="input mt-1.5" value={message.integrationId === integration.id ? message.recipient : ''} onChange={(event) => setMessage({ ...message, integrationId: integration.id, recipient: event.target.value })} placeholder="+967..." /></label><label className="block text-xs">الرسالة<textarea className="textarea mt-1.5" value={message.integrationId === integration.id ? message.text : 'رسالة اختبار من Moataz AI — الاتصال يعمل بنجاح.'} onChange={(event) => setMessage({ ...message, integrationId: integration.id, text: event.target.value })} /></label><button className="btn btn-primary text-xs" disabled={!integration.isEnabled || message.integrationId !== integration.id || !message.recipient || busy === `send:${integration.id}`} onClick={() => void sendWhatsApp(integration)}>{busy === `send:${integration.id}` ? <Loader2 className="animate-spin" size={14} /> : <Send size={14} />} إرسال اختبار فعلي</button></div>}
    </article>)}</div>}
  </section>
}
