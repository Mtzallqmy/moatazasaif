import { getProviderDefinition, resolveProviderBaseUrl, resolveProviderProtocol, type ProviderProtocol, type ProviderType } from '../../shared/provider-registry'
import type { ProviderDiagnostic } from '../types'
import { clearLocalChatData } from './local-chat-store'

export const SESSION_PROVIDER_STORAGE_KEY = 'moataz.byok.session-provider.v1'
export const SESSION_PROVIDER_CHANGED_EVENT = 'moataz:session-provider-changed'

export interface SessionProviderCredential {
  id: 'session'
  credentialMode: 'session'
  name: string
  type: ProviderType
  protocol: ProviderProtocol
  baseUrl: string
  apiKey: string
  model?: string
  models: string[]
  status: 'connected' | 'error' | 'untested'
  diagnostic?: ProviderDiagnostic
  lastTested?: string
}

function browserStorage(): Storage | undefined {
  return typeof window !== 'undefined' ? window.sessionStorage : undefined
}

function notify() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SESSION_PROVIDER_CHANGED_EVENT))
}

export function getSessionProvider(storage = browserStorage()): SessionProviderCredential | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(SESSION_PROVIDER_STORAGE_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as SessionProviderCredential
    const definition = getProviderDefinition(value.type)
    if (!definition || typeof value.apiKey !== 'string' || !value.apiKey.trim()) return null
    const baseUrl = resolveProviderBaseUrl(value.type, value.baseUrl)
    if (!baseUrl) return null
    return {
      ...value,
      id: 'session',
      credentialMode: 'session',
      protocol: resolveProviderProtocol(value.type, value.protocol, baseUrl),
      baseUrl,
      models: Array.isArray(value.models) ? value.models.filter((model) => typeof model === 'string').slice(0, 1_000) : [],
    }
  } catch {
    try { storage.removeItem(SESSION_PROVIDER_STORAGE_KEY) } catch { /* storage may be blocked */ }
    return null
  }
}

export function saveSessionProvider(provider: Omit<SessionProviderCredential, 'id' | 'credentialMode'>, storage = browserStorage()) {
  if (!storage) throw new Error('sessionStorage غير متاح في هذا المتصفح')
  const value: SessionProviderCredential = { ...provider, id: 'session', credentialMode: 'session' }
  storage.setItem(SESSION_PROVIDER_STORAGE_KEY, JSON.stringify(value))
  notify()
  return value
}

export async function clearSessionData(storage = browserStorage()) {
  storage?.removeItem(SESSION_PROVIDER_STORAGE_KEY)
  await clearLocalChatData()
  notify()
}
