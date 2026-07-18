import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getProviderRuntimeEnv } from './env.js'
import { ApiError } from './http.js'
import { logTechnicalError, redactText, redactUnknown } from './redaction.js'
import { ProviderRequestError, type ProviderChatMessage } from './providers/types.js'
import { providerDiagnostic, testProviderConnection, type ProviderDiagnostic, type ProviderFailureCategory, type ProviderRecord } from './provider-runtime.js'
import { loadOwnedProviderCredentials } from './provider-credentials.js'

export type ProviderHealthStatus = 'healthy' | 'degraded' | 'offline' | 'unknown'
export type ProviderCircuitState = 'closed' | 'open' | 'half_open'

export interface ProviderManagerRecord extends ProviderRecord {
  manager_schema_ready: boolean
  is_enabled: boolean
  models: string[]
  priority: number
  timeout_ms: number
  retries: number
  max_connections: number
  health_status: ProviderHealthStatus
  latency_ms: number | null
  last_check_at: string | null
  error_count: number
  success_count: number
  availability: number
  last_error_code: string | null
  last_error_message: string | null
  circuit_state: ProviderCircuitState
  circuit_failures: number
  circuit_opened_at: string | null
  circuit_next_retry_at: string | null
  tags: string[]
  capabilities: Record<string, boolean>
}

export interface ProviderManagerSnapshot {
  id: string
  name: string
  type: string
  protocol: ProviderRecord['protocol']
  baseUrl?: string
  model?: string
  models: string[]
  enabled: boolean
  priority: number
  timeout: number
  retries: number
  maxConnections: number
  healthStatus: ProviderHealthStatus
  latency: number | null
  lastCheck: string | null
  errorCount: number
  successCount: number
  availability: number
  lastError?: { code?: string; message?: string }
  circuit: { state: ProviderCircuitState; failures: number; nextRetryAt?: string }
  workerStatus: 'online' | 'offline' | 'disabled'
  queueSize: number
  tags: string[]
  capabilities: Record<string, boolean>
}

export interface ProviderOutcome {
  success: boolean
  latencyMs: number
  diagnostic?: ProviderDiagnostic
  requestId?: string
  model?: string
}

const CIRCUIT_FAILURE_THRESHOLD = 3
const CIRCUIT_COOLDOWN_MS = 60_000

export function providerHealthStatus(input: { success: boolean; latencyMs: number; category?: ProviderFailureCategory }): ProviderHealthStatus {
  if (!input.success) return input.category === 'authentication' || input.category === 'authorization' || input.category === 'validation' ? 'degraded' : 'offline'
  if (input.latencyMs >= 10_000) return 'degraded'
  return 'healthy'
}

export function isCircuitAvailable(provider: Pick<ProviderManagerRecord, 'circuit_state' | 'circuit_next_retry_at' | 'is_enabled'>) {
  if (provider.is_enabled === false) return false
  if (provider.circuit_state !== 'open') return true
  return Boolean(provider.circuit_next_retry_at && Date.parse(provider.circuit_next_retry_at) <= Date.now())
}

export function circuitTransition(current: Pick<ProviderManagerRecord, 'circuit_state' | 'circuit_failures'>, success: boolean, now = Date.now()) {
  if (success) return { state: 'closed' as const, failures: 0, openedAt: null, nextRetryAt: null }
  const failures = Math.max(0, current.circuit_failures || 0) + 1
  if (current.circuit_state === 'half_open' || failures >= CIRCUIT_FAILURE_THRESHOLD) {
    const openedAt = new Date(now).toISOString()
    return { state: 'open' as const, failures, openedAt, nextRetryAt: new Date(now + CIRCUIT_COOLDOWN_MS).toISOString() }
  }
  return { state: current.circuit_state === 'open' ? 'open' as const : 'closed' as const, failures, openedAt: null, nextRetryAt: null }
}

