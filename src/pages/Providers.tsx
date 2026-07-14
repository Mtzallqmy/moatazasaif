import { useEffect, useMemo, useState } from 'react'
import { Bot, CheckCircle, ChevronDown, ChevronUp, Clock3, Play, Plus, RefreshCw, Trash2, XCircle, Shield, Eraser } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { PROVIDER_DEFINITIONS, type ProviderProtocol } from '../../shared/provider-registry'
import { apiJson, authHeaders } from '../lib/api'
import { clearSessionData, getSessionProvider, saveSessionProvider, type SessionProviderCredential } from '../lib/session-provider'
import { useAuth } from '../contexts/AuthContext'
import type { Provider, ProviderDiagnostic, ProviderType } from '../types'

const categoryLabels: Record<string, string> = {
  authentication: 'فشل المصادقة', authorization: 'صلاحية غير كافية', rate_limit: 'تجاوز الحد', quota: 'نفد الرصيد',
  model: 'النموذج غير موجود', endpoint: 'Base URL/Endpoint غير صحيح', validation: 'صيغة الطلب', network: 'المزود غير متاح',
  timeout: 'انتهت المهلة', upstream: 'خطأ من خادم المزود', unknown: 'غير مصنف',
}

type FormState = { name: string; type: ProviderType; protocol: ProviderProtocol; apiKey: string; baseUrl: string; model: string }
const emptyForm: FormState = { name: '', type: 'openai', protocol: 'openai-compatible', apiKey: '', baseUrl: '', model: '' }

