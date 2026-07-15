export type OAuthProvider = 'google' | 'github'

export type OAuthProviderAvailability = 'enabled' | 'disabled' | 'unreachable' | 'unknown'

interface SupabaseBrowserConfig {
  url: string
  publishableKey: string
}

interface AuthSettings {
  external?: Partial<Record<OAuthProvider, boolean>>
}

/**
 * Supabase builds the OAuth authorize URL in the browser, so a disabled
 * provider otherwise navigates away before the SDK can surface the error.
 * Check the public Auth settings first and keep the user inside the app when
 * the provider is unavailable.
 */
export async function getOAuthProviderAvailability(
  config: SupabaseBrowserConfig,
  provider: OAuthProvider,
  fetcher: typeof fetch = fetch,
  timeoutMs = 5_000,
): Promise<OAuthProviderAvailability> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetcher(new URL('/auth/v1/settings', config.url).toString(), {
      headers: { apikey: config.publishableKey },
      signal: controller.signal,
    })
    if (!response.ok) return 'unknown'

    const settings = await response.json() as AuthSettings
    const enabled = settings.external?.[provider]
    if (enabled === true) return 'enabled'
    if (enabled === false) return 'disabled'
    return 'unknown'
  } catch {
    // A rejected fetch most commonly means the device cannot resolve or reach
    // the Supabase Auth hostname. Keep this distinct from a valid but
    // unexpected response so the UI can give useful DNS guidance.
    return 'unreachable'
  } finally {
    clearTimeout(timeout)
  }
}
