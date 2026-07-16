import { useEffect, useState } from 'react'
import { Eye, Save } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { toast } from 'sonner'
import type { Article, ArticleStatus, ContentSection } from '../../types'
import { saveArticle } from '../../lib/content-api'
import { usePreferences } from '../../contexts/PreferencesContext'

interface Props { article?: Article; sections: ContentSection[]; onSaved: (article: Article) => void }
const empty = { slug: '', titleAr: '', titleEn: '', excerptAr: '', excerptEn: '', contentAr: '', contentEn: '', coverUrl: '', sectionId: '', status: 'draft' as ArticleStatus }

export default function ArticleEditor({ article, sections, onSaved }: Props) {
  const { tr } = usePreferences()
  const [form, setForm] = useState(empty)
  const [translation, setTranslation] = useState<'ar' | 'en'>('ar')
  const [preview, setPreview] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => setForm(article ? { slug: article.slug, titleAr: article.titleAr, titleEn: article.titleEn || '', excerptAr: article.excerptAr || '', excerptEn: article.excerptEn || '', contentAr: article.contentAr, contentEn: article.contentEn || '', coverUrl: article.coverUrl || '', sectionId: article.sectionId || '', status: article.status } : empty), [article])
  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }))
  const save = async () => {
    if (!form.slug || !form.titleAr.trim() || !form.contentAr.trim()) { toast.error(tr('المسار والعنوان والمحتوى العربي مطلوبة', 'Slug, Arabic title, and Arabic content are required')); return }
    setSaving(true)
    try {
      const saved = await saveArticle({ ...(article?.id ? { id: article.id } : {}), ...form, sectionId: form.sectionId || undefined, coverUrl: form.coverUrl || undefined })
      onSaved(saved)
      toast.success(tr('تم حفظ المقال', 'Article saved'))
    } catch (error) { toast.error(error instanceof Error ? error.message : tr('تعذر حفظ المقال', 'Could not save article')) }
    finally { setSaving(false) }
  }
  const activeContent = translation === 'ar' ? form.contentAr : form.contentEn

  return <div className="card overflow-hidden">
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 border-b border-dark-200 dark:border-dark-700">
      <div><h2 className="font-semibold">{article ? tr('تحرير المقال', 'Edit article') : tr('مقال جديد', 'New article')}</h2><p className="text-xs text-dark-500 mt-1">{tr('يُحفظ المحتوى بتنسيق Markdown آمن وقابل للنقل للتطبيق.', 'Content is saved as portable Markdown for web and mobile.')}</p></div>
      <div className="flex gap-2"><button type="button" className="btn btn-secondary" onClick={() => setPreview((value) => !value)}><Eye size={16} />{preview ? tr('المحرر', 'Editor') : tr('معاينة', 'Preview')}</button><button type="button" className="btn btn-primary" disabled={saving} onClick={() => void save()}><Save size={16} />{saving ? tr('جارٍ الحفظ...', 'Saving...') : tr('حفظ', 'Save')}</button></div>
    </div>
    <div className="p-4 sm:p-6 space-y-4">
      <div className="grid sm:grid-cols-3 gap-3"><label className="sm:col-span-2"><span className="field-label">{tr('المسار (Slug)', 'Slug')}</span><input className="input" dir="ltr" value={form.slug} onChange={(event) => set('slug', event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-'))} placeholder="my-article" /></label><label><span className="field-label">{tr('الحالة', 'Status')}</span><select className="input" value={form.status} onChange={(event) => set('status', event.target.value)}><option value="draft">{tr('مسودة', 'Draft')}</option><option value="published">{tr('منشور', 'Published')}</option><option value="archived">{tr('مؤرشف', 'Archived')}</option></select></label></div>
      <div className="grid sm:grid-cols-2 gap-3"><label><span className="field-label">{tr('القسم', 'Section')}</span><select className="input" value={form.sectionId} onChange={(event) => set('sectionId', event.target.value)}><option value="">{tr('بدون قسم', 'No section')}</option>{sections.map((section) => <option key={section.id} value={section.id}>{section.nameAr} {section.nameEn ? `/ ${section.nameEn}` : ''}</option>)}</select></label><label><span className="field-label">{tr('رابط صورة الغلاف', 'Cover image URL')}</span><input className="input" dir="ltr" value={form.coverUrl} onChange={(event) => set('coverUrl', event.target.value)} placeholder="https://..." /></label></div>
      <div className="inline-flex p-1 rounded-xl bg-dark-100 dark:bg-dark-900 border border-dark-200 dark:border-dark-700"><button type="button" onClick={() => setTranslation('ar')} className={`px-4 py-2 rounded-lg text-sm ${translation === 'ar' ? 'bg-primary-600 text-white' : ''}`}>العربية</button><button type="button" onClick={() => setTranslation('en')} className={`px-4 py-2 rounded-lg text-sm ${translation === 'en' ? 'bg-primary-600 text-white' : ''}`}>English</button></div>
      {translation === 'ar' ? <><label><span className="field-label">العنوان العربي</span><input className="input" value={form.titleAr} onChange={(event) => set('titleAr', event.target.value)} maxLength={200} /></label><label><span className="field-label">المقتطف العربي</span><textarea className="input min-h-24" value={form.excerptAr} onChange={(event) => set('excerptAr', event.target.value)} maxLength={500} /></label></> : <><label><span className="field-label">English title</span><input className="input" dir="ltr" value={form.titleEn} onChange={(event) => set('titleEn', event.target.value)} maxLength={200} /></label><label><span className="field-label">English excerpt</span><textarea className="input min-h-24" dir="ltr" value={form.excerptEn} onChange={(event) => set('excerptEn', event.target.value)} maxLength={500} /></label></>}
      <div><span className="field-label">{translation === 'ar' ? 'المحتوى العربي (Markdown)' : 'English content (Markdown)'}</span>{preview ? <div className="min-h-[28rem] rounded-2xl border border-dark-200 dark:border-dark-700 p-6 prose-content" dir={translation === 'ar' ? 'rtl' : 'ltr'}><ReactMarkdown remarkPlugins={[remarkGfm]}>{activeContent || tr('*لا يوجد محتوى للمعاينة*', '*Nothing to preview*')}</ReactMarkdown></div> : <textarea className="input min-h-[28rem] font-mono leading-7" dir={translation === 'ar' ? 'rtl' : 'ltr'} value={activeContent} onChange={(event) => set(translation === 'ar' ? 'contentAr' : 'contentEn', event.target.value)} placeholder={translation === 'ar' ? '# عنوان المقال' : '# Article heading'} />}</div>
    </div>
  </div>
}
