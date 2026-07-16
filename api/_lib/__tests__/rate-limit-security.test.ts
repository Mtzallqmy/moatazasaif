import { afterEach, describe, expect, it } from 'vitest'
import { authRateLimitFingerprints } from '../rate-limit.js'

afterEach(() => {
  delete process.env.ENCRYPTION_KEY
})

describe('persisted rate-limit privacy', () => {
  it('uses stable independent IP and account HMAC buckets', () => {
    process.env.ENCRYPTION_KEY = 'production-test-encryption-key-32-bytes-minimum'
    const subject = 'person@example.com'
    const first = authRateLimitFingerprints('auth_login', '203.0.113.10', subject)
    const second = authRateLimitFingerprints('auth_login', '203.0.113.10', subject.toUpperCase())
    expect(first).toEqual(second)
    expect(first).toHaveLength(2)
    expect(first[0]).not.toBe(first[1])
    expect(JSON.stringify(first)).not.toContain(subject)
  })

  it('changes only the relevant bucket when the source IP changes', () => {
    process.env.ENCRYPTION_KEY = 'production-test-encryption-key-32-bytes-minimum'
    const first = authRateLimitFingerprints('auth_login', '203.0.113.10', 'person@example.com')
    const second = authRateLimitFingerprints('auth_login', '203.0.113.11', 'person@example.com')
    expect(first[0]).not.toBe(second[0])
    expect(first[1]).toBe(second[1])
  })
})
