import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { getProviderDefinition, resolveProviderBaseUrl, resolveProviderProtocol, type ProviderProtocol } from '../../shared/provider-registry'
import { getProviderRuntimeEnv } from './env'
import { ApiError } from './http'
import { redactText } from './redaction'
import { anthropicAdapter } from './providers/anthropic'
import { geminiAdapter } from './providers/gemini'
import { normalizeProviderError, sanitizeProviderEndpoint } from './providers/http'
import { openAiCompatibleAdapter } from './providers/openai-compatible'
import type { NormalizedProviderError, ProviderAdapter, ProviderChatMessage, ProviderConfig, ProviderStreamEvent } from './providers/types'

export type { ProviderProtocol, ProviderStreamEvent }
export type ChatMessage = ProviderChatMessage

export type ProviderFailureCategory =
  | 'authentication'
  | 'authorization'
  | 'rate_limit'
  | 'quota'
  | 'model'
  | 'endpoint'
  | 'validation'
  | 'network'
  | 'timeout'
  | 'upstream'
  | 'unknown'

export interface ProviderRecord {
  id: string
  name?: string
  type: string
  protocol?: ProviderProtocol | null
  base_url: string | null
  model: string | null
  encrypted_key?: unknown
}

export interface ProviderDiagnostic {
  success: boolean
  detectedProtocol: ProviderProtocol
  models: string[]
  testedModel?: string
  endpoint?: string
  latencyMs: number
  httpStatus?: number
  category?: ProviderFailureCategory
  code?: string
  message: string
  providerMessage?: string
  requestId?: string
  hint?: string
  warning?: string
}

const adapters: Record<ProviderProtocol, ProviderAdapter> = {
  'openai-compatible': openAiCompatibleAdapter,
  gemini: geminiAdapter,
  anthropic: anthropicAdapter,
}

export function inferProtocol(type: string, baseUrl?: string | null, explicitProtocol?: ProviderProtocol | null): ProviderProtocol {
  return resolveProviderProtocol(type, explicitProtocol, baseUrl)
}

export function providerBaseUrl(provider: Pick<ProviderRecord, 'type' | 'base_url'>) {
  const baseUrl = resolveProviderBaseUrl(provider.type, provider.base_url)
  if (!baseUrl) throw new ApiError(400, 'هذا المزود يحتاج Base URL', 'provider_base_url_required')
  return baseUrl
}

export function isPrivateIpAddress(address: string) {
  const normalized = address.toLowerCase().replace(/^::ffff:/, '')
  const ipv4Private = (value: string) => {
    const parts = value.split('.').map(Number)
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
    return parts[0] === 0
      || parts[0] === 10
      || parts[0] === 127
      || (parts[0] === 169 && parts[1] === 254)
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168)
      || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
  }
  if (isIP(normalized) === 4) return ipv4Private(normalized)
  if (isIP(normalized) !== 6) return false

  // Expand IPv6 (including an embedded IPv4 tail) and classify loopback,
  // unspecified, link-local, unique-local, multicast, and IPv4-mapped ranges.
  const ipv4Tail = normalized.includes('.') ? normalized.slice(normalized.lastIndexOf(':') + 1) : undefined
  let value = normalized
  if (ipv4Tail && ipv4Private(ipv4Tail)) return true
  if (ipv4Tail) {
    const octets = ipv4Tail.split('.').map(Number)
    value = `${normalized.slice(0, normalized.lastIndexOf(':'))}:${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`
  }
  const [leftRaw, rightRaw, ...extra] = value.split('::')
  if (extra.length) return false
  const left = leftRaw ? leftRaw.split(':').filter(Boolean) : []
  const right = rightRaw ? rightRaw.split(':').filter(Boolean) : []
  const missing = 8 - left.length - right.length
  if (missing < 0) return false
  const groups = [...left, ...Array.from({ length: missing }, () => '0'), ...right]
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return false
  const number = groups.reduce((result, group) => (result << 16n) | BigInt(parseInt(group, 16)), 0n)
  if (number === 0n || number === 1n) return true
  if ((number >> 121n) === 0b1111110n) return true // fc00::/7
  if ((number >> 118n) === 0b1111111010n) return true // fe80::/10
  if ((number >> 120n) === 0xffn) return true // multicast
  if ((number >> 32n) === 0xffffn) {
    const mapped = Number(number & 0xffffffffn)
    return ipv4Private(`${mapped >>> 24}.${(mapped >>> 16) & 255}.${(mapped >>> 8) & 255}.${mapped & 255}`)
  }
  return false
}