export function retryDelay(attempt: number, baseMs = 250, maxMs = 4_000) {
  const exponential = Math.min(maxMs, baseMs * (2 ** Math.max(0, attempt)))
  // Small deterministic jitter avoids synchronized retries without making tests flaky.
  return Math.round(exponential * (0.8 + ((attempt * 17) % 20) / 100))
}

export function isRetryableProviderError(error: unknown) {
  if (error instanceof ProviderRequestError) {
    if (error.details.code === 'aborted') return false
    const status = error.details.status
    return !status || status === 408 || status === 429 || status === 502 || status === 503 || status === 504
  }
  if (error instanceof Error) return error.name === 'AbortError' || /timeout|network|fetch failed|socket|econn/i.test(error.message)
  return false
}

export function providerTimeoutMs(value?: number) {
  const fallback = getProviderRuntimeEnv().PROVIDER_TIMEOUT_MS
  const timeout = Number.isFinite(value) ? Number(value) : fallback
  return Math.max(5_000, Math.min(45_000, Math.round(timeout)))
}

function providerAttemptSignal(parent: AbortSignal | undefined, timeoutMs: number) {
  const timeout = AbortSignal.timeout(providerTimeoutMs(timeoutMs))
  return parent ? AbortSignal.any([parent, timeout]) : timeout
}

async function waitForRetry(delayMs: number, signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason || new DOMException('تم إيقاف الطلب', 'AbortError')
  await new Promise<void>((resolve, reject) => {
    const done = () => {
      signal?.removeEventListener('abort', aborted)
      resolve()
    }
    const aborted = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', aborted)
      reject(signal?.reason || new DOMException('تم إيقاف الطلب', 'AbortError'))
    }
    const timer = setTimeout(done, delayMs)
    signal?.addEventListener('abort', aborted, { once: true })
  })
}

export async function withProviderRetry<T>(operation: (signal: AbortSignal) => Promise<T>, options: { retries?: number; signal?: AbortSignal; timeoutMs?: number } = {}) {
  const retries = Math.max(0, Math.min(5, options.retries ?? 2))
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (options.signal?.aborted) throw options.signal.reason || new DOMException('تم إيقاف الطلب', 'AbortError')
    try {
      return await operation(providerAttemptSignal(options.signal, providerTimeoutMs(options.timeoutMs)))
    } catch (error) {
      lastError = error
      if (attempt >= retries || !isRetryableProviderError(error)) throw error
      await waitForRetry(retryDelay(attempt), options.signal)
    }
  }
  throw lastError || new Error('provider_retry_failed')
}

export function selectProviderCandidates<T extends Pick<ProviderManagerRecord, 'id' | 'model' | 'models' | 'priority' | 'health_status' | 'circuit_state' | 'circuit_next_retry_at' | 'is_enabled'> & Partial<Pick<ProviderManagerRecord, 'availability' | 'latency_ms'>>>(providers: T[], requestedModel?: string) {
  const model = requestedModel?.trim().toLowerCase()
  return providers
    .filter((provider) => isCircuitAvailable(provider))
    .filter((provider) => !model || provider.model?.toLowerCase() === model || provider.models.some((candidate) => candidate.toLowerCase() === model) || provider.models.length === 0)
    .sort((left, right) => {
      const healthRank = (value: ProviderHealthStatus) => value === 'healthy' ? 0 : value === 'unknown' ? 1 : value === 'degraded' ? 2 : 3
      const circuitRank = (value: ProviderCircuitState) => value === 'closed' ? 0 : value === 'half_open' ? 1 : 2
      return healthRank(left.health_status) - healthRank(right.health_status)
        || circuitRank(left.circuit_state) - circuitRank(right.circuit_state)
        || left.priority - right.priority
        || (right.availability ?? -1) - (left.availability ?? -1)
        || (left.latency_ms ?? Number.MAX_SAFE_INTEGER) - (right.latency_ms ?? Number.MAX_SAFE_INTEGER)
    })
}