export default function Providers() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [providers, setProviders] = useState<Provider[]>([])
  const [sessionProvider, setSessionProvider] = useState<SessionProviderCredential | null>(() => getSessionProvider())
  const [showAddModal, setShowAddModal] = useState(false)
  const [testingId, setTestingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [credentialMode, setCredentialMode] = useState<'session' | 'saved'>('session')

  const definitions = PROVIDER_DEFINITIONS as readonly typeof PROVIDER_DEFINITIONS[number][]
  const selectedDefinition = useMemo(() => definitions.find((item) => item.type === form.type), [definitions, form.type])
  const needsBaseUrl = Boolean(selectedDefinition?.requiresCustomBaseUrl)
  const isCustom = form.type === 'custom'

  const loadProviders = async () => {
    if (!user) { setProviders([]); setLoading(false); return }
    setLoading(true)
    try {
      const body = await apiJson<{ providers: Provider[] }>('/api/providers', { headers: await authHeaders(false) })
      setProviders(body.providers || [])
    } catch (error) { toast.error(error instanceof Error ? error.message : 'تعذر تحميل المزودات') }
    finally { setLoading(false) }
  }

  useEffect(() => {
    void loadProviders()
    const handler = () => setSessionProvider(getSessionProvider())
    window.addEventListener('moataz:session-provider-changed', handler)
    return () => window.removeEventListener('moataz:session-provider-changed', handler)
  }, [user])

  const testSessionConfig = async (config: { type: ProviderType; protocol?: ProviderProtocol; apiKey: string; baseUrl?: string; model?: string }) => {
    const body = await apiJson<ProviderDiagnostic>('/api/providers/test', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credentialMode: 'session', provider: config }),
    })
    return body
  }

  const addProvider = async () => {
    if (!form.name.trim() || !form.apiKey.trim()) { toast.error('الاسم ومفتاح API مطلوبان'); return }
    if (credentialMode === 'saved' && !user) { toast.error('سجّل الدخول لحفظ المفتاح مشفّرًا، أو اختر الجلسة المؤقتة'); return }
    if (needsBaseUrl && !form.baseUrl.trim()) { toast.error('Base URL مطلوب لهذا النوع'); return }
    setTestingId('new')
    try {
      if (credentialMode === 'session') {
        const diagnostic = await testSessionConfig({ type: form.type, protocol: isCustom ? form.protocol : undefined, apiKey: form.apiKey, baseUrl: form.baseUrl || undefined, model: form.model || undefined })
        if (!diagnostic.success) throw Object.assign(new Error(diagnostic.providerMessage || diagnostic.message), { details: diagnostic })
        const stored = saveSessionProvider({
          name: form.name.trim(), type: form.type, protocol: diagnostic.detectedProtocol,
          baseUrl: form.baseUrl || selectedDefinition?.defaultBaseUrl || '', apiKey: form.apiKey,
          model: diagnostic.testedModel || form.model || diagnostic.models[0], models: diagnostic.models,
          status: 'connected', diagnostic, lastTested: new Date().toISOString(),
        })
        setSessionProvider(stored)
        toast.success('تم اختبار المزود فعليًا وحُفظ للمحاولة الحالية فقط')
      } else {
        const created = await apiJson<{ provider: Provider }>('/api/providers', {
          method: 'POST', headers: await authHeaders(),
          body: JSON.stringify({ credentialMode: 'saved', name: form.name, type: form.type, protocol: isCustom ? form.protocol : undefined, apiKey: form.apiKey, baseUrl: form.baseUrl || undefined, model: form.model || undefined }),
        })
        // The saved path is tested through providerId after encryption and
        // ownership validation; do not report success from an ephemeral
        // preflight request.
        let diagnostic: ProviderDiagnostic
        try {
          diagnostic = await apiJson<ProviderDiagnostic>('/api/providers/test', {
            method: 'POST', headers: await authHeaders(),
            body: JSON.stringify({ credentialMode: 'saved', providerId: created.provider.id }),
          })
        } catch (error: any) {
          const failed = error?.details as ProviderDiagnostic | undefined
          setProviders((current) => [{
            ...created.provider,
            status: 'error',
            diagnostic: failed,
            models: failed?.models || [],
            detectedProtocol: failed?.detectedProtocol,
            lastLatencyMs: failed?.latencyMs,
            lastHttpStatus: failed?.httpStatus,
            errorMessage: failed?.providerMessage || error?.message,
          }, ...current])
          setExpandedId(created.provider.id)
          throw Object.assign(new Error(failed?.providerMessage || error?.message || 'فشل اختبار المزود المحفوظ'), { details: failed })
        }
        const savedProvider: Provider = {
          ...created.provider,
          status: 'connected',
          models: diagnostic.models,
          model: diagnostic.testedModel || created.provider.model || diagnostic.models[0],
          diagnostic,
          detectedProtocol: diagnostic.detectedProtocol,
          lastLatencyMs: diagnostic.latencyMs,
          lastHttpStatus: diagnostic.httpStatus,
          lastTested: new Date().toISOString(),
        }
        setProviders((current) => [savedProvider, ...current])
        toast.success('تم اختبار المزود المحفوظ فعليًا وحفظ المفتاح مشفّرًا داخل حسابك')
      }
      setShowAddModal(false); setForm(emptyForm)
    } catch (error: any) {
      const diagnostic = error?.details as ProviderDiagnostic | undefined
      toast.error(diagnostic?.providerMessage || error?.message || 'فشل اختبار المزود')
    } finally { setTestingId(null) }
  }

  const testSavedProvider = async (provider: Provider) => {
    setTestingId(provider.id)
    try {
      const body = await apiJson<ProviderDiagnostic>('/api/providers/test', { method: 'POST', headers: await authHeaders(), body: JSON.stringify({ credentialMode: 'saved', providerId: provider.id }) })
      const updated = { ...provider, status: body.success ? 'connected' as const : 'error' as const, models: body.models, diagnostic: body, detectedProtocol: body.detectedProtocol, lastLatencyMs: body.latencyMs, lastHttpStatus: body.httpStatus, lastTested: new Date().toISOString(), errorMessage: body.success ? undefined : body.providerMessage }
      setProviders((current) => current.map((item) => item.id === provider.id ? updated : item)); setExpandedId(provider.id)
      if (body.success) toast.success(body.message); else toast.error(body.providerMessage || body.message)
    } catch (error: any) {
      const diagnostic = error?.details as ProviderDiagnostic | undefined
      setProviders((current) => current.map((item) => item.id === provider.id ? { ...item, status: 'error', diagnostic, errorMessage: diagnostic?.providerMessage || error.message } : item)); setExpandedId(provider.id)
      toast.error(diagnostic?.providerMessage || error.message || 'فشل الاتصال')
    } finally { setTestingId(null) }
  }

  const testSessionProvider = async () => {
    if (!sessionProvider) return
    setTestingId('session')
    try {
      const diagnostic = await testSessionConfig({ type: sessionProvider.type, protocol: sessionProvider.protocol, apiKey: sessionProvider.apiKey, baseUrl: sessionProvider.baseUrl, model: sessionProvider.model })
      const updated = { ...sessionProvider, status: diagnostic.success ? 'connected' as const : 'error' as const, diagnostic, models: diagnostic.models, model: diagnostic.testedModel || sessionProvider.model, lastTested: new Date().toISOString() }
      saveSessionProvider(updated); setSessionProvider(updated); setExpandedId('session')
      if (diagnostic.success) toast.success(diagnostic.message); else toast.error(diagnostic.providerMessage || diagnostic.message)
    } catch (error: any) {
      const diagnostic = error?.details as ProviderDiagnostic | undefined
      if (diagnostic) {
        const updated = { ...sessionProvider, status: 'error' as const, diagnostic, models: diagnostic.models || [], lastTested: new Date().toISOString() }
        saveSessionProvider(updated); setSessionProvider(updated); setExpandedId('session')
      }
      toast.error(diagnostic?.providerMessage || diagnostic?.message || error.message || 'فشل الاتصال')
    }
    finally { setTestingId(null) }
  }

  const deleteProvider = async (id: string) => {
    if (!confirm('حذف المزود المحفوظ نهائيًا؟')) return
    try { await apiJson('/api/providers', { method: 'DELETE', headers: await authHeaders(), body: JSON.stringify({ id }) }); setProviders((current) => current.filter((item) => item.id !== id)); toast.success('تم حذف المزود') }
    catch (error) { toast.error(error instanceof Error ? error.message : 'تعذر حذف المزود') }
  }

  const clearSession = async () => {
    try {
      await clearSessionData()
      setSessionProvider(null)
      toast.success('تم مسح مفتاح الجلسة والمحادثات المحلية')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر مسح بيانات الجلسة')
    }
  }

  const updateModel = async (provider: Provider, model: string) => {
    try { const body = await apiJson<{ provider: Provider }>('/api/providers', { method: 'PATCH', headers: await authHeaders(), body: JSON.stringify({ id: provider.id, model }) }); setProviders((current) => current.map((item) => item.id === provider.id ? body.provider : item)) }
    catch (error) { toast.error(error instanceof Error ? error.message : 'تعذر تحديث النموذج') }
  }

  return <div className="p-6 max-w-6xl mx-auto">
    <div className="flex items-start justify-between mb-8 gap-4"><div><h1 className="text-3xl font-semibold tracking-tight">مزودو الذكاء الاصطناعي</h1><p className="text-dark-400 mt-1">اختبار فعلي للمفتاح واكتشاف النماذج. لا تظهر مفاتيح المزودات المحفوظة مرة أخرى.</p></div><button onClick={() => setShowAddModal(true)} className="btn btn-primary"><Plus size={18} /> إضافة مزود</button></div>
    <div className="card p-4 mb-6 border-primary-500/30 bg-primary-500/5 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><Shield size={18} className="text-primary-400" /><div><div className="font-medium">وضع الجلسة المؤقتة</div><p className="text-xs text-dark-400">المفتاح في sessionStorage فقط، والمحادثات في IndexedDB على هذا الجهاز.</p></div></div><button onClick={() => void clearSession()} className="btn btn-secondary text-xs"><Eraser size={14} /> مسح بيانات الجلسة</button></div>
    {sessionProvider && <ProviderCard provider={{ ...sessionProvider, credentialMode: 'session' }} isSession onTest={() => void testSessionProvider()} testing={testingId === 'session'} expanded={expandedId === 'session'} onExpand={() => setExpandedId(expandedId === 'session' ? null : 'session')} onStart={() => navigate('/chat')} onDelete={() => void clearSession()} onModelChange={(model) => { const next = { ...sessionProvider, model }; saveSessionProvider(next); setSessionProvider(next) }} />}
    {user && <>{loading ? <div className="card p-12 text-center text-dark-400">جارٍ تحميل المزودات المحفوظة...</div> : providers.length === 0 ? <div className="card p-10 text-center text-dark-400">لا يوجد مزود محفوظ. أضف واحدًا بعد تسجيل الدخول.</div> : <div className="grid gap-4">{providers.map((provider) => <ProviderCard key={provider.id} provider={provider} onTest={() => void testSavedProvider(provider)} testing={testingId === provider.id} expanded={expandedId === provider.id} onExpand={() => setExpandedId(expandedId === provider.id ? null : provider.id)} onDelete={() => void deleteProvider(provider.id)} onStart={() => navigate('/chat')} onModelChange={(model) => void updateModel(provider, model)} />)}</div>}</>}
    {!user && !sessionProvider && <div className="card p-12 text-center"><Bot className="mx-auto text-dark-600 mb-4" size={48} /><h3 className="text-xl font-medium mb-2">ابدأ بوضع جلسة مؤقتة</h3><p className="text-dark-400">لا تحتاج إلى حساب لاختبار مفتاحك وبدء محادثة حقيقية.</p></div>}

    {showAddModal && <div className="modal" onClick={() => setShowAddModal(false)}><div className="modal-content p-8 max-w-xl" onClick={(event) => event.stopPropagation()}><h2 className="text-2xl font-semibold mb-5">إضافة مزود واختباره</h2><div className="flex gap-2 p-1 rounded-2xl bg-dark-800 mb-5"><button className={`flex-1 py-2 rounded-xl text-sm ${credentialMode === 'session' ? 'bg-primary-600 text-white' : 'text-dark-400'}`} onClick={() => setCredentialMode('session')}>جلسة مؤقتة — لا يتم الحفظ</button><button className={`flex-1 py-2 rounded-xl text-sm ${credentialMode === 'saved' ? 'bg-primary-600 text-white' : 'text-dark-400'}`} onClick={() => setCredentialMode('saved')} disabled={!user}>حفظ مشفّر في الحساب</button></div><div className="space-y-4"><div><label className="text-sm text-dark-300 block mb-1.5">اسم المزود</label><input className="input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="OpenAI الخاص بي" /></div><div><label className="text-sm text-dark-300 block mb-1.5">نوع المزود</label><select className="input" value={form.type} onChange={(event) => { const type = event.target.value as ProviderType; const definition = definitions.find((item) => item.type === type); setForm({ ...form, type, protocol: definition?.protocol || 'openai-compatible', baseUrl: '' }) }}>{definitions.map((item) => <option key={item.type} value={item.type}>{item.label}</option>)}</select></div>{isCustom && <div><label className="text-sm text-dark-300 block mb-1.5">البروتوكول</label><select className="input" value={form.protocol} onChange={(event) => setForm({ ...form, protocol: event.target.value as ProviderProtocol })}>{(['openai-compatible', 'gemini', 'anthropic'] as const).map((protocol) => <option key={protocol} value={protocol}>{protocol}</option>)}</select></div>}<div><label className="text-sm text-dark-300 block mb-1.5">Base URL {needsBaseUrl ? '*' : '(اختياري)'}</label><input className="input font-mono text-sm" dir="ltr" value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} placeholder={selectedDefinition?.defaultBaseUrl || 'https://api.example.com/v1'} /></div><div><label className="text-sm text-dark-300 block mb-1.5">API Key</label><input type="password" autoComplete="new-password" className="input font-mono text-sm" dir="ltr" value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })} /></div><div><label className="text-sm text-dark-300 block mb-1.5">النموذج (اختياري)</label><input className="input" dir="ltr" value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })} placeholder="يُستخدم إذا لم تدعم /models" /></div></div><div className="flex gap-3 mt-7"><button onClick={() => setShowAddModal(false)} className="btn btn-secondary flex-1">إلغاء</button><button onClick={() => void addProvider()} disabled={testingId === 'new'} className="btn btn-primary flex-1">{testingId === 'new' ? <><RefreshCw className="animate-spin" size={15} /> جارٍ اختبار فعلي...</> : 'اختبار وحفظ'}</button></div></div></div>}
  </div>
}

