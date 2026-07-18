// The Vercel alias is the only verified origin that currently serves the
// Vercel Functions. Switch this value to the custom domain after that domain is
// attached to this same Vercel project; never infer an API origin from a
// separate static/Sites deployment.
export const PRODUCTION_APP_URL = 'https://moatazasaif.vercel.app'

function getPublicHttpsOrigin(value: string | undefined) {
  if (!value) return null
  try {
    const url = new URL(value)
    const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
    if (url.protocol !== 'https:' || isLocal) return null
    return url.origin
  } catch {
    return null
  }
}

/**
 * Resolve the OAuth and magic-link destination to the public origin the user is
 * actually visiting. This prevents a stale Vercel environment variable from
 * sending custom-domain visitors back to an old deployment hostname.
 *
 * Local development never becomes an OAuth destination: localhost falls back
 * to the explicitly configured public URL, then to the production domain.
 */
export function resolveAuthRedirectUrl(configured: string | undefined, currentOrigin: string, productionUrl = PRODUCTION_APP_URL) {
  const configuredOrigin = getPublicHttpsOrigin(configured)
  if (configuredOrigin) return `${configuredOrigin}/login`

  const productionOrigin = getPublicHttpsOrigin(productionUrl) || PRODUCTION_APP_URL
  if (productionOrigin) return `${productionOrigin}/login`

  const browserOrigin = getPublicHttpsOrigin(currentOrigin)
  return `${browserOrigin || PRODUCTION_APP_URL}/login`
}

export function getAuthRedirectUrl() {
  const currentOrigin = typeof window !== 'undefined' ? window.location.origin : ''
  return resolveAuthRedirectUrl(import.meta.env.VITE_APP_URL || import.meta.env.NEXT_PUBLIC_APP_URL, currentOrigin)
}
