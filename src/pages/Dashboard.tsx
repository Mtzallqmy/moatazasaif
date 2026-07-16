import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Bot, BookOpen, FileText, MessageCircle, Plus, Plug, Settings, ShieldCheck, Sparkles, Palette, Users } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { usePreferences } from '../contexts/PreferencesContext'
import type { Chat, Provider } from '../types'
import { listChats } from '../lib/supabase'
import { apiJson, authHeaders } from '../lib/api'
import AnnouncementBar from '../components/AnnouncementBar'

interface Summary { articles: number; sections: number; announcements: number }

export default function Dashboard() {
  const { user } = useAuth()
  const { language, t, tr } = usePreferences()
  const [chats, setChats] = useState<Chat[]>([])
  const [providers, setProviders] = useState<Provider[]>([])
  const [stats, setStats] = useState({ chats: 0, providers: 0, integrations: 0 })
  const [content, setContent] = useState<Summary>({ articles: 0, sections: 0, announcements: 0 })
  const [loading, setLoading] = useState(true)
  const canManageContent = Boolean(user && ['owner', 'admin', 'manager', 'editor'].includes(user.role))
  const canManageIntegrations = Boolean(user && ['owner', 'admin', 'manager'].includes(user.role))

  useEffect(() => {
    if (!user) return
    let active = true
    const load = async () => {
      const headers = await authHeaders(false)
      const results = await Promise.allSettled([
        listChats(user.id),
        apiJson<{ providers: Provider[] }>('/api/providers', { headers }),
        apiJson<{ integrations: unknown[] }>('/api/integrations/telegram', { headers }),
        apiJson<{ integrations: unknown[] }>('/api/integrations/external', { headers }),
        apiJson<{ data: Summary }>('/api/v1/content/summary'),
      ])
      if (!active) return
      const chatRows = results[0].status === 'fulfilled' ? results[0].value : []
      const providerRows = results[1].status === 'fulfilled' ? results[1].value.providers || [] : []
      const telegramCount = results[2].status === 'fulfilled' ? results[2].value.integrations?.length || 0 : 0
      const externalCount = results[3].status === 'fulfilled' ? results[3].value.integrations?.length || 0 : 0
      setChats(chatRows.slice(0, 5)); setProviders(providerRows)
      setStats({ chats: chatRows.length, providers: providerRows.filter((provider) => provider.status === 'connected').length, integrations: telegramCount + externalCount })
      if (results[4].status === 'fulfilled') setContent(results[4].value.data)
      setLoading(false)
    }
    void load()
    return () => { active = false }
  }, [user])

  const quickActions = useMemo(() => [
    { to: '/chat', icon: MessageCircle, label: t('nav.newChat'), desc: tr('ابدأ دردشة مع نموذج متصل', 'Start a chat with a connected model') },
    { to: '/providers', icon: Bot, label: t('dashboard.addProvider'), desc: tr('اربط مفتاحًا واختبره فعليًا', 'Connect and test an API key') },
    ...(canManageIntegrations ? [{ to: '/integrations', icon: Plug, label: t('dashboard.manageIntegrations'), desc: tr('Telegram وGitHub وWhatsApp وMCP', 'Telegram, GitHub, WhatsApp, and MCP') }] : []),
    ...(canManageContent ? [{ to: '/admin/content', icon: FileText, label: tr('إدارة المحتوى', 'Manage content'), desc: tr('مقالات وأقسام وإعلانات', 'Articles, sections, and announcements') }] : []),
    ...(['owner', 'admin'].includes(user?.role || '') ? [{ to: '/admin/site', icon: Palette, label: tr('استوديو الموقع', 'Site studio'), desc: tr('الهوية والألوان والخطوط والتنقل', 'Identity, colors, typography, and navigation') }] : []),
    ...(user?.role === 'owner' ? [{ to: '/admin/users', icon: Users, label: tr('الفريق والصلاحيات', 'Team and roles'), desc: tr('إدارة المستخدمين والأدوار بأمان', 'Securely manage users and roles') }] : []),
  ], [canManageContent, canManageIntegrations, t, tr, user?.role])

  const cards = [
    { label: t('dashboard.chats'), value: stats.chats, hint: t('dashboard.chatsHint'), icon: MessageCircle, color: 'text-primary-500 bg-primary-500/10' },
    { label: t('dashboard.providers'), value: stats.providers, hint: t('dashboard.providersHint'), icon: Bot, color: 'text-emerald-500 bg-emerald-500/10' },
    { label: t('dashboard.integrations'), value: stats.integrations, hint: t('dashboard.integrationsHint'), icon: Plug, color: 'text-amber-500 bg-amber-500/10' },
    ...(canManageContent ? [{ label: tr('المقالات المنشورة', 'Published articles'), value: content.articles, hint: tr(`${content.sections} أقسام • ${content.announcements} إعلانات`, `${content.sections} sections • ${content.announcements} announcements`), icon: BookOpen, color: 'text-sky-500 bg-sky-500/10' }] : []),
  ]

  return <div><AnnouncementBar placement="dashboard" /><div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
    <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8"><div><div className="inline-flex items-center gap-2 text-sm text-primary-600 dark:text-primary-400 mb-2"><Sparkles size={15} />{tr('مركز الإدارة', 'Administration center')}</div><h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">{t('dashboard.welcome')}، {user?.name?.split(' ')[0]}</h1><p className="text-dark-500 mt-2">{tr('ملخص تشغيلي وأدوات تحرير فعلية لإدارة المنصة من مكان واحد.', 'An operational overview and real editing tools to manage the platform in one place.')}</p></div><div className="flex gap-2"><Link to="/settings" className="btn btn-secondary"><Settings size={16} />{t('nav.settings')}</Link><Link to="/chat" className="btn btn-primary"><Plus size={16} />{t('nav.newChat')}</Link></div></div>

    <div className={`grid sm:grid-cols-2 ${cards.length === 4 ? 'xl:grid-cols-4' : 'xl:grid-cols-3'} gap-4 mb-7`}>{cards.map((card) => { const Icon = card.icon; return <div key={card.label} className="card p-5"><div className="flex items-start justify-between gap-3"><div><div className="text-sm text-dark-500">{card.label}</div><div className="text-4xl font-semibold tracking-tight mt-2">{loading ? '—' : card.value}</div></div><div className={`w-11 h-11 rounded-2xl grid place-items-center ${card.color}`}><Icon size={20} /></div></div><div className="text-xs text-dark-500 mt-5">{card.hint}</div></div> })}</div>

    <div className="grid xl:grid-cols-12 gap-5">
      <section className="xl:col-span-7 card p-5 sm:p-6"><div className="flex items-center justify-between mb-5"><div><h2 className="font-semibold text-lg">{t('dashboard.recent')}</h2><p className="text-xs text-dark-500 mt-1">{tr('آخر نشاط محفوظ في حسابك', 'Latest activity saved to your account')}</p></div><Link to="/chat" className="text-sm text-primary-600 dark:text-primary-400 hover:underline inline-flex items-center gap-1">{t('dashboard.viewAll')} <ArrowLeft size={14} /></Link></div>{loading ? <div className="space-y-3">{Array.from({ length: 3 }).map((_, index) => <div key={index} className="h-16 skeleton" />)}</div> : chats.length ? <div className="space-y-2">{chats.map((chat) => <Link key={chat.id} to={`/chat/${chat.id}`} className="flex items-center justify-between gap-4 p-4 rounded-2xl hover:bg-dark-100 dark:hover:bg-dark-800/60 border border-transparent hover:border-dark-200 dark:hover:border-dark-700 transition-colors group"><div className="flex items-center gap-3 min-w-0"><div className="w-10 h-10 rounded-xl bg-primary-500/10 text-primary-500 grid place-items-center shrink-0"><MessageCircle size={17} /></div><div className="min-w-0"><div className="font-medium truncate group-hover:text-primary-600">{chat.title}</div><div className="text-xs text-dark-500 truncate" dir="ltr">{chat.model || '—'} • {new Intl.DateTimeFormat(language === 'ar' ? 'ar' : 'en', { dateStyle: 'medium' }).format(new Date(chat.updatedAt))}</div></div></div><span className="text-xs text-dark-500 shrink-0">{chat.messageCount} {tr('رسالة', 'messages')}</span></Link>)}</div> : <div className="text-center py-14 text-dark-500"><MessageCircle className="mx-auto mb-3 opacity-40" size={34} /><p>{t('dashboard.noChats')}</p><Link to="/chat" className="text-primary-600 text-sm mt-2 inline-block">{t('dashboard.firstChat')} →</Link></div>}</section>

      <div className="xl:col-span-5 space-y-5"><section className="card p-5 sm:p-6"><h2 className="font-semibold text-lg mb-4">{t('dashboard.quickActions')}</h2><div className="grid sm:grid-cols-2 xl:grid-cols-1 gap-3">{quickActions.map((action) => { const Icon = action.icon; return <Link key={action.to} to={action.to} className="flex items-center gap-4 p-4 rounded-2xl border border-dark-200 dark:border-dark-700 hover:border-primary-500 hover:bg-primary-500/5 transition-colors group"><div className="section-icon"><Icon size={19} /></div><div><div className="font-medium">{action.label}</div><div className="text-xs text-dark-500 mt-0.5">{action.desc}</div></div></Link> })}</div></section>
        <section className="card p-5 sm:p-6"><div className="flex items-center justify-between mb-4"><h2 className="font-semibold text-lg">{t('dashboard.connectedProviders')}</h2><ShieldCheck size={18} className="text-emerald-500" /></div>{providers.length ? <div className="space-y-3">{providers.slice(0, 4).map((provider) => <div key={provider.id} className="flex items-center justify-between text-sm"><div><div className="font-medium">{provider.name}</div><div className="text-xs text-dark-500" dir="ltr">{provider.model || provider.protocol}</div></div><div className={`status-dot ${provider.status === 'connected' ? 'status-connected' : 'status-disconnected'}`} /></div>)}</div> : <div className="text-center py-4"><p className="text-dark-500 text-sm mb-3">{t('dashboard.noProviders')}</p><Link to="/providers" className="text-primary-600 text-sm">{t('dashboard.addProviderNow')} →</Link></div>}</section></div>
    </div>
  </div></div>
}