function managerRecord(row: Record<string, unknown>): ProviderManagerRecord {
  return {
    id: String(row.id),
    name: typeof row.name === 'string' ? row.name : undefined,
    type: String(row.type),
    protocol: typeof row.protocol === 'string' ? row.protocol as ProviderRecord['protocol'] : null,
    base_url: typeof row.base_url === 'string' ? row.base_url : null,
    model: typeof row.model === 'string' ? row.model : null,
    encrypted_key: row.encrypted_key,
    manager_schema_ready: Object.prototype.hasOwnProperty.call(row, 'availability'),
    is_enabled: row.is_enabled !== false,
    models: Array.isArray(row.models) ? row.models.filter((model): model is string => typeof model === 'string') : [],
    priority: Number(row.priority ?? 100),
    timeout_ms: Number(row.timeout_ms ?? 35_000),
    retries: Number(row.retries ?? 2),
    max_connections: Number(row.max_connections ?? 4),
    health_status: (row.health_status || 'unknown') as ProviderHealthStatus,
    latency_ms: row.latency_ms == null ? null : Number(row.latency_ms),
    last_check_at: typeof row.last_check_at === 'string' ? row.last_check_at : null,
    error_count: Number(row.error_count ?? 0),
    success_count: Number(row.success_count ?? 0),
    availability: Number(row.availability ?? 1),
    last_error_code: typeof row.last_error_code === 'string' ? row.last_error_code : null,
    last_error_message: typeof row.last_error_message === 'string' ? row.last_error_message : null,
    circuit_state: (row.circuit_state || 'closed') as ProviderCircuitState,
    circuit_failures: Number(row.circuit_failures ?? 0),
    circuit_opened_at: typeof row.circuit_opened_at === 'string' ? row.circuit_opened_at : null,
    circuit_next_retry_at: typeof row.circuit_next_retry_at === 'string' ? row.circuit_next_retry_at : null,
    tags: Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === 'string').slice(0, 50) : [],
    capabilities: typeof row.capabilities === 'object' && row.capabilities !== null ? Object.fromEntries(Object.entries(row.capabilities).filter(([, value]) => typeof value === 'boolean')) : {},
  }
}

const MANAGER_SELECT = 'id,name,type,protocol,base_url,model,encrypted_key,is_enabled,models,priority,timeout_ms,retries,max_connections,health_status,latency_ms,last_check_at,error_count,success_count,availability,last_error_code,last_error_message,circuit_state,circuit_failures,circuit_opened_at,circuit_next_retry_at,tags,capabilities'
const LEGACY_MANAGER_SELECT = 'id,name,type,protocol,base_url,model,encrypted_key,is_enabled,models'

export async function loadManagerProviders(admin: SupabaseClient, userId: string, providerId?: string) {
  let query = admin.from('providers').select(MANAGER_SELECT).eq('user_id', userId)
  if (providerId) query = query.eq('id', providerId)
  const initial = await query.order('priority', { ascending: true })
  let data = initial.data as Array<Record<string, unknown>> | null
  let error = initial.error
  if (error && /column|schema cache/i.test(error.message || '')) {
    let fallback = admin.from('providers').select(LEGACY_MANAGER_SELECT).eq('user_id', userId)
    if (providerId) fallback = fallback.eq('id', providerId)
    const fallbackResult = await fallback.order('created_at', { ascending: false })
    data = fallbackResult.data as Array<Record<string, unknown>> | null
    error = fallbackResult.error
  }
  if (error) throw new ApiError(500, 'تعذر تحميل حالة المزودات', 'provider_manager_read_failed')
  return (data || []).map((row) => managerRecord(row as Record<string, unknown>))
}

