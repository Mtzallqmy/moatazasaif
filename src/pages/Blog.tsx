import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, BookOpen, CalendarDays } from 'lucide-react'
import PublicPreferencesButton from '../components/PublicPreferencesButton'
import { usePreferences } from '../contexts/PreferencesContext'
import { listArticles, listSections } from '../lib/content-api'
import type { Article, ContentSection } from '../types'

export default function Blog() {
  const { language, tr, t } = usePreferences()
  const [params, setParams] = useSearchParams()
  const section = params.get('section') || undefined
  const [articles, setArticles] = useState<Article[]>([])
  const [sections, setSections] = useState<ContentSection[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { document.title = language === 'ar' ? 'المقالات | معتز AI' : 'Articles | Moataz AI' }, [language])

  useEffect(() => { setLoading(true); void Promise.all([listArticles({ section }), listSections()]).then(([articleResult, sectionRows]) => { setArticles(articleResult.articles); setSections(sectionRows) }).finally(() => setLoading(false)) }, [section])
  const local = (ar?: string, en?: string) => language === 'en' && en ? en : ar || en || ''

  return <div className="app-canvas min-h-screen">
    <PublicPreferencesButton />
    <header className="border-b border-dark-200 dark:border-dark-800"><div className="max-w-6xl mx-auto px-5 py-6 flex items-center justify-between"><Link to="/" className="flex items-center gap-3 font-semibold text-lg"><span className="w-9 h-9 rounded-xl bg-primary-600 text-white grid place-items-center">M</span>{t('common.brand')}</Link><Link to="/login" className="btn btn-secondary">{t('auth.login')}</Link></div></header>
    <main className="max-w-6xl mx-auto px-5 py-12">
      <div className="max-w-2xl mb-10"><div className="text-primary-600 dark:text-primary-400 font-medium text-sm mb-3">{tr('المعرفة والتحديثات', 'Knowledge & updates')}</div><h1 className="text-4xl sm:text-5xl font-semibold tracking-tight">{tr('المقالات', 'Articles')}</h1><p className="text-dark-500 mt-3 text-lg">{tr('شروحات وتحديثات وأفكار عملية من منصة معتز AI.', 'Guides, updates, and practical ideas from Moataz AI.')}</p></div>
      <div className="flex gap-2 flex-wrap mb-8"><button onClick={() => setParams({})} className={`btn ${!section ? 'btn-primary' : 'btn-secondary'}`}>{tr('الكل', 'All')}</button>{sections.map((item) => <button key={item.id} onClick={() => setParams({ section: item.slug })} className={`btn ${section === item.slug ? 'btn-primary' : 'btn-secondary'}`}>{local(item.nameAr, item.nameEn)}</button>)}</div>
      {loading ? <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="card h-64 skeleton" />)}</div> : articles.length ? <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">{articles.map((article) => <article key={article.id} className="card overflow-hidden group"><div className="aspect-[16/8] bg-gradient-to-br from-primary-600/25 to-accent-600/20 grid place-items-center">{article.coverUrl ? <img src={article.coverUrl} alt="" className="w-full h-full object-cover" loading="lazy" /> : <BookOpen className="text-primary-500" size={34} />}</div><div className="p-6"><div className="flex items-center gap-2 text-xs text-dark-500 mb-3"><CalendarDays size={14} />{new Intl.DateTimeFormat(language === 'ar' ? 'ar' : 'en', { dateStyle: 'medium' }).format(new Date(article.publishedAt || article.createdAt))}</div><h2 className="text-xl font-semibold leading-snug group-hover:text-primary-600 transition-colors">{local(article.titleAr, article.titleEn)}</h2><p className="text-dark-500 mt-3 line-clamp-3">{local(article.excerptAr, article.excerptEn)}</p><Link to={`/blog/${article.slug}`} className="inline-flex items-center gap-2 text-primary-600 dark:text-primary-400 font-medium mt-5">{tr('اقرأ المقال', 'Read article')} <ArrowLeft size={15} /></Link></div></article>)}</div> : <div className="card py-20 text-center text-dark-500"><BookOpen className="mx-auto mb-3 opacity-40" />{tr('لا توجد مقالات منشورة في هذا القسم بعد.', 'No published articles in this section yet.')}</div>}
    </main>
  </div>
}
