import type { AppRole, User } from '../types'

export const MANAGEMENT_ROLES: AppRole[] = ['owner', 'admin', 'manager', 'editor']
export const CONTENT_ROLES: AppRole[] = ['owner', 'admin', 'manager', 'editor']
export const INTEGRATION_ROLES: AppRole[] = ['owner', 'admin', 'manager']

export function homeForUser(user: Pick<User, 'role' | 'forcePasswordChange'>) {
  if (user.forcePasswordChange) return '/settings'
  if (user.role === 'editor') return '/admin/content'
  return MANAGEMENT_ROLES.includes(user.role) ? '/dashboard' : '/chat'
}
