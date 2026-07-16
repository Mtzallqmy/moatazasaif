import { useEffect, useMemo, useState } from 'react'
import { Gauge, Save, ServerCog, Users } from 'lucide-react'
import { toast } from 'sonner'
import type { Provider } from '../../types'
import { apiJson, authHeaders } from '../../lib/api'
import { usePreferences } from '../../contexts/PreferencesContext'

interface PlatformSummary {
  provider: (Provider & { id: 'platform'; credentialMode: 'platform' }) | null
  usage: { requestsUsed: number; requestsLimit: number; tokensUsed: number; tokensLimit: number; resetAt: string } | null
}

export default function PlatformProviderPanel({ providers, onChanged }: { providers: Provider[]; onChanged: () => void }) {
  const { tr } = usePreferences()
  const connected = useMemo(() => providers.filter((provider) => provider.status === 'connected' && provider.isEnabled && provider.model), [providers])
  const current = providers.find((provider) => provider.isPlatformDefault)
  const [providerId, setProviderId] = useState(current?.id || '')
  const [enabled, setEnabled] = useState(Boolean(current))
  const [requestLimit, setRequestLimit] = useState(current?.platformDailyRequestLimit || 50)
  const [tokenLimit, setTokenLimit] = useState(current?.platformDailyTokenLimit || 100_000)
  const [summary, setSummary] = useState<PlatformSummary | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const next = providers.find((provider) => provider.isPlatformDefault)
    if (next) { setProviderId(next.id); setEnabled(true); setRequestLimit(next.platformDailyRequestLimit || 50); setTokenLimit(next.platformDailyTokenLimit || 100_000) }
  }, [providers])
  useEffect(() => { void authHeaders(false).then((headers) => apiJson<PlatformSummary>('/api/platform-provider', { headers })).then(setSummary).catch(() => setSummary(null)) }, [])

  const save = async () => {
    if (!providerId) { toast.error(tr('اختر مزودًا متصلًا أولًا', 'Select a connected provider first')); return }
    setSaving(true)
    try {
      const body = await apiJson<PlatformSummary>('/api/platform-provider', { method: 'PATCH', headers: await authHeaders(), body: JSON.stringify({ providerId, isShared: enabled, isDefault: enabled, dailyRequestLimit: requestLimit, dailyTokenLimit: tokenLimit }) })
      setSummary(body); onChanged(); toast.success(tr('تم تحديث مزود المنصة وحدود الاستخدام', 'Platform provider and usage limits updated'))
    } catch (error) { toast.error(error instanceof Error ? error.message : tr('تعذر تحديث مزود المنصة', 'Could not update the platform provider')) }
    finally { setSaving(false) }
  }

  return <section className="card p-5 sm:p-6 mb-6 border-sky-500/30" aria-labelledby="platform-provider-title">
    <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-5">
      <div className="flex gap-3"><div className="section-icon"><ServerCog size={20} /></div><div><h2 id="platform-provider-title" className="font-semibold text-lg">{tr('مزود المنصة الافتراضي', 'Default platform provider')}</h2><p className="text-sm text-dark-500 mt-1 max-w-2xl">{tr('يتيح للمستخدمين المسجلين الدردشة دون مفتاح خاص، ضمن حدود يومية ذرية لكل حساب. لا يظهر المفتاح أو هوية حساب المالك.', 'Lets signed-in users chat without their own key, with atomic daily limits per account. The key and owner identity are never exposed.')}</p></div></div>
      <label className="inline-flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} className="w-4 h-4 accent-primary-600" />{tr('تفعيل للمستخدمين', 'Enable for users')}</label>
    </div>
    <div className="grid md:grid-cols-3 gap-4 mt-6">
      <label><span className="field-label">{tr('المزود والنموذج', 'Provider and model')}</span><select className="input" value={providerId} onChange={(event) => setProviderId(event.target.value)}><option value="">{tr('اختر مزودًا متصلًا', 'Select a connected provider')}</option>{connected.map((provider) => <option key={provider.id} value={provider.id}>{provider.name} — {provider.model}</option>)}</select></label>
      <label><span className="field-label flex items-center gap-1"><Users size={14} />{tr('طلبات يومية لكل مستخدم', 'Daily requests per user')}</span><input type="number" min={1} max={100000} className="input" value={requestLimit} onChange={(event) => setRequestLimit(Number(event.target.value))} /></label>
      <label><span className="field-label flex items-center gap-1"><Gauge size={14} />{tr('رموز يومية لكل مستخدم', 'Daily tokens per user')}</span><input type="number" min={1000} max={1000000000} step={1000} className="input" value={tokenLimit} onChange={(event) => setTokenLimit(Number(event.target.value))} /></label>
    </div>
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-5"><p className="text-xs text-dark-500">{summary?.provider ? tr(`المزود الفعّال: ${summary.provider.name} • ${summary.provider.model}`, `Active provider: ${summary.provider.name} • ${summary.provider.model}`) : tr('لا يوجد مزود افتراضي فعّال حاليًا.', 'No active default provider.')}</p><button type="button" onClick={() => void save()} disabled={saving || !providerId || !connected.length} className="btn btn-primary"><Save size={16} />{saving ? tr('جارٍ الحفظ...', 'Saving...') : tr('حفظ الإعدادات', 'Save settings')}</button></div>
  </section>
}
