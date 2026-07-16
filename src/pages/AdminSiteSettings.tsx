import { useEffect, useState } from 'react'
import { Check, ExternalLink, Link2, Loader2, Palette, Plus, Save, Settings2, Trash2, Type } from 'lucide-react'
import { toast } from 'sonner'
import { apiJson, authHeaders } from '../lib/api'
import { usePreferences } from '../contexts/PreferencesContext'
import { useSiteSettings } from '../contexts/SiteSettingsContext'
import {
  DEFAULT_SITE_SETTINGS,
  type PublicSiteConfiguration,
  type SiteNavigationItem,
  type SiteSettings,
} from '../../shared/site-settings'

const emptyNavigation: Omit<SiteNavigationItem, 'id'> = {
  location: 'header', labelAr: '', labelEn: '', href: '/', isExternal: false, isActive: true, sortOrder: 0,
}

export default function AdminSiteSettings() {
  const { tr } = usePreferences()
  const { replaceSettings, reload } = useSiteSettings()
  const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SITE_SETTINGS)
  const [navigation, setNavigation] = useState<SiteNavigationItem[]>([])
  const [draft, setDraft] = useState(emptyNavigation)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true
    void authHeaders(false).then((headers) => apiJson<PublicSiteConfiguration>('/api/site-settings', { headers })).then((data) => {
      if (!active) return
      setSettings(data.settings); setNavigation(data.navigation); setLoading(false)
    }).catch((error) => {
      if (!active) return
      toast.error(error instanceof Error ? error.message : tr('تعذر تحميل إعدادات الموقع', 'Could not load site settings'))
      setLoading(false)
    })
    return () => { active = false }
  }, [tr])

  const update = <K extends keyof SiteSettings>(key: K, value: SiteSettings[K]) => setSettings((current) => ({ ...current, [key]: value }))

  const saveSettings = async () => {
    setSaving(true)
    try {
      const { updatedAt: _updatedAt, ...payload } = settings
      const body = await apiJson<{ settings: SiteSettings }>('/api/site-settings', {
        method: 'PATCH', headers: await authHeaders(), body: JSON.stringify(payload),
      })
      setSettings(body.settings); replaceSettings(body.settings); await reload()
      toast.success(tr('تم حفظ هوية الموقع وإعداداته', 'Site identity and settings saved'))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tr('تعذر حفظ الإعدادات', 'Could not save settings'))
    } finally { setSaving(false) }
  }

  const createNavigation = async () => {
    try {
      const body = await apiJson<{ item: SiteNavigationItem }>('/api/site-settings', {
        method: 'POST', headers: await authHeaders(), body: JSON.stringify(draft),
      })
      setNavigation((current) => [...current, body.item]); setDraft(emptyNavigation); await reload()
      toast.success(tr('تمت إضافة الرابط', 'Navigation link added'))
    } catch (error) { toast.error(error instanceof Error ? error.message : tr('تعذر إضافة الرابط', 'Could not add link')) }
  }

  const toggleNavigation = async (item: SiteNavigationItem) => {
    try {
      const body = await apiJson<{ item: SiteNavigationItem }>('/api/site-settings', {
        method: 'PATCH', headers: await authHeaders(), body: JSON.stringify({ id: item.id, isActive: !item.isActive }),
      })
      setNavigation((current) => current.map((row) => row.id === item.id ? body.item : row)); await reload()
    } catch (error) { toast.error(error instanceof Error ? error.message : tr('تعذر تحديث الرابط', 'Could not update link')) }
  }

  const removeNavigation = async (id: string) => {
    try {
      await apiJson('/api/site-settings', { method: 'DELETE', headers: await authHeaders(), body: JSON.stringify({ id }) })
      setNavigation((current) => current.filter((item) => item.id !== id)); await reload()
      toast.success(tr('تم حذف الرابط', 'Navigation link deleted'))
    } catch (error) { toast.error(error instanceof Error ? error.message : tr('تعذر حذف الرابط', 'Could not delete link')) }
  }

  if (loading) return <div className="min-h-full grid place-items-center"><Loader2 className="animate-spin text-primary-500" /></div>

  return <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
    <header className="flex flex-col lg:flex-row lg:items-end justify-between gap-4"><div><div className="inline-flex items-center gap-2 text-sm text-primary-600 dark:text-primary-400"><Settings2 size={16} />{tr('استوديو الموقع', 'Site studio')}</div><h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mt-2">{tr('الهوية والمظهر والتنقل', 'Identity, appearance, and navigation')}</h1><p className="text-dark-500 mt-2 max-w-3xl">{tr('تعديلات حقيقية تنعكس على الواجهة العامة ونسخة الدومين من إعداد مركزي واحد.', 'Real changes applied to the public experience and domain edition from one control center.')}</p></div><button type="button" onClick={saveSettings} disabled={saving} className="btn btn-primary px-6">{saving ? <Loader2 size={17} className="animate-spin" /> : <Save size={17} />}{tr('حفظ ونشر الإعدادات', 'Save and publish settings')}</button></header>

    <div className="grid xl:grid-cols-2 gap-5">
      <section className="card p-5 sm:p-6 space-y-5"><div className="flex items-center gap-3"><div className="section-icon"><Type size={19} /></div><div><h2 className="font-semibold text-lg">{tr('اسم الموقع ونصوصه', 'Site name and copy')}</h2><p className="text-xs text-dark-500">{tr('عربي وإنجليزي مع حقوق الملكية', 'Arabic and English with ownership notice')}</p></div></div>
        <div className="grid sm:grid-cols-2 gap-4"><Field label={tr('اسم الموقع بالعربية', 'Arabic site name')} value={settings.siteNameAr} onChange={(value) => update('siteNameAr', value)} /><Field label={tr('اسم الموقع بالإنجليزية', 'English site name')} value={settings.siteNameEn} dir="ltr" onChange={(value) => update('siteNameEn', value)} /><Field label={tr('الوصف بالعربية', 'Arabic tagline')} value={settings.taglineAr} onChange={(value) => update('taglineAr', value)} /><Field label={tr('الوصف بالإنجليزية', 'English tagline')} value={settings.taglineEn} dir="ltr" onChange={(value) => update('taglineEn', value)} /><Field label={tr('حقوق النشر بالعربية', 'Arabic copyright')} value={settings.footerTextAr} onChange={(value) => update('footerTextAr', value)} /><Field label={tr('حقوق النشر بالإنجليزية', 'English copyright')} value={settings.footerTextEn} dir="ltr" onChange={(value) => update('footerTextEn', value)} /></div>
      </section>

      <section className="card p-5 sm:p-6 space-y-5"><div className="flex items-center gap-3"><div className="section-icon"><Palette size={19} /></div><div><h2 className="font-semibold text-lg">{tr('نظام التصميم', 'Design system')}</h2><p className="text-xs text-dark-500">{tr('ألوان هادئة وخط موحد لكل الصفحات', 'Calm colors and consistent typography')}</p></div></div>
        <div className="grid sm:grid-cols-2 gap-4"><ColorField label={tr('اللون الرئيسي', 'Primary color')} value={settings.primaryColor} onChange={(value) => update('primaryColor', value)} /><ColorField label={tr('اللون المساند', 'Accent color')} value={settings.accentColor} onChange={(value) => update('accentColor', value)} /></div>
        <label className="block"><span className="field-label">{tr('أسلوب الخط', 'Font style')}</span><select className="input" value={settings.fontStyle} onChange={(event) => update('fontStyle', event.target.value as SiteSettings['fontStyle'])}><option value="modern">{tr('حديث ومتوازن', 'Modern and balanced')}</option><option value="humanist">{tr('إنساني مريح', 'Comfortable humanist')}</option><option value="editorial">{tr('تحريري للمحتوى', 'Editorial for content')}</option></select></label>
        <div className="grid sm:grid-cols-2 gap-3"><Toggle label={tr('السماح بالتسجيل', 'Allow registration')} checked={settings.allowRegistration} onChange={(value) => update('allowRegistration', value)} /><Toggle label={tr('إظهار المدونة', 'Show blog')} checked={settings.blogEnabled} onChange={(value) => update('blogEnabled', value)} /><Toggle label={tr('وضع الصيانة', 'Maintenance mode')} checked={settings.maintenanceMode} onChange={(value) => update('maintenanceMode', value)} /><Toggle label={tr('حالة الخدمة العامة', 'Public service status')} checked={settings.publicStatusEnabled} onChange={(value) => update('publicStatusEnabled', value)} /></div>
      </section>
    </div>

    <section className="card p-5 sm:p-6"><div className="flex items-center gap-3 mb-5"><div className="section-icon"><Link2 size={19} /></div><div><h2 className="font-semibold text-lg">{tr('روابط التنقل', 'Navigation links')}</h2><p className="text-xs text-dark-500">{tr('أضف روابط الرأس أو التذييل دون تعديل الكود', 'Add header or footer links without editing code')}</p></div></div>
      <div className="grid lg:grid-cols-[1fr_1fr_1.2fr_auto_auto] gap-3 items-end mb-5"><Field label={tr('العنوان العربي', 'Arabic label')} value={draft.labelAr} onChange={(value) => setDraft((current) => ({ ...current, labelAr: value }))} /><Field label={tr('العنوان الإنجليزي', 'English label')} value={draft.labelEn} onChange={(value) => setDraft((current) => ({ ...current, labelEn: value }))} /><Field label={tr('المسار أو رابط HTTPS', 'Path or HTTPS URL')} value={draft.href} dir="ltr" onChange={(value) => setDraft((current) => ({ ...current, href: value }))} /><label><span className="field-label">{tr('المكان', 'Location')}</span><select className="input" value={draft.location} onChange={(event) => setDraft((current) => ({ ...current, location: event.target.value as 'header' | 'footer' }))}><option value="header">{tr('الرأس', 'Header')}</option><option value="footer">{tr('التذييل', 'Footer')}</option></select></label><button type="button" className="btn btn-primary" onClick={createNavigation} disabled={!draft.labelAr || !draft.labelEn || !draft.href}><Plus size={17} />{tr('إضافة', 'Add')}</button></div>
      <div className="divide-y divide-dark-200 dark:divide-dark-700">{navigation.length ? navigation.map((item) => <div key={item.id} className="py-4 flex flex-col sm:flex-row sm:items-center gap-3"><div className="section-icon"><ExternalLink size={17} /></div><div className="flex-1 min-w-0"><div className="font-medium">{item.labelAr} <span className="text-dark-500">/ {item.labelEn}</span></div><div className="text-xs text-dark-500 truncate mt-1" dir="ltr">{item.href}</div></div><span className="text-xs px-2.5 py-1 rounded-full bg-dark-100 dark:bg-dark-700">{item.location === 'header' ? tr('الرأس', 'Header') : tr('التذييل', 'Footer')}</span><button type="button" className="icon-button" onClick={() => void toggleNavigation(item)} title={tr('تفعيل أو إيقاف', 'Enable or disable')}><Check size={17} className={item.isActive ? 'text-emerald-500' : 'text-dark-400'} /></button><button type="button" className="icon-button text-red-500" onClick={() => void removeNavigation(item.id)} title={tr('حذف', 'Delete')}><Trash2 size={17} /></button></div>) : <p className="text-center text-dark-500 py-8">{tr('لا توجد روابط مخصصة بعد.', 'No custom links yet.')}</p>}</div>
    </section>
  </div>
}

function Field({ label, value, onChange, dir }: { label: string; value: string; onChange: (value: string) => void; dir?: 'ltr' | 'rtl' }) {
  return <label className="block"><span className="field-label">{label}</span><input className="input" value={value} dir={dir} onChange={(event) => onChange(event.target.value)} /></label>
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="block"><span className="field-label">{label}</span><span className="flex gap-2"><input type="color" className="h-12 w-14 rounded-xl border border-dark-200 dark:border-dark-700 bg-transparent p-1" value={value} onChange={(event) => onChange(event.target.value)} /><input className="input" dir="ltr" value={value} pattern="^#[0-9A-Fa-f]{6}$" onChange={(event) => onChange(event.target.value)} /></span></label>
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="toggle-card"><span className="text-sm font-medium">{label}</span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span className="toggle-switch" /></label>
}
