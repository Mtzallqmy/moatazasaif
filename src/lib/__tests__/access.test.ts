import { describe, expect, it } from 'vitest'
import { homeForUser } from '../access'

describe('role-safe landing routes', () => {
  it('keeps regular social-login users out of management', () => {
    expect(homeForUser({ role: 'user', forcePasswordChange: false })).toBe('/chat')
  })

  it('sends editors directly to content management', () => {
    expect(homeForUser({ role: 'editor', forcePasswordChange: false })).toBe('/admin/content')
  })

  it.each(['owner', 'admin', 'manager'] as const)('allows %s into the dashboard', (role) => {
    expect(homeForUser({ role, forcePasswordChange: false })).toBe('/dashboard')
  })

  it('prioritizes a mandatory password change', () => {
    expect(homeForUser({ role: 'owner', forcePasswordChange: true })).toBe('/settings')
  })
})
