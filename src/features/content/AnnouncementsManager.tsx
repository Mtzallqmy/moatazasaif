import { useState } from 'react'
import { Megaphone, Plus, ToggleLeft, ToggleRight } from 'lucide-react'
import { toast } from 'sonner'
import type { Announcement } from '../../types'
import { saveAnnouncement } from '../../lib/content-api'
import { usePreferences } from '../../contexts/PreferencesContext'

export default function AnnouncementsManager({ items, onChange }: { items: Announcement[]; onChange: (items: Announcement[]) => void }) {
  const { tr } = usePreferences()
  const [form, setForm] = useState({ textAr: '', textEn: '', href: '', placement: 'top' as 'top' | 'dashboard' })
  const create = async () => {
    try { const item = await saveAnnouncement({ ...form, href: form.href || undefined }); onChange([item, ...items]); setForm({ textAr: '', textEn: '', href: '', placement: 'top' }); toast.success(tr('تم إنشاء الإعلان', 'Announcement created')) }
    catch (error) { toast.error(error instanceof Error ? error.message : tr('تعذر إنشاء الإعلان', 'Could not create announcement')) }
  }
  const toggle = async (item: Announcement) => {
    try { const saved = await saveAnnouncement({ ...item, isActive: !item.isActive }); onChange(items.map((current) => current.id === item.id ? saved : current)) }
    catch (error) { toast.error(error instanceof Error ? error.message : tr('تعذر تحديث الإعلان', 'Could not update announcement')) }
  }
  return <div className="grid lg:grid-cols-[24rem_1fr] gap-5"><div className="card p-5 space-y-4"><div className="flex items-center gap-2 font-semibold"><Megaphone size={18} />{tr('إعلان جديد', 'New announcement')}</div><label><span className="field-label">{tr('النص العربي', 'Arabic text')}</span><textarea className="input min-h-24" value={form.textAr} maxLength={300} onChange={(event) => setForm({ ...form, textAr: event.target.value })} /></label><label><span className="field-label">English text</span><textarea className="input min-h-24" dir="ltr" value={form.textEn} maxLength={300} onChange={(event) => setForm({ ...form, textEn: event.target.value })} /></label><label><span className="field-label">{tr('الرابط (اختياري)', 'Link (optional)')}</span><input className="input" dir="ltr" value={form.href} onChange={(event) => setForm({ ...form, href: event.target.value })} /></label><label><span className="field-label">{tr('الموضع', 'Placement')}</span><select className="input" value={form.placement} onChange={(event) => setForm({ ...form, placement: event.target.value as 'top' | 'dashboard' })}><option value="top">{tr('الشريط العلوي', 'Top bar')}</option><option value="dashboard">{tr('لوحة التحكم', 'Dashboard')}</option></select></label><button className="btn btn-primary w-full" disabled={!form.textAr.trim()} onClick={() => void create()}><Plus size={16} />{tr('إضافة الإعلان', 'Add announcement')}</button></div><div className="card p-5"><h2 className="font-semibold mb-4">{tr('الإعلانات', 'Announcements')}</h2><div className="space-y-2">{items.map((item) => <div key={item.id} className="flex items-start justify-between gap-4 p-4 rounded-2xl border border-dark-200 dark:border-dark-700"><div><div className="font-medium">{item.textAr}</div>{item.textEn && <div className="text-sm text-dark-500 mt-1" dir="ltr">{item.textEn}</div>}<div className="text-xs text-primary-500 mt-2">{item.placement === 'top' ? tr('الشريط العلوي', 'Top bar') : tr('لوحة التحكم', 'Dashboard')}</div></div><button className="icon-button" onClick={() => void toggle(item)}>{item.isActive ? <ToggleRight className="text-emerald-500" /> : <ToggleLeft />}</button></div>)}{!items.length && <p className="text-dark-500 py-10 text-center">{tr('لا توجد إعلانات بعد.', 'No announcements yet.')}</p>}</div></div></div>
}
