import type React from 'react'
import { PreferencesProvider, usePreferences } from './PreferencesContext'

// Kept as a compatibility layer for components that have not yet migrated to
// the richer preferences API.
export const ThemeProvider = ({ children }: { children: React.ReactNode }) => <PreferencesProvider>{children}</PreferencesProvider>

export const useTheme = () => {
  const { theme, effectiveTheme, setTheme } = usePreferences()
  return {
    theme,
    effectiveTheme,
    setTheme,
    toggleTheme: () => setTheme(effectiveTheme === 'dark' ? 'light' : 'dark'),
  }
}