type CardProvider = Provider | SessionProviderCredential
function ProviderCard({ provider, isSession = false, onTest, testing, expanded, onExpand, onDelete, onStart, onModelChange }: { provider: CardProvider; isSession?: boolean; onTest: () => void; testing: boolean; expanded: boolean; onExpand: () => void; onDelete: () => void; onStart: () => void; onModelChange: (model: string) => void }) {
  const definition = PROVIDER_DEFINITIONS.find((item) => item.type === provider.type)
  const diagnostic = provider.diagnostic
  const models = provider.models || []
  return <div className="card overflow-hidden mb-4"><div className="p-5 flex flex-col md:flex-row md:items-center gap-4"><div className="flex-1"><div className="flex items-center gap-3 mb-1"><div className="font-semibold text-lg">{provider.name}</div><StatusBadge status={testing ? 'testing' : provider.status} /></div><div className="text-sm text-dark-400">{definition?.label || provider.type} • {provider.protocol} • {provider.model || 'لم يُحدد نموذج'}</div><div className="flex flex-wrap gap-3 text-xs text-dark-500 mt-2">{diagnostic?.endpoint && <span dir="ltr">Endpoint: {diagnostic.endpoint}</span>}{diagnostic?.latencyMs !== undefined && <span><Clock3 size={12} className="inline" /> {diagnostic.latencyMs}ms</span>}{diagnostic?.httpStatus && <span>HTTP {diagnostic.httpStatus}</span>}</div></div><div className="flex flex-wrap items-center gap-2"><button onClick={onTest} disabled={testing} className="btn btn-secondary text-xs px-4 py-2">{testing ? <><RefreshCw className="animate-spin" size={14} /> جارٍ الاختبار</> : <><Play size={14} /> اختبار واكتشاف</>}</button>{models.length > 0 && <select value={provider.model || ''} onChange={(event) => onModelChange(event.target.value)} className="input text-xs py-2 px-3 w-auto max-w-64"><option value="">اختر نموذجًا</option>{models.map((model) => <option key={model} value={model}>{model}</option>)}</select>}<button onClick={onStart} disabled={provider.status !== 'connected' || !provider.model} className="btn btn-primary text-xs py-2">بدء محادثة</button><button onClick={onExpand} className="btn btn-ghost p-2">{expanded ? <ChevronUp size={17} /> : <ChevronDown size={17} />}</button><button onClick={onDelete} className="btn btn-ghost text-red-400 p-2"><Trash2 size={17} /></button></div></div>{expanded && <DiagnosticPanel diagnostic={diagnostic} />}</div>
}

