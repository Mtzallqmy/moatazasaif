import { describe, expect, it } from 'vitest'
import { optionalSafeUrl, pageParams, requireSlug } from '../content.js'

describe('content validation', () => {
  it('accepts canonical slugs and rejects path traversal', () => {
    expect(requireSlug('secure-ai-guide')).toBe('secure-ai-guide')
    expect(() => requireSlug('../admin')).toThrow()
    expect(() => requireSlug('UPPER CASE')).toThrow()
  })

  it('allows only local or HTTPS content links', () => {
    expect(optionalSafeUrl('/blog/hello')).toBe('/blog/hello')
    expect(optionalSafeUrl('https://example.com/image.png')).toBe('https://example.com/image.png')
    expect(() => optionalSafeUrl('//evil.example')).toThrow()
    expect(() => optionalSafeUrl('javascript:alert(1)')).toThrow()
  })

  it('caps public pagination', () => {
    expect(pageParams({ page: '-4', limit: '500' })).toMatchObject({ page: 1, limit: 50, from: 0, to: 49 })
  })
})
