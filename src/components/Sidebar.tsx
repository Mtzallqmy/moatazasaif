import { NavLink, useLocation } from 'react-router-dom'
import { MessageCircle, LayoutDashboard, Bot, Plug, Settings, LogOut, X, Plus, Users, Newspaper, Palette, Activity } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { cn } from '../lib/utils'
import { usePreferences } from '../contexts/PreferencesContext'
import { CONTENT_ROLES, INTEGRATION_ROLES, MANAGEMENT_ROLES } from '../lib/access'
import { useSiteSettings } from '../contexts/SiteSettingsContext'

interface SidebarProps { onClose: () => void; onLogout: () => void }

export default function Sidebar({ onClose, onLogout }: SidebarProps) {
  const location = useLocation()
  const { user } = useAuth()
  const { t, tr } = usePreferences()
  const { settings: siteSettings } = useSiteSettings()
  const brandName = tr(siteSettings.siteNameAr, siteSettings.siteNameEn)
  const navItems = [
    ...(MANAGEMENT_ROLES.includes(user?.role || 'user') ? [{ to: '/dashboard', icon: LayoutDashboard, label: t('nav.dashboard') }] : []),
    { to: '/chat', icon: MessageCircle, label: t('nav.chat') },
    { to: '/providers', icon: Bot, label: t('nav.providers') },
    ...(INTEGRATION_ROLES.includes(user?.role || 'user') ? [{ to: '/integrations', icon: Plug, label: t('nav.integrations') }] : []),
    ...(['owner', 'admin', 'manager'].includes(user?.role || 'user') ? [{ to: '/developer/diagnostics', icon: Activity, label: tr('تشخيص المطور', 'Developer diagnostics') }] : []),
    ...(user?.role === 'owner' ? [{ to: '/admin/users', icon: Users, label: t('nav.users') }] : []),
    ...(CONTENT_ROLES.includes(user?.role || 'user') ? [{ to: '/admin/content', icon: Newspaper, label: tr('إدارة المحتوى', 'Content management') }] : []),
    ...(['owner', 'admin'].includes(user?.role || 'user') ? [{ to: '/admin/site', icon: Palette, label: tr('هوية الموقع', 'Site studio') }] : []),
    { to: '/settings', icon: Settings, label: t('nav.settings') },
  ]
  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(`${path}/`)
  const initials = user?.name?.trim()?.charAt(0) || 'م'

  return <div className="sidebar w-72 h-full flex flex-col bg-white dark:bg-dark-900 border-e border-dark-200 dark:border-dark-700">
    <div className="flex items-center justify-between px-6 py-5 border-b border-dark-200 dark:border-dark-700"><div className="flex items-center gap-3"><div className="brand-gradient w-9 h-9 rounded-2xl flex items-center justify-center"><span className="text-white font-bold text-xl">{brandName.charAt(0)}</span></div><div><div className="font-semibold text-lg">{brandName}</div><div className="text-[10px] text-dark-500 -mt-1">AI Workspace</div></div></div><button onClick={onClose} aria-label={t('common.close')} className="md:hidden p-2 text-dark-400"><X size={18} /></button></div>
    <div className="px-4 pt-4"><NavLink to="/chat" className="btn btn-primary w-full justify-center gap-2 text-sm py-3"><Plus size={16} /> {t('nav.newChat')}</NavLink></div>
    <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">{navItems.map((item) => { const Icon = item.icon; const active = isActive(item.to); return <NavLink key={item.to} to={item.to} className={cn('flex items-center gap-3 px-4 py-3 rounded-2xl text-sm font-medium transition-all', active ? 'bg-primary-600 text-white shadow-sm' : 'text-dark-600 dark:text-dark-300 hover:bg-dark-100 dark:hover:bg-dark-800')}><Icon size={18} />{item.label}</NavLink> })}</nav>
    <div className="border-t border-dark-200 dark:border-dark-700 p-4 mt-auto"><div className="flex items-center gap-3 px-2 py-2 rounded-2xl"><div className="w-9 h-9 rounded-full bg-primary-600 flex items-center justify-center font-bold text-white overflow-hidden">{user?.avatar ? <img src={user.avatar} alt={user.name} className="w-full h-full object-cover" /> : initials}</div><div className="flex-1 min-w-0"><div className="font-medium text-sm truncate">{user?.name}</div><div className="text-xs text-dark-500 truncate" dir="ltr">@{user?.username || user?.email || 'user'}</div></div><button onClick={onLogout} className="p-2 text-dark-400 hover:text-red-500" title={t('nav.logout')} aria-label={tr('تسجيل الخروج', 'Sign out')}><LogOut size={16} /></button></div></div>
  </div>
}