export function publicManagerProvider(provider: ProviderManagerRecord): ProviderManagerSnapshot {
  const models = Array.isArray(provider.models) ? provider.models.filter((model): model is string => typeof model === 'string') : []
  return {
    id: provider.id,
    name: provider.name || provider.type,
    type: provider.type,
    protocol: provider.protocol,
    baseUrl: provider.base_url || undefined,
    model: provider.model || undefined,
    models,
    enabled: provider.is_enabled !== false,
    priority: provider.priority,
    timeout: provider.timeout_ms,
    retries: provider.retries,
    maxConnections: provider.max_connections,
    healthStatus: provider.health_status,
    latency: provider.latency_ms,
    lastCheck: provider.last_check_at,
    errorCount: provider.error_count,
    successCount: provider.success_count,
    availability: provider.availability,
    lastError: provider.last_error_code || provider.last_error_message ? { code: provider.last_error_code || undefined, message: provider.last_error_message || undefined } : undefined,
    circuit: { state: provider.circuit_state, failures: provider.circuit_failures, nextRetryAt: provider.circuit_next_retry_at || undefined },
    workerStatus: provider.is_enabled === false ? 'disabled' : provider.health_status === 'offline' ? 'offline' : 'online',
    queueSize: 0,
    tags: provider.tags,
    capabilities: provider.capabilities,
  }
}

export async function recordProviderOutcome(admin: SupabaseClient, providerId: string, userId: string, outcome: ProviderOutcome) {
  const current = (await loadManagerProviders(admin, userId, providerId))[0]
  if (!current) throw new ApiError(404, 'المزود غير موجود', 'provider_not_found')
  const transition = circuitTransition(current, outcome.success)
  const nextSuccess = outcome.success ? current.success_count + 1 : current.success_count
  const nextErrors = outcome.success ? current.error_count : current.error_count + 1
  const total = nextSuccess + nextErrors
  const availability = total ? Math.max(0, Math.min(1, nextSuccess / total)) : 1
  const diagnostic = outcome.diagnostic
  const now = new Date().toISOString()
  const update = {
    health_status: outcome.success ? providerHealthStatus({ success: true, latencyMs: outcome.latencyMs }) : providerHealthStatus({ success: false, latencyMs: outcome.latencyMs, category: diagnostic?.category }),
    latency_ms: Math.max(0, Math.round(outcome.latencyMs)),
    last_check_at: now,
    error_count: nextErrors,
    success_count: nextSuccess,
    availability,
    last_error_code: outcome.success ? null : diagnostic?.code || 'provider_request_failed',
    last_error_message: outcome.success ? null : redactText(diagnostic?.providerMessage || diagnostic?.message || 'فشل طلب المزود'),
    circuit_state: transition.state,
    circuit_failures: transition.failures,
    circuit_opened_at: transition.openedAt,
    circuit_next_retry_at: transition.nextRetryAt,
    status: outcome.success ? 'connected' : 'error',
    last_tested_at: now,
    error_message: outcome.success ? null : redactText(diagnostic?.providerMessage || diagnostic?.message || 'فشل طلب المزود'),
    diagnostic: diagnostic ? redactUnknown(diagnostic) : null,
    updated_at: now,
  }
  const persistedUpdate = current.manager_schema_ready ? update : {
    status: update.status,
    last_tested_at: update.last_tested_at,
    error_message: update.error_message,
    diagnostic: update.diagnostic,
    updated_at: update.updated_at,
  }
  const { error } = await admin.from('providers').update(persistedUpdate).eq('id', providerId).eq('user_id', userId)
  if (error) logTechnicalError('[provider-manager-state-save-failed]', error, { providerId, userId })
  if (current.manager_schema_ready) {
    const requestId = outcome.requestId || randomUUID()
    const { error: logError } = await admin.from('provider_manager_logs').insert({
      provider_id: providerId,
      user_id: userId,
      model: outcome.model || null,
      request_id: requestId,
      status_code: diagnostic?.httpStatus || null,
      category: diagnostic?.category || (outcome.success ? 'success' : 'unknown'),
      code: diagnostic?.code || (outcome.success ? 'ok' : 'provider_request_failed'),
      message: redactText(diagnostic?.providerMessage || diagnostic?.message || (outcome.success ? 'نجح الطلب' : 'فشل الطلب')),
      duration_ms: Math.max(0, Math.round(outcome.latencyMs)),
      metadata: { protocol: diagnostic?.detectedProtocol, healthStatus: update.health_status, circuitState: transition.state },
    })
    if (logError) logTechnicalError('[provider-manager-log-save-failed]', logError, { providerId, userId })
  }
  return { ...current, ...update, availability, error_count: nextErrors, success_count: nextSuccess } as ProviderManagerRecord
}