export async function assertSafeProviderUrl(urlValue: string) {
  let url: URL
  try { url = new URL(urlValue) } catch { throw new ApiError(400, 'Base URL غير صالح', 'invalid_provider_url') }
  const env = getProviderRuntimeEnv()
  const strictNetworkPolicy = env.NODE_ENV === 'production' || !env.ALLOW_INSECURE_PROVIDER_URLS

  if (url.username || url.password || url.search || url.hash) {
    throw new ApiError(400, 'Base URL يجب ألا يحتوي بيانات دخول أو query parameters أو fragment', 'provider_url_components_forbidden')
  }
  if (!['https:', 'http:'].includes(url.protocol)) throw new ApiError(400, 'يسمح فقط بروابط HTTP/HTTPS', 'invalid_provider_protocol')
  if (url.protocol !== 'https:' && strictNetworkPolicy) {
    throw new ApiError(400, 'يجب استخدام HTTPS. يسمح بـ HTTP محليًا فقط مع ALLOW_INSECURE_PROVIDER_URLS=true وخارج الإنتاج.', 'https_required')
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  const knownPrivateHost = host === 'localhost' || host.endsWith('.local') || host === 'metadata.google.internal'
  if (strictNetworkPolicy && (knownPrivateHost || (isIP(host) && isPrivateIpAddress(host)))) {
    throw new ApiError(400, 'عنوان المزود يشير إلى شبكة داخلية وغير مسموح به', 'private_provider_host')
  }
  if (!strictNetworkPolicy && knownPrivateHost) return

  try {
    const addresses = await lookup(host, { all: true, verbatim: true })
    if (strictNetworkPolicy && addresses.some((item) => isPrivateIpAddress(item.address))) {
      throw new ApiError(400, 'عنوان المزود يتحول إلى شبكة داخلية وغير مسموح به', 'private_provider_host')
    }
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(400, 'تعذر حل اسم نطاق المزود عبر DNS', 'provider_dns_failed')
  }
}

export { sanitizeProviderEndpoint }

function providerConfig(provider: ProviderRecord, apiKey: string): ProviderConfig {
  const protocol = inferProtocol(provider.type, provider.base_url, provider.protocol)
  return {
    type: provider.type,
    name: provider.name,
    protocol,
    baseUrl: providerBaseUrl(provider),
    apiKey,
    model: provider.model || undefined,
  }
}

function adapterFor(protocol: ProviderProtocol) {
  return adapters[protocol]
}

export function classifyProviderError(error: NormalizedProviderError): Pick<ProviderDiagnostic, 'category' | 'code' | 'hint'> {
  const status = error.status
  const code = (error.code || error.type || '').toLowerCase()
  const message = error.message.toLowerCase()

  if (code.includes('provider_url') || code.includes('private_provider') || code === 'https_required' || code === 'invalid_provider_protocol' || code === 'provider_dns_failed') {
    return { category: 'endpoint', code: error.code || 'invalid_provider_url', hint: 'تحقق من Base URL واستخدم HTTPS عامًا لا يشير إلى localhost أو شبكة داخلية.' }
  }
  if (code.includes('timeout') || code === 'stream_interrupted' || status === 408 || status === 504) return { category: 'timeout', code: error.code || 'timeout', hint: 'تحقق من سرعة المزود أو ارفع PROVIDER_TIMEOUT_MS ضمن مدة Vercel Function.' }
  if (code === 'aborted') return { category: 'network', code, hint: 'تم إيقاف الطلب من المستخدم.' }
  if (!status) return { category: 'network', code: error.code || 'network_error', hint: 'تحقق من Base URL وDNS وشهادة TLS واتصال المزود.' }
  if (status === 401) return { category: 'authentication', code: error.code || 'unauthorized', hint: 'المفتاح غير صحيح أو منتهي أو أُرسل إلى بوابة غير مناسبة.' }
  if (status === 403) return { category: 'authorization', code: error.code || 'forbidden', hint: 'المفتاح لا يملك الإذن المطلوب للنموذج أو المؤسسة أو البوابة.' }
  if (status === 429 && (code.includes('quota') || message.includes('quota') || message.includes('credit') || message.includes('billing') || message.includes('balance'))) {
    return { category: 'quota', code: error.code || 'quota_exceeded', hint: 'راجع الرصيد أو الحصة وحدود الفوترة لدى المزود.' }
  }
  if (status === 429) return { category: 'rate_limit', code: error.code || 'rate_limited', hint: 'تم تجاوز حد الطلبات؛ انتظر ثم أعد المحاولة.' }
  if (status === 404 && (message.includes('model') || code.includes('model'))) return { category: 'model', code: error.code || 'model_not_found', hint: 'اختر نموذجًا موجودًا ومتاحًا لهذا المفتاح.' }
  if ([404, 405].includes(status)) return { category: 'endpoint', code: error.code || 'endpoint_not_found', hint: 'تحقق من Base URL والبروتوكول؛ قد يلزم أن ينتهي الرابط بـ /v1.' }
  if ([400, 409, 422].includes(status)) return { category: 'validation', code: error.code || 'invalid_request', hint: 'رفض المزود صيغة الطلب أو اسم النموذج؛ راجع رسالته الأصلية.' }
  if (status >= 500) return { category: 'upstream', code: error.code || 'provider_error', hint: 'الخطأ صادر من خادم المزود؛ أعد المحاولة أو راجع حالة خدمته.' }
  return { category: 'unknown', code: error.code || 'provider_error', hint: 'راجع رسالة المزود والبوابة المستخدمة.' }
}

export function providerDiagnostic(error: unknown, protocol: ProviderProtocol, startedAt: number, extraSecrets: string[] = []): ProviderDiagnostic {
  const normalized = normalizeProviderError(error, protocol, extraSecrets)
  const classified = classifyProviderError(normalized)
  return {
    success: false,
    detectedProtocol: protocol,
    models: [],
    latencyMs: Date.now() - startedAt,
    httpStatus: normalized.status,
    endpoint: normalized.endpoint ? sanitizeProviderEndpoint(normalized.endpoint, extraSecrets) : undefined,
    requestId: normalized.requestId ? redactText(normalized.requestId, extraSecrets) : undefined,
    message: 'فشل اختبار المزود',
    providerMessage: redactText(normalized.message, extraSecrets),
    ...classified,
    code: classified.code ? redactText(classified.code, extraSecrets) : undefined,
    hint: classified.hint ? redactText(classified.hint, extraSecrets) : undefined,
  }
}

export async function discoverProviderModels(provider: ProviderRecord, apiKey: string, signal?: AbortSignal) {
  const config = providerConfig(provider, apiKey)
  await assertSafeProviderUrl(config.baseUrl)
  const adapter = adapterFor(config.protocol)
  const result = await adapter.listModels(config, signal)
  return { ...result, protocol: config.protocol }
}

export async function testProviderConnection(provider: ProviderRecord, apiKey: string, signal?: AbortSignal): Promise<ProviderDiagnostic> {
  const startedAt = Date.now()
  const config = providerConfig(provider, apiKey)
  try {
    if (!getProviderDefinition(provider.type)) throw new ApiError(400, 'نوع المزود غير مدعوم', 'unsupported_provider_type')
    await assertSafeProviderUrl(config.baseUrl)
    const result = await adapterFor(config.protocol).testConnection(config, signal)
    return {
      success: true,
      detectedProtocol: config.protocol,
      models: result.models.map((model) => redactText(model, [apiKey], 1_000)),
      testedModel: result.testedModel ? redactText(result.testedModel, [apiKey], 1_000) : undefined,
      endpoint: sanitizeProviderEndpoint(result.endpoint, [apiKey]),
      latencyMs: Date.now() - startedAt,
      httpStatus: result.httpStatus,
      message: result.testedModel
        ? 'نجح طلب توليد فعلي باستخدام النموذج المحدد'
        : `تم الاتصال واكتشاف ${result.models.length} نموذجًا فعليًا`,
      warning: result.warning,
    }
  } catch (error) {
    return providerDiagnostic(error, config.protocol, startedAt, [apiKey])
  }
}

export async function generateProviderText(provider: ProviderRecord, apiKey: string, model: string, messages: ProviderChatMessage[], signal?: AbortSignal) {
  const config = providerConfig(provider, apiKey)
  await assertSafeProviderUrl(config.baseUrl)
  const result = await adapterFor(config.protocol).generateText(config, model, messages, signal)
  return { ...result, tokens: result.usage.totalTokens }
}

export async function* streamProviderText(provider: ProviderRecord, apiKey: string, model: string, messages: ProviderChatMessage[], signal?: AbortSignal) {
  const config = providerConfig(provider, apiKey)
  await assertSafeProviderUrl(config.baseUrl)
  yield* adapterFor(config.protocol).streamText(config, model, messages, signal)
}
