import { describe, expect, it } from 'vitest'
import { navigationCreateSchema, siteSettingsPatchSchema } from '../site-schemas.js'

describe('site settings schemas', () => {
  it('accepts a calm valid brand configuration', () => {
    expect(siteSettingsPatchSchema.parse({ primaryColor: '#526d82', fontStyle: 'modern' })).toEqual({
      primaryColor: '#526d82', fontStyle: 'modern',
    })
  })

  it('rejects executable and insecure navigation targets', () => {
    const base = { location: 'header', labelAr: 'اختبار', labelEn: 'Test' }
    expect(navigationCreateSchema.safeParse({ ...base, href: 'javascript:alert(1)' }).success).toBe(false)
    expect(navigationCreateSchema.safeParse({ ...base, href: 'http://example.com' }).success).toBe(false)
  })

  it('accepts relative and HTTPS navigation targets', () => {
    const base = { location: 'footer', labelAr: 'الخصوصية', labelEn: 'Privacy' }
    expect(navigationCreateSchema.safeParse({ ...base, href: '/privacy' }).success).toBe(true)
    expect(navigationCreateSchema.safeParse({ ...base, href: 'https://example.com/help' }).success).toBe(true)
  })
})
