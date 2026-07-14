import { getProviderRuntimeEnv } from '../env.js'
import { logTechnicalError, redactText } from '../redaction.js'
import { ProviderRequestError, type NormalizedProviderError, type ProviderProtocol } from './types.js'

export function sanitizeProviderEndpoint(value: string, extraSecrets: string[] = []) {
  try {
    const url = new URL(value)
    url.username = ''
    url.password = ''
    // Never expose query parameters in a diagnostic endpoint. Gemini keys are
    // sent in a header, and legacy URLs are stripped rather than echoed.
    url.search = ''
    url.hash = ''
    return redactText(url.toString().replace(/\/$/, ''), extraSecrets)
  } catch {
    return redactText(value.split('?')[0], extraSecrets).slice(0, 1_000)
  }
}

function responseRequestId(response: Response) {
  for (const name of ['x-request-id', 'request-id', 'cf-ray', 'x-amzn-requestid']) {
    const value = response.headers.get(name)
    if (value) return value
  }
  return undefined
}

function parseErrorPayload(payload: unknown, fallback: string) {
  const body = payload as any
  const error = body?.error ?? body
  return {
    message: redactText(String(error?.message || body?.message || fallback || 'استجابة خطأ بلا رسالة')),
    code: error?.code ? String(error.code) : (body?.status ? String(body.status) : undefined),
    type: error?.type ? String(error.type) : undefined,
  }
}

export async function providerFetch(url: string, init: RequestInit = {}, callerSignal?: AbortSignal) {
  const timeoutSignal = AbortSignal.timeout(getProviderRuntimeEnv().PROVIDER_TIMEOUT_MS)
  const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal
  try {
    return await fetch(url, { ...init, signal, redirect: 'error' })
  } catch (error: any) {
    if (callerSignal?.aborted) {
      throw new ProviderRequestError({ message: 'تم إيقاف الطلب', code: 'aborted', endpoint: sanitizeProviderEndpoint(url), causeName: error?.name })
    }
    if (timeoutSignal.aborted || error?.name === 'TimeoutError') {
      throw new ProviderRequestError({ message: 'انتهت مهلة اتصال المزود', code: 'timeout', endpoint: sanitizeProviderEndpoint(url), causeName: error?.name })
    }
    throw new ProviderRequestError({
      message: redactText(error?.message || 'تعذر الاتصال بالمزود'),
      code: error?.code || 'network_error',
      endpoint: sanitizeProviderEndpoint(url),
      causeName: error?.name,
    })
  }
}

export async function readLimitedText(response: Response) {
  const maxBytes = getProviderRuntimeEnv().PROVIDER_MAX_RESPONSE_BYTES
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > maxBytes) {
    throw new ProviderRequestError({ message: 'استجابة المزود أكبر من الحد الآمن', code: 'response_too_large', status: response.status, endpoint: sanitizeProviderEndpoint(response.url) })
  }
  if (!response.body) return ''

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let total = 0
  let result = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel('response too large').catch(() => undefined)
        throw new ProviderRequestError({ message: 'استجابة المزود تجاوزت الحد الآمن', code: 'response_too_large', status: response.status, endpoint: sanitizeProviderEndpoint(response.url) })
      }
      result += decoder.decode(value, { stream: true })
    }
    return result + decoder.decode()
  } finally {
    reader.releaseLock()
  }
}

export async function readProviderJson(response: Response, endpoint: string): Promise<any> {
  const text = await readLimitedText(response)
  let payload: unknown
  try {
    payload = text ? JSON.parse(text) : undefined
  } catch (error) {
    logTechnicalError('[provider-json-parse-failed]', error, { endpoint: sanitizeProviderEndpoint(endpoint), status: response.status })
    if (response.ok) {
      throw new ProviderRequestError({ message: 'أعاد المزود JSON غير صالح', code: 'invalid_provider_json', status: response.status, endpoint: sanitizeProviderEndpoint(endpoint) })
    }
  }

  if (!response.ok) {
    const parsed = parseErrorPayload(payload, text.slice(0, 1_200))
    throw new ProviderRequestError({ ...parsed, status: response.status, endpoint: sanitizeProviderEndpoint(endpoint), requestId: responseRequestId(response) })
  }
  return payload
}

