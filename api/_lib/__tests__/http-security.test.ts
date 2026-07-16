import { describe, expect, it, vi } from 'vitest'
import { ApiError, getBearerToken, sendError, setJsonHeaders } from '../http.js'

function responseDouble() {
  const headers = new Map<string, string>()
  const response: any = {
    setHeader: vi.fn((name: string, value: string) => headers.set(name.toLowerCase(), String(value))),
    status: vi.fn(() => response),
    json: vi.fn(() => response),
  }
  return { response, headers }
}

describe('API transport security', () => {
  it('accepts a case-insensitive Bearer scheme and rejects oversized credentials', () => {
    expect(getBearerToken({ headers: { authorization: 'bearer compact-token' } } as any)).toBe('compact-token')
    expect(getBearerToken({ headers: { authorization: `Bearer ${'x'.repeat(16_385)}` } } as any)).toBeNull()
    expect(getBearerToken({ headers: { authorization: 'Basic value' } } as any)).toBeNull()
  })

  it('marks JSON responses as private and non-indexable', () => {
    const { response, headers } = responseDouble()
    setJsonHeaders(response)
    expect(headers.get('cache-control')).toBe('no-store')
    expect(headers.get('pragma')).toBe('no-cache')
    expect(headers.get('x-robots-tag')).toContain('noindex')
    expect(headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('emits a bounded Retry-After header for rate-limit errors', () => {
    const { response, headers } = responseDouble()
    sendError(response, new ApiError(429, 'too many', 'rate_limited', {
      resetAt: new Date(Date.now() + 5_000).toISOString(),
    }))
    expect(Number(headers.get('retry-after'))).toBeGreaterThanOrEqual(1)
    expect(Number(headers.get('retry-after'))).toBeLessThanOrEqual(6)
    expect(headers.get('x-ratelimit-remaining')).toBe('0')
    expect(response.status).toHaveBeenCalledWith(429)
  })
})
