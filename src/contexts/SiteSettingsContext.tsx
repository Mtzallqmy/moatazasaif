import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { apiJson } from '../lib/api'
import {
  DEFAULT_SITE_SETTINGS,
  hexToRgb,
  type PublicSiteConfiguration,
  type SiteSettings,
} from '../../shared/site-settings'

interface SiteSettingsContextValue extends PublicSiteConfiguration {
  loading: boolean
  reload: () => Promise<void>
  replaceSettings: (settings: SiteSettings) => void
}

const fallback: PublicSiteConfiguration = { settings: DEFAULT_SITE_SETTINGS, navigation: [] }
const SiteSettingsContext = createContext<SiteSettingsContextValue | undefined>(undefined)

export function SiteSettingsProvider({ children }: { children: React.ReactNode }) {
  const [configuration, setConfiguration] = useState<PublicSiteConfiguration>(fallback)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    try {
      const response = await apiJson<{ data: PublicSiteConfiguration }>('/api/v1/site')
      setConfiguration(response.data)
    } catch {
      setConfiguration((current) => current || fallback)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  useEffect(() => {
    const root = document.documentElement
    const primary = hexToRgb(configuration.settings.primaryColor)
    const accent = hexToRgb(configuration.settings.accentColor)
    if (primary) root.style.setProperty('--brand-primary-rgb', primary)
    if (accent) root.style.setProperty('--brand-accent-rgb', accent)
    root.style.setProperty('--brand-primary', configuration.settings.primaryColor)
    root.style.setProperty('--brand-accent', configuration.settings.accentColor)
    root.dataset.siteFont = configuration.settings.fontStyle
    document.title = configuration.settings.siteNameAr
  }, [configuration.settings])

  const replaceSettings = useCallback((settings: SiteSettings) => {
    setConfiguration((current) => ({ ...current, settings }))
  }, [])

  const value = useMemo(() => ({ ...configuration, loading, reload, replaceSettings }), [configuration, loading, reload, replaceSettings])
  return <SiteSettingsContext.Provider value={value}>{children}</SiteSettingsContext.Provider>
}

export function useSiteSettings() {
  const context = useContext(SiteSettingsContext)
  if (!context) throw new Error('useSiteSettings must be used within SiteSettingsProvider')
  return context
}