export function extractModelIds(payload: any): string[] {
  const rows = Array.isArray(payload) ? payload
    : Array.isArray(payload?.data) ? payload.data
    : Array.isArray(payload?.models) ? payload.models
      : Array.isArray(payload?.items) ? payload.items
        : []
  const ids = rows
    .map((row: any) => String(row?.id || row?.name || row?.model || '').replace(/^models\//, '').trim())
    .filter((value: string) => Boolean(value) && value.length <= 300)
  return Array.from(new Set<string>(ids)).sort().slice(0, 1_000)
}

export async function* parseSseStream(response: Response, endpoint: string): AsyncGenerator<{ event?: string; data: string }> {
  if (!response.body) throw new ProviderRequestError({ message: 'المزود لم يُرجع بثًا', code: 'missing_stream', status: response.status, endpoint: sanitizeProviderEndpoint(endpoint) })
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const maxBytes = getProviderRuntimeEnv().PROVIDER_MAX_RESPONSE_BYTES
  let total = 0
  let buffer = ''

  const parseBlock = (block: string) => {
    let event: string | undefined
    const data: string[] = []
    for (const line of block.split(/\r\n|\r|\n/)) {
      if (!line || line.startsWith(':')) continue
      if (line.startsWith('event:')) event = line.slice(6).trim()
      if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
    }
    return data.length ? { event, data: data.join('\n') } : undefined
  }

  const nextBoundary = (value: string) => {
    const candidates = [
      { index: value.indexOf('\r\n\r\n'), length: 4 },
      { index: value.indexOf('\n\n'), length: 2 },
      { index: value.indexOf('\r\r'), length: 2 },
    ].filter((candidate) => candidate.index >= 0)
    return candidates.sort((left, right) => left.index - right.index)[0]
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) throw new ProviderRequestError({ message: 'تجاوز البث الحد الآمن', code: 'response_too_large', status: response.status, endpoint: sanitizeProviderEndpoint(endpoint) })
      // Keep raw line endings in the buffer. CRLF can itself be split across
      // network packets, so normalizing each packet independently is unsafe.
      buffer += decoder.decode(value, { stream: true })
      let boundary = nextBoundary(buffer)
      while (boundary) {
        const block = buffer.slice(0, boundary.index)
        buffer = buffer.slice(boundary.index + boundary.length)
        const parsed = parseBlock(block)
        if (parsed) yield parsed
        boundary = nextBoundary(buffer)
      }
    }
    buffer += decoder.decode()
    const parsed = parseBlock(buffer.trim())
    if (parsed) yield parsed
  } catch (error: any) {
    if (error instanceof ProviderRequestError) throw error
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      throw new ProviderRequestError({ message: 'انقطع بث المزود أو انتهت مهلته', code: 'stream_interrupted', status: response.status, endpoint: sanitizeProviderEndpoint(endpoint), causeName: error?.name })
    }
    throw new ProviderRequestError({ message: redactText(error?.message || 'انقطع بث المزود'), code: 'stream_interrupted', status: response.status, endpoint: sanitizeProviderEndpoint(endpoint), causeName: error?.name })
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

export function normalizeProviderError(error: unknown, protocol: ProviderProtocol, extraSecrets: string[] = []): NormalizedProviderError {
  if (error instanceof ProviderRequestError) return { ...error.details, message: redactText(error.details.message, extraSecrets), protocol }
  const candidate = error as { status?: unknown; code?: unknown; requestId?: unknown; endpoint?: unknown } | null
  return {
    message: redactText(error instanceof Error ? error.message : 'فشل غير معروف لدى المزود', extraSecrets),
    code: typeof candidate?.code === 'string' ? candidate.code : 'unknown_error',
    status: typeof candidate?.status === 'number' ? candidate.status : undefined,
    requestId: typeof candidate?.requestId === 'string' ? candidate.requestId : undefined,
    endpoint: typeof candidate?.endpoint === 'string' ? candidate.endpoint : undefined,
    causeName: error instanceof Error ? error.name : undefined,
    protocol,
  }
}

export function parseStreamJson(data: string, endpoint: string): any {
  try {
    return JSON.parse(data)
  } catch (error) {
    logTechnicalError('[provider-stream-json-parse-failed]', error, { endpoint: sanitizeProviderEndpoint(endpoint) })
    throw new ProviderRequestError({ message: 'أرسل المزود حدث بث JSON غير صالح', code: 'invalid_stream_json', endpoint: sanitizeProviderEndpoint(endpoint) })
  }
}