export async function runProviderHealthCheck(admin: SupabaseClient, userId: string, providerId: string) {
  const resolved = await loadOwnedProviderCredentials(admin, userId, providerId)
  const startedAt = Date.now()
  const diagnostic = await testProviderConnection(resolved.provider, resolved.apiKey)
  const result = await recordProviderOutcome(admin, providerId, userId, { success: diagnostic.success, latencyMs: Date.now() - startedAt, diagnostic, model: diagnostic.testedModel })
  return { diagnostic, provider: publicManagerProvider(result) }
}

export async function runScheduledProviderHealthChecks(admin: SupabaseClient, limit = 50) {
  const initial = await admin.from('providers').select('id,user_id').eq('is_enabled', true).order('last_check_at', { ascending: true, nullsFirst: true }).limit(limit)
  let data = initial.data
  let error = initial.error
  if (error && /column|schema cache/i.test(error.message || '')) {
    const legacy = await admin.from('providers').select('id,user_id').eq('is_enabled', true).order('created_at', { ascending: true }).limit(limit)
    data = legacy.data
    error = legacy.error
  }
  if (error) throw new ApiError(500, 'تعذر تحميل قائمة فحص المزودات', 'provider_health_queue_failed')
  let healthy = 0
  let failed = 0
  for (const row of data || []) {
    try {
      const result = await runProviderHealthCheck(admin, String(row.user_id), String(row.id))
      if (result.diagnostic.success) healthy += 1
      else failed += 1
    } catch (healthError) {
      failed += 1
      logTechnicalError('[scheduled-provider-health-failed]', healthError, { providerId: row.id, userId: row.user_id })
    }
  }
  return { checked: (data || []).length, healthy, failed }
}

export async function runProviderRetry<T>(provider: ProviderManagerRecord, operation: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal) {
  return withProviderRetry(operation, { retries: provider.retries, signal, timeoutMs: provider.timeout_ms })
}

export async function* streamProviderRetry<T>(provider: ProviderManagerRecord, operation: (signal: AbortSignal) => AsyncGenerator<T>, signal?: AbortSignal) {
  let lastError: unknown
  const retries = Math.max(0, Math.min(5, provider.retries ?? 2))
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (signal?.aborted) throw signal.reason || new DOMException('تم إيقاف الطلب', 'AbortError')
    let yielded = false
    try {
      for await (const event of operation(providerAttemptSignal(signal, provider.timeout_ms))) { yielded = true; yield event }
      return
    } catch (error) {
      lastError = error
      if (yielded || attempt >= retries || !isRetryableProviderError(error)) throw error
      await waitForRetry(retryDelay(attempt), signal)
    }
  }
  throw lastError || new Error('provider_stream_retry_failed')
}

export function shouldFailOverProviderStream(input: { savedCredentials: boolean; sentProviderOutput: boolean; sentDone: boolean }) {
  return input.savedCredentials && !input.sentProviderOutput && !input.sentDone
}

export function managerRequestMessages(messages: ProviderChatMessage[]) {
  return messages.map((message) => ({ role: message.role, contentLength: message.content.length, attachments: message.attachments?.length || 0 }))
}

export function managerErrorDiagnostic(error: unknown, provider: ProviderRecord, startedAt: number, apiKey: string) {
  return providerDiagnostic(error, provider.protocol || 'openai-compatible', startedAt, [apiKey])
}

export function providerManagerRuntimeConfig() {
  return { timeoutMs: getProviderRuntimeEnv().PROVIDER_TIMEOUT_MS, circuitFailureThreshold: CIRCUIT_FAILURE_THRESHOLD, circuitCooldownMs: CIRCUIT_COOLDOWN_MS }
}
