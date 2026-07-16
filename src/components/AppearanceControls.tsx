import { Check, Eye, Laptop, Moon, Sun } from 'lucide-react'
import { FONT_SCALES, THEME_MODES, type FontScale, type ThemeMode } from '../../shared/user-preferences'
import { usePreferences } from '../contexts/PreferencesContext'
import { cn } from '../lib/utils'

const themeIcons = { system: Laptop, light: Sun, dark: Moon, eye: Eye }

export default function AppearanceControls({ compact = false }: { compact?: boolean }) {
  const { preferences, setLanguage, setTheme, updatePreferences, t } = usePreferences()
  const themeLabels: Record<ThemeMode, [string, string]> = {
    system: [t('theme.system'), t('theme.systemHint')],
    light: [t('theme.light'), t('theme.lightHint')],
    dark: [t('theme.dark'), t('theme.darkHint')],
    eye: [t('theme.eye'), t('theme.eyeHint')],
  }
  const fontLabels: Record<FontScale, string> = { sm: t('settings.fontSm'), md: t('settings.fontMd'), lg: t('settings.fontLg') }

  return <div className={compact ? 'space-y-4' : 'space-y-7'}>
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-dark-500 mb-2">{t('common.language')}</div>
      <div className="grid grid-cols-2 gap-2" role="group" aria-label={t('common.language')}>
        {(['ar', 'en'] as const).map((language) => <button key={language} type="button" onClick={() => setLanguage(language)} className={cn('preference-choice justify-center', preferences.language === language && 'active')} aria-pressed={preferences.language === language}>
          {preferences.language === language && <Check size={14} />} {language === 'ar' ? 'العربية' : 'English'}
        </button>)}
      </div>
    </div>

    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-dark-500 mb-2">{t('common.appearance')}</div>
      <div className={cn('grid gap-2', compact ? 'grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-4')}>
        {THEME_MODES.map((mode) => {
          const Icon = themeIcons[mode]
          const [label, hint] = themeLabels[mode]
          return <button key={mode} type="button" onClick={() => setTheme(mode)} className={cn('preference-card', preferences.theme === mode && 'active')} aria-pressed={preferences.theme === mode}>
            <span className="flex items-center gap-2 font-medium"><Icon size={17} />{label}</span>
            {!compact && <span className="text-xs text-dark-500 mt-1">{hint}</span>}
          </button>
        })}
      </div>
    </div>

    {!compact && <>
      <div>
        <div className="text-xs font-semibold uppercase tracking-wider text-dark-500 mb-2">{t('settings.fontSize')}</div>
        <div className="inline-flex rounded-xl border border-dark-200 dark:border-dark-700 p-1 bg-dark-50 dark:bg-dark-900">
          {FONT_SCALES.map((scale) => <button type="button" key={scale} onClick={() => updatePreferences({ fontScale: scale })} className={cn('px-4 py-2 rounded-lg text-sm transition-colors', preferences.fontScale === scale ? 'bg-primary-600 text-white' : 'text-dark-600 dark:text-dark-300 hover:bg-dark-100 dark:hover:bg-dark-800')} aria-pressed={preferences.fontScale === scale}>{fontLabels[scale]}</button>)}
        </div>
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        <label className="toggle-card"><span><span className="font-medium block">{t('settings.reduceMotion')}</span><span className="text-xs text-dark-500">{t('settings.reduceMotionHint')}</span></span><input type="checkbox" checked={preferences.reduceMotion} onChange={(event) => updatePreferences({ reduceMotion: event.target.checked })} /><span className="toggle-switch" /></label>
        <label className="toggle-card"><span><span className="font-medium block">{t('settings.highContrast')}</span><span className="text-xs text-dark-500">{t('settings.highContrastHint')}</span></span><input type="checkbox" checked={preferences.highContrast} onChange={(event) => updatePreferences({ highContrast: event.target.checked })} /><span className="toggle-switch" /></label>
      </div>
    </>}
  </div>
}
