import { describe, expect, it } from 'vitest'
import { resolveAuthRedirectUrl } from '../auth-redirect'

describe('magic-link redirect', () => {
  it('never points a production link at localhost', () => {
    expect(resolveAuthRedirectUrl(undefined, 'http://localhost:3000')).toBe('https://moatazalalqami.online/login')
    expect(resolveAuthRedirectUrl('http://localhost:5173', 'https://moatazasaif.vercel.app')).toBe('https://moatazalalqami.online/login')
  })

  it('uses an explicit HTTPS origin and strips paths', () => {
    expect(resolveAuthRedirectUrl('https://moatazasaif.vercel.app/', 'https://preview.example.com')).toBe('https://moatazasaif.vercel.app/login')
    expect(resolveAuthRedirectUrl(undefined, 'https://custom.example.com/dashboard')).toBe('https://moatazalalqami.online/login')
    expect(resolveAuthRedirectUrl('https://custom.example.com/dashboard', 'https://moatazasaif.vercel.app')).toBe('https://custom.example.com/login')
  })
})
