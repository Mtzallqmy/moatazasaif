import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_USER_PREFERENCES,
  normalizeUserPreferences,
  type Language,
  type ThemeMode,
  type UserPreferences,
} from '../../shared/user-preferences'
import { messages, type MessageKey } from '../i18n/messages'

const STORAGE_KEY = 'moataz-ai.preferences.v1'

interface PreferencesContextValue {
  preferences: UserPreferences
  language: Language
  theme: ThemeMode
  effectiveTheme: Exclude<ThemeMode, 'system'>
  setLanguage: (language: Language) => void
  setTheme: (theme: ThemeMode) => void
  updatePreferences: (patch: Partial<UserPreferences>) => void
  replacePreferences: (preferences: UserPreferences) => void
  t: (key: MessageKey) => string
  tr: (arabic: string, english: string) => string
}

const PreferencesContext = createContext<PreferencesContextValue | undefined>(undefined)

function loadPreferences(): UserPreferences {
  if (typeof window === 'undefined') return DEFAULT_USER_PREFERENCES
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored) return normalizeUserPreferences(JSON.parse(stored))
    const legacyTheme = window.localStorage.getItem('theme')
    return normalizeUserPreferences({ ...DEFAULT_USER_PREFERENCES, theme: legacyTheme })
  } catch {
    return DEFAULT_USER_PREFERENCES
  }
}

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const [preferences, setPreferences] = useState<UserPreferences>(loadPreferences)
  const [systemDark, setSystemDark] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches)

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const listener = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    media.addEventListener('change', listener)
    return () => media.removeEventListener('change', listener)
  }, [])

  const effectiveTheme = preferences.theme === 'system'
    ? (systemDark ? 'dark' : 'light')
    : preferences.theme

  useEffect(() => {
    const root = document.documentElement
    const dark = effectiveTheme === 'dark'
    root.classList.toggle('dark', dark)
    root.dataset.theme = effectiveTheme
    root.dataset.contrast = preferences.highContrast ? 'high' : 'normal'
    root.dataset.motion = preferences.reduceMotion ? 'reduced' : 'full'
    root.dataset.fontScale = preferences.fontScale
    root.lang = preferences.language
    root.dir = preferences.language === 'ar' ? 'rtl' : 'ltr'
    root.style.colorScheme = dark ? 'dark' : 'light'
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', effectiveTheme === 'dark' ? '#070b17' : effectiveTheme === 'eye' ? '#efe6d1' : '#f8fafc')
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
  }, [effectiveTheme, preferences])

  const updatePreferences = useCallback((patch: Partial<UserPreferences>) => {
    setPreferences((current) => normalizeUserPreferences({ ...current, ...patch }))
  }, [])
  const replacePreferences = useCallback((next: UserPreferences) => setPreferences(normalizeUserPreferences(next)), [])
  const setLanguage = useCallback((language: Language) => updatePreferences({ language }), [updatePreferences])
  const setTheme = useCallback((theme: ThemeMode) => updatePreferences({ theme }), [updatePreferences])
  const t = useCallback((key: MessageKey) => messages[preferences.language][key], [preferences.language])
  const tr = useCallback((arabic: string, english: string) => preferences.language === 'ar' ? arabic : english, [preferences.language])

  const value = useMemo(() => ({ preferences, language: preferences.language, theme: preferences.theme, effectiveTheme, setLanguage, setTheme, updatePreferences, replacePreferences, t, tr }), [effectiveTheme, preferences, replacePreferences, setLanguage, setTheme, t, tr, updatePreferences])
  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>
}

export function usePreferences() {
  const context = useContext(PreferencesContext)
  if (!context) throw new Error('usePreferences must be used within PreferencesProvider')
  return context
}
