import { describe, expect, it } from 'vitest'
import { isOwnerEmail, OWNER_EMAILS } from '../access.js'

describe('owner email allowlist', () => {
  it('contains only the two explicitly authorized accounts', () => {
    expect(OWNER_EMAILS).toEqual(['mtzallqmy@gmail.com', 'moataz77549@gmail.com'])
  })

  it('normalizes casing and whitespace', () => {
    expect(isOwnerEmail('  MTZALLQMY@GMAIL.COM ')).toBe(true)
  })

  it('rejects every unlisted account', () => {
    expect(isOwnerEmail('someone@example.com')).toBe(false)
    expect(isOwnerEmail(undefined)).toBe(false)
  })
})
