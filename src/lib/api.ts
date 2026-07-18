export async function authHeaders(json = true) {
  const headers: Record<string, string> = {}
  if (json) headers['Content-Type'] = 'application/json'
  return headers
}

export async function apiJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (!headers.has('Accept-Language')) headers.set('Accept-Language', typeof document !== 'undefined' ? document.documentElement.lang || 'ar' : 'ar')
  if (!headers.has('X-Request-ID')) headers.set('X-Request-ID', typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `web-${Date.now()}`)
  const controller = init.signal ? undefined : new AbortController()
  const timeout = controller ? window.setTimeout(() => controller.abort(), 30_000) : undefined
  let response: Response
  const request = () => fetch(url, { ...init, credentials: 'same-origin', headers, signal: init.signal || controller?.signal })
  try {
    response = await request()
    if (response.status === 401 && url !== '/api/auth/session' && !headers.has('Authorization')) {
      const refreshed = await fetch('/api/auth/session', { credentials: 'same-origin', cache: 'no-store' }).catch(() => null)
      if (refreshed?.ok) response = await request()
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw new Error(document.documentElement.lang === 'en' ? 'The request timed out. Please try again.' : 'انتهت مهلة الطلب. أعد المحاولة.')
    throw error
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout)
  }

  const body = response.status === 204 ? null : await response.json().catch(() => null)
  
  if (!response.ok) {
    const message = body?.error || body?.message || `HTTP ${response.status}`
    const error = new Error(message) as Error & { code?: string; details?: unknown; status?: number }
    error.code = body?.code
    error.details = body?.diagnostic || body?.details || body
    error.status = response.status
    throw error
  }
  
  return body as T
}
