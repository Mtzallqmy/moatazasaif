import { describe, expect, it } from 'vitest'
import { DEFAULT_USER_PREFERENCES, isUserPreferences, normalizeUserPreferences } from '../../../shared/user-preferences'

describe('user preferences', () => {
  it('normalizes missing and unsafe values to stable defaults', () => {
    expect(normalizeUserPreferences({ theme: 'unknown', language: 'en', reduceMotion: 'yes' })).toEqual({
      ...DEFAULT_USER_PREFERENCES,
      language: 'en',
    })
  })

  it('accepts the complete eye-comfort preference set', () => {
    const preferences = { language: 'ar', theme: 'eye', reduceMotion: true, highContrast: true, fontScale: 'lg' } as const
    expect(isUserPreferences(preferences)).toBe(true)
    expect(normalizeUserPreferences(preferences)).toEqual(preferences)
  })
})
