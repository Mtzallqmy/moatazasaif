export const LANGUAGES = ['ar', 'en'] as const
export const THEME_MODES = ['system', 'light', 'dark', 'eye'] as const
export const FONT_SCALES = ['sm', 'md', 'lg'] as const

export type Language = (typeof LANGUAGES)[number]
export type ThemeMode = (typeof THEME_MODES)[number]
export type FontScale = (typeof FONT_SCALES)[number]

export interface UserPreferences {
  language: Language
  theme: ThemeMode
  reduceMotion: boolean
  highContrast: boolean
  fontScale: FontScale
}

export const DEFAULT_USER_PREFERENCES: UserPreferences = {
  language: 'ar',
  theme: 'system',
  reduceMotion: false,
  highContrast: false,
  fontScale: 'md',
}

function isOneOf<T extends readonly string[]>(value: unknown, values: T): value is T[number] {
  return typeof value === 'string' && values.includes(value)
}

export function normalizeUserPreferences(value: unknown): UserPreferences {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}

  return {
    language: isOneOf(source.language, LANGUAGES) ? source.language : DEFAULT_USER_PREFERENCES.language,
    theme: isOneOf(source.theme, THEME_MODES) ? source.theme : DEFAULT_USER_PREFERENCES.theme,
    reduceMotion: typeof source.reduceMotion === 'boolean' ? source.reduceMotion : DEFAULT_USER_PREFERENCES.reduceMotion,
    highContrast: typeof source.highContrast === 'boolean' ? source.highContrast : DEFAULT_USER_PREFERENCES.highContrast,
    fontScale: isOneOf(source.fontScale, FONT_SCALES) ? source.fontScale : DEFAULT_USER_PREFERENCES.fontScale,
  }
}

export function isUserPreferences(value: unknown): value is UserPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const source = value as Record<string, unknown>
  return isOneOf(source.language, LANGUAGES)
    && isOneOf(source.theme, THEME_MODES)
    && typeof source.reduceMotion === 'boolean'
    && typeof source.highContrast === 'boolean'
    && isOneOf(source.fontScale, FONT_SCALES)
}
