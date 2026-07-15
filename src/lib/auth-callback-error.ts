export interface AuthCallbackFailure {
  code?: string
  description: string
  message: string
}

function callbackParameters(search: string, hash: string) {
  const sources = [search, hash].map((value) => new URLSearchParams(value.replace(/^[?#]/, '')))
  return sources.find((params) => params.has('error') || params.has('error_code'))
}

/** Read a Supabase OAuth callback failure without touching successful token hashes. */
export function readAuthCallbackFailure(search: string, hash: string): AuthCallbackFailure | null {
  const params = callbackParameters(search, hash)
  if (!params) return null

  const code = params.get('error_code') || params.get('error') || undefined
  const description = params.get('error_description') || params.get('error') || 'تعذر إكمال تسجيل الدخول'

  if (/invalid_client|client secret.*invalid|unable to exchange external code/i.test(`${code || ''} ${description}`)) {
    return {
      code,
      description,
      message: 'تعذر إكمال تسجيل الدخول لأن Client Secret في Supabase غير صحيح أو لا يطابق Client ID. حدّث بيانات OAuth من نفس التطبيق ثم أعد المحاولة.',
    }
  }
  if (/access_denied|cancel/i.test(`${code || ''} ${description}`)) {
    return { code, description, message: 'أُلغي تسجيل الدخول أو لم يتم منح الإذن للموقع.' }
  }
  return { code, description, message: `تعذر إكمال تسجيل الدخول: ${description}` }
}

export function clearAuthCallbackFailure() {
  if (typeof window === 'undefined') return
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search && !callbackParameters(window.location.search, '') ? window.location.search : ''}`)
}
