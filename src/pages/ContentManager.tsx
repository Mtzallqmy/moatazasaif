import { useEffect, useState } from 'react'
import { FileText, FolderTree, Megaphone, Plus } from 'lucide-react'
import { usePreferences } from '../contexts/PreferencesContext'
import { archiveArticle, listAnnouncements, listArticles, listSections } from '../lib/content-api'
import type { Announcement, Article, ContentSection } from '../types'
import ArticleEditor from '../features/content/ArticleEditor'
import SectionsManager from '../features/content/SectionsManager'
import AnnouncementsManager from '../features/content/AnnouncementsManager'
import { toast } from 'sonner'

type Tab = 'articles' | 'sections' | 'announcements'

export default function ContentManager() {
  const { tr } = usePreferences()
  const [tab, setTab] = useState<Tab>('articles')
  const [articles, setArticles] = useState<Article[]>([])
  const [sections, setSections] = useState<ContentSection[]>([])
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [selected, setSelected] = useState<Article | undefined>()
  const [editorOpen, setEditorOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const load = () => { setLoading(true); void Promise.all([listArticles({ manage: true }), listSections(true), listAnnouncements({ manage: true })]).then(([articleResult, sectionRows, announcementRows]) => { setArticles(articleResult.articles); setSections(sectionRows); setAnnouncements(announcementRows) }).catch((error) => toast.error(error instanceof Error ? error.message : tr('تعذر تحميل المحتوى', 'Could not load content'))).finally(() => setLoading(false)) }
  useEffect(load, [])
  const tabs = [{ id: 'articles' as const, icon: FileText, label: tr('المقالات', 'Articles') }, { id: 'sections' as const, icon: FolderTree, label: tr('الأقسام', 'Sections') }, { id: 'announcements' as const, icon: Megaphone, label: tr('الإعلانات', 'Announcements') }]
  const savedArticle = (article: Article) => { setArticles((current) => current.some((item) => item.id === article.id) ? current.map((item) => item.id === article.id ? article : item) : [article, ...current]); setSelected(article) }
  const archive = async (article: Article) => { try { await archiveArticle(article.id); setArticles((current) => current.map((item) => item.id === article.id ? { ...item, status: 'archived' } : item)); toast.success(tr('تمت أرشفة المقال', 'Article archived')) } catch (error) { toast.error(error instanceof Error ? error.message : tr('تعذر أرشفة المقال', 'Could not archive article')) } }

  return <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-8"><div><h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">{tr('إدارة المحتوى', 'Content management')}</h1><p className="text-dark-500 mt-2">{tr('أنشئ الأقسام والمقالات والإعلانات من محرر واحد.', 'Create sections, articles, and announcements from one workspace.')}</p></div>{tab === 'articles' && <button className="btn btn-primary" onClick={() => { setSelected(undefined); setEditorOpen(true) }}><Plus size={16} />{tr('مقال جديد', 'New article')}</button>}</div>
    <div className="flex gap-2 overflow-x-auto mb-6 pb-1">{tabs.map((item) => { const Icon = item.icon; return <button key={item.id} onClick={() => setTab(item.id)} className={`btn shrink-0 ${tab === item.id ? 'btn-primary' : 'btn-secondary'}`}><Icon size={16} />{item.label}</button> })}</div>
    {loading ? <div className="card h-80 skeleton" /> : tab === 'articles' ? <div className="grid xl:grid-cols-[20rem_1fr] gap-5"><aside className="card p-3 max-h-[75vh] overflow-y-auto"><div className="space-y-2">{articles.map((article) => <button key={article.id} onClick={() => { setSelected(article); setEditorOpen(true) }} className={`w-full text-start p-4 rounded-2xl border transition-colors ${selected?.id === article.id ? 'border-primary-500 bg-primary-500/10' : 'border-dark-200 dark:border-dark-700 hover:border-primary-400'}`}><div className="font-medium line-clamp-2">{article.titleAr}</div><div className="flex items-center justify-between gap-2 mt-2 text-xs"><span className={article.status === 'published' ? 'text-emerald-500' : article.status === 'archived' ? 'text-dark-500' : 'text-amber-500'}>{article.status}</span><span dir="ltr" className="text-dark-500">/{article.slug}</span></div></button>)}{!articles.length && <p className="text-center text-dark-500 py-10">{tr('لا توجد مقالات بعد.', 'No articles yet.')}</p>}</div></aside><div>{editorOpen ? <><ArticleEditor article={selected} sections={sections} onSaved={savedArticle} />{selected && selected.status !== 'archived' && <button className="btn btn-ghost text-red-500 mt-3" onClick={() => void archive(selected)}>{tr('أرشفة المقال', 'Archive article')}</button>}</> : <div className="card min-h-80 grid place-items-center text-dark-500 p-8 text-center">{tr('اختر مقالًا للتحرير أو أنشئ مقالًا جديدًا.', 'Select an article to edit or create a new one.')}</div>}</div></div> : tab === 'sections' ? <SectionsManager sections={sections} onChange={setSections} /> : <AnnouncementsManager items={announcements} onChange={setAnnouncements} />}
  </div>
}
