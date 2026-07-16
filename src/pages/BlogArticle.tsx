import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, CalendarDays } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import PublicPreferencesButton from '../components/PublicPreferencesButton'
import { usePreferences } from '../contexts/PreferencesContext'
import { listArticles } from '../lib/content-api'
import type { Article } from '../types'

export default function BlogArticle() {
  const { slug = '' } = useParams()
  const { language, tr, t } = usePreferences()
  const [article, setArticle] = useState<Article | null | undefined>(undefined)
  useEffect(() => { void listArticles({ slug }).then(({ articles }) => setArticle(articles[0] || null)).catch(() => setArticle(null)) }, [slug])
  useEffect(() => {
    if (!article) return
    const title = language === 'en' && article.titleEn ? article.titleEn : article.titleAr
    const description = language === 'en' && article.excerptEn ? article.excerptEn : article.excerptAr
    document.title = `${title} | Moataz AI`
    if (description) document.querySelector('meta[name="description"]')?.setAttribute('content', description)
    return () => { document.querySelector('meta[name="description"]')?.setAttribute('content', 'معتز AI — مساحة عربية وإنجليزية آمنة للمحادثات الذكية والمحتوى والتكاملات.') }
  }, [article, language])
  if (article === undefined) return <div className="app-canvas min-h-screen grid place-items-center">{t('common.loading')}</div>
  if (!article) return <div className="app-canvas min-h-screen grid place-items-center p-6"><div className="text-center"><h1 className="text-3xl font-semibold">{tr('المقال غير موجود', 'Article not found')}</h1><Link to="/blog" className="btn btn-primary mt-5">{tr('العودة للمقالات', 'Back to articles')}</Link></div></div>
  const title = language === 'en' && article.titleEn ? article.titleEn : article.titleAr
  const content = language === 'en' && article.contentEn ? article.contentEn : article.contentAr
  return <div className="app-canvas min-h-screen"><PublicPreferencesButton /><main className="max-w-3xl mx-auto px-5 py-12 sm:py-20"><Link to="/blog" className="inline-flex items-center gap-2 text-dark-500 hover:text-primary-600 mb-10"><ArrowLeft size={16} />{tr('كل المقالات', 'All articles')}</Link><article>{article.coverUrl && <img src={article.coverUrl} alt="" className="w-full aspect-video object-cover rounded-3xl mb-10" />}<div className="flex items-center gap-2 text-sm text-dark-500"><CalendarDays size={15} />{new Intl.DateTimeFormat(language === 'ar' ? 'ar' : 'en', { dateStyle: 'long' }).format(new Date(article.publishedAt || article.createdAt))}</div><h1 className="text-4xl sm:text-5xl font-semibold tracking-tight leading-tight mt-4 mb-10">{title}</h1><div className="prose-content"><ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown></div></article></main></div>
}
