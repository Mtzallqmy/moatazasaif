import { Settings2 } from 'lucide-react'
import { usePreferences } from '../contexts/PreferencesContext'
import AppearanceControls from './AppearanceControls'

export default function PublicPreferencesButton() {
  const { language, t } = usePreferences()
  return <details className="fixed top-4 end-4 z-[60] group">
    <summary className="list-none cursor-pointer inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-dark-200 dark:border-white/15 bg-white/85 dark:bg-dark-900/85 backdrop-blur-xl shadow-sm text-sm" aria-label={t('common.appearance')}><Settings2 size={17} /><span className="font-semibold uppercase">{language}</span></summary>
    <div className="absolute end-0 top-12 w-[min(22rem,calc(100vw-2rem))] card p-4 shadow-2xl"><AppearanceControls compact /></div>
  </details>
}
