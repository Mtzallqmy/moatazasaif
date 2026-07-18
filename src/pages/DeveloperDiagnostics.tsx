import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, Download, HeartPulse, RotateCcw, Search, RefreshCw, Wifi } from 'lucide-react'
import { toast } from 'sonner'
import { apiJson, authHeaders } from '../lib/api'
import { usePreferences } from '../contexts/PreferencesContext'
import type { Provider } from '../types'

type ManagerProvider = Provider & {
  enabled: boolean
  workerStatus: 'online' | 'offline' | 'disabled'
  queueSize: number
  circuit?: { state: 'closed' | 'open' | 'half_open'; failures: number; nextRetryAt?: string }
}

const statusLabel: Record<string, [string, string]> = {
  healthy: ['سليم', 'Healthy'], degraded: ['متدهور', 'Degraded'], offline: ['متوقف', 'Offline'], unknown: ['غير معروف', 'Unknown'],
}

export default function DeveloperDiagnostics() {
  const { tr } = usePreferences()
  const [providers, setProviders] = useState<ManagerProvider[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const body = await apiJson<{ providers: ManagerProvider[] }>('/api/providers/diagnostics', { headers: await authHeaders(false) })
      setProviders(body.providers || [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tr('تعذر تحميل التشخيص', 'Could not load diagnostics'))
    } finally { setLoading(false) }
  }, [tr])

  useEffect(() => { void load() }, [load])

  const filtered = useMemo(() => providers.filter((provider) => `${provider.name} ${provider.type} ${provider.model || ''}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => (a.priority || 100) - (b.priority || 100)), [providers, query])

  const action = async (providerId: string, actionName: 'test' | 'health' | 'discover' | 'reload' | 'reset-circuit') => {
    setBusy(`${actionName}:${providerId}`)
    try {
      const body = await apiJson<{ provider?: ManagerProvider; models?: string[]; message?: string }>('/api/providers/diagnostics', { method: 'POST', headers: { ...(await authHeaders()), 'Content-Type': 'application/json' }, body: JSON.stringify({ action: actionName, providerId }) })
      if (body.provider) setProviders((current) => current.map((item) => item.id === providerId ? { ...item, ...body.provider } : item))
      if (body.models) setProviders((current) => current.map((item) => item.id === providerId ? { ...item, models: body.models } : item))
      toast.success(body.message || tr('تم تنفيذ الفحص', 'Diagnostic action completed'))
      if (actionName === 'reload' || actionName === 'reset-circuit') await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tr('فشل الإجراء', 'Action failed'))
      await load()
    } finally { setBusy(null) }
  }

  const exportLogs = async (format: 'json' | 'csv') => {
    try {
      const response = await fetch(`/api/providers/logs?logs=true&format=${format}`, { headers: await authHeaders(false), credentials: 'include' })
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || 'Export failed')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a'); link.href = url; link.download = `provider-logs.${format}`; link.click(); URL.revokeObjectURL(url)
    } catch (error) { toast.error(error instanceof Error ? error.message : tr('تعذر تصدير السجلات', 'Could not export logs')) }
  }

  return <div className="p-6 max-w-7xl mx-auto space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div><h1 className="text-3xl font-semibold">{tr('تشخيص المزودات', 'Provider diagnostics')}</h1><p className="text-dark-400 mt-1">{tr('حالة حقيقية محفوظة في Supabase مع Circuit Breaker وإعادة المحاولة.', 'Durable health state with retries and circuit breakers.')}</p></div>
      <div className="flex flex-wrap gap-2"><button className="btn btn-secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={16} /> {tr('تحديث', 'Refresh')}</button><button className="btn btn-secondary" onClick={() => void exportLogs('json')}><Download size={16} /> JSON</button><button className="btn btn-secondary" onClick={() => void exportLogs('csv')}><Download size={16} /> CSV</button></div>
    </div>
    <div className="card p-3 flex items-center gap-2"><Search size={17} className="text-dark-400" /><input className="input border-0 bg-transparent" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={tr('ابحث بالاسم أو النوع أو النموذج', 'Search name, type or model')} /></div>
    {loading ? <div className="card p-12 text-center text-dark-400">{tr('جارٍ تحميل التشخيص...', 'Loading diagnostics...')}</div> : filtered.length === 0 ? <div className="card p-12 text-center text-dark-400">{tr('لا توجد مزودات محفوظة', 'No saved providers')}</div> : <div className="grid gap-4">{filtered.map((provider) => {
      const status = statusLabel[provider.healthStatus || 'unknown'] || statusLabel.unknown
      return <section key={provider.id} className="card p-5 space-y-4"><div className="flex flex-wrap justify-between gap-3"><div className="flex items-center gap-3"><div className={`w-10 h-10 rounded-2xl flex items-center justify-center ${provider.healthStatus === 'healthy' ? 'bg-emerald-500/15 text-emerald-500' : provider.healthStatus === 'offline' ? 'bg-red-500/15 text-red-500' : 'bg-amber-500/15 text-amber-500'}`}><Activity size={20} /></div><div><h2 className="font-semibold">{provider.name}</h2><p className="text-xs text-dark-500" dir="ltr">{provider.type} · {provider.protocol}</p></div></div><span className="text-sm px-3 py-1 rounded-full bg-dark-100 dark:bg-dark-800">{tr(status[0], status[1])}</span></div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm"><Metric label={tr('الزمن', 'Latency')} value={provider.latency == null ? '—' : `${provider.latency} ms`} /><Metric label={tr('التوفر', 'Availability')} value={`${Math.round((provider.availability || 0) * 100)}%`} /><Metric label={tr('نجاح', 'Success')} value={String(provider.successCount || 0)} /><Metric label={tr('أخطاء', 'Errors')} value={String(provider.errorCount || 0)} /><Metric label={tr('الطابور', 'Queue')} value={String(provider.queueSize || 0)} /></div>
        <div className="text-xs text-dark-500 flex flex-wrap gap-4"><span>{tr('الدائرة', 'Circuit')}: {provider.circuit?.state || 'closed'}</span><span>{tr('العامل', 'Worker')}: {provider.workerStatus || 'online'}</span><span>{tr('النموذج', 'Model')}: {provider.model || '—'}</span><span>{tr('آخر فحص', 'Last check')}: {provider.lastCheck ? new Date(provider.lastCheck).toLocaleString() : '—'}</span></div>
        {provider.lastError?.message && <div className="rounded-xl bg-red-500/10 text-red-600 dark:text-red-300 p-3 text-sm">{provider.lastError.message}{provider.lastError.code ? ` (${provider.lastError.code})` : ''}</div>}
        <div className="flex flex-wrap gap-2"><button className="btn btn-secondary text-xs" disabled={Boolean(busy)} onClick={() => void action(provider.id, 'test')}><Wifi size={14} /> {tr('اختبار', 'Test')}</button><button className="btn btn-secondary text-xs" disabled={Boolean(busy)} onClick={() => void action(provider.id, 'health')}><HeartPulse size={14} /> {tr('فحص الصحة', 'Health check')}</button><button className="btn btn-secondary text-xs" disabled={Boolean(busy)} onClick={() => void action(provider.id, 'discover')}><Search size={14} /> {tr('اكتشاف النماذج', 'Discover models')}</button><button className="btn btn-secondary text-xs" disabled={Boolean(busy)} onClick={() => void action(provider.id, 'reload')}><RotateCcw size={14} /> {tr('إعادة تحميل', 'Reload')}</button><button className="btn btn-secondary text-xs" disabled={Boolean(busy)} onClick={() => void action(provider.id, 'reset-circuit')}>{tr('إعادة ضبط الدائرة', 'Reset circuit')}</button></div>
        {provider.models?.length ? <p className="text-xs text-dark-500 truncate" title={provider.models.join(', ')}>{tr('النماذج', 'Models')}: {provider.models.join(', ')}</p> : null}
      </section>
    })}</div>}
  </div>
}

function Metric({ label, value }: { label: string; value: string }) { return <div className="rounded-xl bg-dark-50 dark:bg-dark-800/60 p-3"><div className="text-xs text-dark-500">{label}</div><div className="font-semibold mt-1" dir="ltr">{value}</div></div> }
