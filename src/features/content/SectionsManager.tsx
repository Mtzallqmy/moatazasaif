import { useState } from 'react'
import { Plus, ToggleLeft, ToggleRight } from 'lucide-react'
import { toast } from 'sonner'
import type { ContentSection } from '../../types'
import { saveSection } from '../../lib/content-api'
import { usePreferences } from '../../contexts/PreferencesContext'

export default function SectionsManager({ sections, onChange }: { sections: ContentSection[]; onChange: (value: ContentSection[]) => void }) {
  const { tr } = usePreferences()
  const [form, setForm] = useState({ slug: '', nameAr: '', nameEn: '' })
  const create = async () => {
    try { const section = await saveSection(form); onChange([...sections, section]); setForm({ slug: '', nameAr: '', nameEn: '' }); toast.success(tr('تم إنشاء القسم', 'Section created')) }
    catch (error) { toast.error(error instanceof Error ? error.message : tr('تعذر إنشاء القسم', 'Could not create section')) }
  }
  const toggle = async (section: ContentSection) => {
    try { const saved = await saveSection({ ...section, isVisible: !section.isVisible }); onChange(sections.map((item) => item.id === saved.id ? saved : item)) }
    catch (error) { toast.error(error instanceof Error ? error.message : tr('تعذر تحديث القسم', 'Could not update section')) }
  }
  return <div className="grid lg:grid-cols-[22rem_1fr] gap-5"><div className="card p-5 space-y-4"><h2 className="font-semibold">{tr('إضافة قسم', 'Add section')}</h2><label><span className="field-label">Slug</span><input className="input" dir="ltr" value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} /></label><label><span className="field-label">{tr('الاسم العربي', 'Arabic name')}</span><input className="input" value={form.nameAr} onChange={(event) => setForm({ ...form, nameAr: event.target.value })} /></label><label><span className="field-label">English name</span><input className="input" dir="ltr" value={form.nameEn} onChange={(event) => setForm({ ...form, nameEn: event.target.value })} /></label><button className="btn btn-primary w-full" disabled={!form.slug || !form.nameAr} onClick={() => void create()}><Plus size={16} />{tr('إنشاء القسم', 'Create section')}</button></div><div className="card p-5"><h2 className="font-semibold mb-4">{tr('الأقسام الحالية', 'Current sections')}</h2><div className="space-y-2">{sections.map((section) => <div key={section.id} className="flex items-center justify-between gap-4 p-4 rounded-2xl border border-dark-200 dark:border-dark-700"><div><div className="font-medium">{section.nameAr} {section.nameEn ? <span className="text-dark-500">/ {section.nameEn}</span> : ''}</div><div className="text-xs text-dark-500" dir="ltr">/{section.slug}</div></div><button type="button" className="icon-button" onClick={() => void toggle(section)} aria-label={tr('تبديل ظهور القسم', 'Toggle section visibility')}>{section.isVisible ? <ToggleRight className="text-emerald-500" /> : <ToggleLeft />}</button></div>)}{!sections.length && <p className="text-dark-500 py-10 text-center">{tr('لا توجد أقسام بعد.', 'No sections yet.')}</p>}</div></div></div>
}
