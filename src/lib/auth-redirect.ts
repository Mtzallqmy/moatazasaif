export const PRODUCTION_APP_URL = 'https://moatazasaif.vercel.app'

function isLocalOrigin(value: string) {
  try {
    const url = new URL(value)
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
  } catch {
    return true
  }
}

/**
 * Resolve a Supabase magic-link destination without ever sending users to a
 * local development server. A configured public URL wins; otherwise a real
 * HTTPS browser origin is used and localhost falls back to production.
 */
export function resolveAuthRedirectUrl(configured: string | undefined, currentOrigin: string, productionUrl = PRODUCTION_APP_URL) {
  // Only an explicitly configured origin may override production. This keeps
  // preview copies and arbitrary HTTPS hosts from becoming magic-link
  // destinations when the public env variable is missing.
  const candidate = configured?.trim() || productionUrl
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'https:' || isLocalOrigin(url.origin)) return `${productionUrl}/login`
    return `${url.origin}/login`
  } catch {
    return `${productionUrl}/login`
  }
}

export function getAuthRedirectUrl() {
  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : ''
  return resolveAuthRedirectUrl(import.meta.env.VITE_APP_URL || import.meta.env.NEXT_PUBLIC_APP_URL, currentOrigin)
}