function StatusBadge({ status }: { status: Provider['status'] | 'testing' }) { const label = status === 'connected' ? 'متصل' : status === 'error' ? 'فشل' : status === 'testing' ? 'جارٍ الاختبار' : 'غير مختبر'; const style = status === 'connected' ? 'border-emerald-600 text-emerald-400' : status === 'error' ? 'border-red-600 text-red-400' : 'border-amber-600 text-amber-400'; return <div className={`provider-badge ${style}`}>{status === 'connected' ? <CheckCircle size={12} className="inline ml-1" /> : status === 'error' ? <XCircle size={12} className="inline ml-1" /> : status === 'testing' ? <RefreshCw size={12} className="inline ml-1 animate-spin" /> : null}{label}</div> }
function DiagnosticPanel({ diagnostic }: { diagnostic?: ProviderDiagnostic }) { if (!diagnostic) return <div className="border-t border-dark-700 p-5 text-sm text-dark-400">لم يتم تنفيذ اختبار فعلي بعد.</div>; return <div className="border-t border-dark-700 p-5 bg-dark-900/30 text-sm"><div className="grid md:grid-cols-2 gap-4"><div><div className="text-dark-500 text-xs">النتيجة</div><div className={diagnostic.success ? 'text-emerald-400' : 'text-red-400'}>{diagnostic.message}</div></div><div><div className="text-dark-500 text-xs">الحالة</div><div>{diagnostic.category ? categoryLabels[diagnostic.category] || diagnostic.category : 'نجاح فعلي'}</div></div><div><div className="text-dark-500 text-xs">Endpoint</div><div className="font-mono text-xs break-all" dir="ltr">{diagnostic.endpoint || '—'}</div></div><div><div className="text-dark-500 text-xs">HTTP/الزمن</div><div>{diagnostic.httpStatus || '—'} • {diagnostic.latencyMs}ms</div></div></div>{diagnostic.providerMessage && <div className="mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20"><div className="text-xs text-red-300 mb-1">رسالة المزود بعد تنقيح الأسرار</div><div className="text-red-200 break-words">{diagnostic.providerMessage}</div></div>}{diagnostic.hint && <div className="mt-3 p-3 rounded-xl bg-primary-500/10 border border-primary-500/20"><span className="font-medium">التوجيه: </span>{diagnostic.hint}</div>}{diagnostic.warning && <div className="mt-3 text-amber-400">{diagnostic.warning}</div>}{diagnostic.models.length > 0 && <div className="mt-4"><div className="text-xs text-dark-500 mb-1">النماذج المكتشفة ({diagnostic.models.length})</div><div className="flex flex-wrap gap-1">{diagnostic.models.slice(0, 50).map((model) => <span key={model} className="text-xs bg-dark-800 rounded px-2 py-1 font-mono" dir="ltr">{model}</span>)}</div></div>}</div> }
