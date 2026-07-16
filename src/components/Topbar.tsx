import { Eye, Menu, Moon, Settings2, ShieldCheck, Sun } from 'lucide-react'
import { usePreferences } from '../contexts/PreferencesContext'
import AppearanceControls from './AppearanceControls'
import type { User } from '../types'

interface TopbarProps { onToggleSidebar: () => void; sidebarOpen: boolean; user: User | null }

export default function Topbar({ onToggleSidebar, user }: TopbarProps) {
  const { language, effectiveTheme, t, tr } = usePreferences()
  const ThemeIcon = effectiveTheme === 'dark' ? Moon : effectiveTheme === 'eye' ? Eye : Sun
  return <header className="h-16 border-b border-dark-200 dark:border-dark-700 bg-white/85 dark:bg-dark-900/85 backdrop-blur-xl flex items-center justify-between px-4 md:px-6 z-30 flex-shrink-0">
    <div className="flex items-center gap-4"><button onClick={onToggleSidebar} aria-label={tr('فتح القائمة', 'Open menu')} aria-expanded={sidebarOpen} className="icon-button md:hidden"><Menu size={20} /></button><div className="hidden md:block text-sm text-dark-500">{tr('مرحبًا،', 'Welcome,')} <span className="font-medium text-dark-700 dark:text-dark-200">{user?.name?.split(' ')[0]}</span></div></div>
    <div className="flex items-center gap-2">
      <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs" title={tr('تم التحقق من جلسة المستخدم', 'User session verified')}><ShieldCheck size={14} /> {t('common.sessionActive')}</div>
      <details id="appearance-menu" className="relative group">
        <summary className="list-none icon-button cursor-pointer" aria-label={t('common.appearance')}><ThemeIcon size={18} /><Settings2 size={15} className="hidden sm:block" /><span className="hidden sm:inline text-xs font-semibold uppercase">{language}</span></summary>
        <div className="absolute end-0 top-12 z-50 w-[min(22rem,calc(100vw-2rem))] card p-4 shadow-2xl"><AppearanceControls compact /></div>
      </details>
      <div className="md:hidden w-8 h-8 rounded-full bg-primary-600 text-white flex items-center justify-center font-bold overflow-hidden">{user?.avatar ? <img src={user.avatar} alt={tr('صورة الحساب', 'Profile photo')} className="w-full h-full object-cover" /> : user?.name?.charAt(0)}</div>
    </div>
  </header>
}
