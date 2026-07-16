import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import type { VercelRequest, VercelResponse } from './vercel.js'
import { ApiError } from './http.js'
import { getAdminClient } from './supabase.js'

export const API_SCOPES = [
  'account:read','models:read','chat:write','embeddings:write','images:write','audio:write',
  'telegram:read','telegram:send','telegram:webhook','whatsapp:read','whatsapp:send','whatsapp:templates',
  'workflows:read','workflows:execute','webhooks:read','webhooks:write','usage:read','logs:read',
  'api_keys:read','api_keys:write',
] as const

export type ApiScope = typeof API_SCOPES[number]

export interface ApiKeyContext {
  id: string
  userId: string
  workspaceId: string | null
  environment: 'live' | 'test'
  scopes: string[]
  allowedModels: string[]
  allowedServices: string[]
  rateLimitPerMinute: number
  dailyRequestLimit: number | null
  monthlyRequestLimit: number | null
}

function hashSecret(secret: string) {
  const pepper = process.env.API_KEY_HASH_SECRET || process.env.ENCRYPTION_KEY
  if (!pepper || pepper.length < 32) throw new Error('API_KEY_HASH_SECRET must be at least 32 characters')
  return createHmac('sha256', pepper).update(secret, 'utf8').digest('hex')
}

export function generateApiKey(environment: 'live' | 'test') {
  const raw = `mk_${environment}_${randomBytes(32).toString('base64url')}`
  const prefix = raw.slice(0, 18)
  return {
    raw,
    prefix,
    hash: hashSecret(raw),
    preview: `${raw.slice(0, 14)}••••••••••••${raw.slice(-4)}`,
  }
}

export function requestId(req: VercelRequest, res: VercelResponse) {
  const incoming = typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'].trim() : ''
  const value = /^req_[A-Za-z0-9_-]{8,100}$/.test(incoming) ? incoming : `req_${randomUUID().replace(/-/g, '')}`
  res.setHeader('X-Request-Id', value)
  return value
}

export function clientIp(req: VercelRequest) {
  const forwarded = req.headers['x-forwarded-for']
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded
  return (value?.split(',')[0]?.trim() || req.socket?.remoteAddress || '').replace(/^::ffff:/, '') || null
}

function bearer(req: VercelRequest) {
  const value = req.headers.authorization
  const match = typeof value === 'string' ? /^Bearer\s+(mk_(?:live|test)_[A-Za-z0-9_-]{32,})$/i.exec(value.trim()) : null
  if (!match) throw new ApiError(401, 'مفتاح API غير صالح', 'invalid_api_key')
  return match[1]
}

function safeHashEqual(left: string, right: string) {
  const a = Buffer.from(left, 'hex')
  const b = Buffer.from(right, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

function ipAllowed(ip: string | null, allowlist: unknown) {
  if (!Array.isArray(allowlist) || allowlist.length === 0) return true
  if (!ip) return false
  return allowlist.map(String).includes(ip)
}

export async function authenticateApiKey(req: VercelRequest): Promise<ApiKeyContext> {
  const raw = bearer(req)
  const suppliedHash = hashSecret(raw)
  const prefix = raw.slice(0, 18)
  const admin = getAdminClient()
  const { data, error } = await admin.from('api_keys')
    .select('id,user_id,workspace_id,environment,key_hash,scopes,allowed_models,allowed_services,allowed_ips,rate_limit_per_minute,daily_request_limit,monthly_request_limit,expires_at,revoked_at')
    .eq('key_prefix', prefix)
    .limit(10)
  if (error) throw new ApiError(503, 'تعذر التحقق من مفتاح API', 'api_key_service_unavailable')
  const row = (data || []).find((candidate: any) => safeHashEqual(String(candidate.key_hash), suppliedHash))
  if (!row) throw new ApiError(401, 'مفتاح API غير صالح', 'invalid_api_key')
  if (row.revoked_at) throw new ApiError(401, 'تم إلغاء مفتاح API', 'api_key_revoked')
  if (row.expires_at && Date.parse(row.expires_at) <= Date.now()) throw new ApiError(401, 'انتهت صلاحية مفتاح API', 'api_key_expired')
  const environment = raw.startsWith('mk_test_') ? 'test' : 'live'
  if (row.environment !== environment) throw new ApiError(401, 'بيئة مفتاح API غير متطابقة', 'invalid_api_key')
  const ip = clientIp(req)
  if (!ipAllowed(ip, row.allowed_ips)) throw new ApiError(403, 'عنوان IP غير مسموح لهذا المفتاح', 'ip_not_allowed')
  void admin.from('api_keys').update({ last_used_at: new Date().toISOString(), last_used_ip: ip }).eq('id', row.id)
  return {
    id: row.id,
    userId: row.user_id,
    workspaceId: row.workspace_id,
    environment,
    scopes: Array.isArray(row.scopes) ? row.scopes : [],
    allowedModels: Array.isArray(row.allowed_models) ? row.allowed_models : [],
    allowedServices: Array.isArray(row.allowed_services) ? row.allowed_services : [],
    rateLimitPerMinute: Number(row.rate_limit_per_minute || 60),
    dailyRequestLimit: row.daily_request_limit == null ? null : Number(row.daily_request_limit),
    monthlyRequestLimit: row.monthly_request_limit == null ? null : Number(row.monthly_request_limit),
  }
}

export function requireScope(context: ApiKeyContext, scope: ApiScope) {
  if (!context.scopes.includes(scope)) throw new ApiError(403, `المفتاح لا يمتلك صلاحية ${scope}`, 'insufficient_scope')
}

export function assertModelAllowed(context: ApiKeyContext, model: string) {
  if (context.allowedModels.length && !context.allowedModels.includes(model)) throw new ApiError(403, 'النموذج غير مسموح لهذا المفتاح', 'model_not_allowed')
}

export async function writeApiUsage(input: {
  context: ApiKeyContext
  requestId: string
  endpoint: string
  method: string
  statusCode: number
  service?: string
  model?: string
  latencyMs?: number
  providerLatencyMs?: number
  inputTokens?: number
  outputTokens?: number
  errorCode?: string
  safeErrorMessage?: string
  req: VercelRequest
}) {
  const admin = getAdminClient()
  await admin.from('api_usage_logs').insert({
    api_key_id: input.context.id,
    user_id: input.context.userId,
    workspace_id: input.context.workspaceId,
    request_id: input.requestId,
    endpoint: input.endpoint,
    method: input.method,
    service: input.service || null,
    model: input.model || null,
    status_code: input.statusCode,
    input_tokens: input.inputTokens || 0,
    output_tokens: input.outputTokens || 0,
    total_tokens: (input.inputTokens || 0) + (input.outputTokens || 0),
    latency_ms: input.latencyMs || null,
    provider_latency_ms: input.providerLatencyMs || null,
    ip_address: clientIp(input.req),
    user_agent: String(input.req.headers['user-agent'] || '').slice(0, 500) || null,
    error_code: input.errorCode || null,
    safe_error_message: input.safeErrorMessage?.slice(0, 500) || null,
  })
}
