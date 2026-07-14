import { supabase } from './supabase'

export async function authHeaders(json = true) {
  const headers: Record<string, string> = {}
  if (json) headers['Content-Type'] = 'application/json'
  
  try {
    if (supabase) {
      const { data } = await supabase.auth.getSession()
      if (data?.session?.access_token) {
        headers['Authorization'] = `Bearer ${data.session.access_token}`
      }
    }
  } catch {
    // In guest/session mode there may be no Supabase session. Do not log
    // auth errors because SDK errors can include request metadata.
  }
  
  return headers
}

export async function apiJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, init)

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
