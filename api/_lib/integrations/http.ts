import { ApiError } from '../http.js'
import { redactText } from '../redaction.js'

const MAX_INTEGRATION_RESPONSE_BYTES = 1_000_000

export function integrationSignal(signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(15_000)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

export async function readIntegrationJson(response: Response) {
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > MAX_INTEGRATION_RESPONSE_BYTES) throw new ApiError(502, 'استجابة منصة التكامل أكبر من الحد الآمن', 'integration_response_too_large')
  const reader = response.body?.getReader()
  const decoder = new TextDecoder()
  let total = 0
  let text = ''
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > MAX_INTEGRATION_RESPONSE_BYTES) {
          await reader.cancel('integration response too large').catch(() => undefined)
          throw new ApiError(502, 'استجابة منصة التكامل أكبر من الحد الآمن', 'integration_response_too_large')
        }
        text += decoder.decode(value, { stream: true })
      }
      text += decoder.decode()
    } finally {
      reader.releaseLock()
    }
  }
  try { return text ? JSON.parse(text) as unknown : {} } catch { throw new ApiError(502, 'استجابة منصة التكامل غير صالحة', 'integration_response_invalid') }
}

export function upstreamMessage(payload: unknown, fallback: string, extraSecrets: string[] = []) {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const error = (payload as { error?: unknown }).error
    if (typeof error === 'object' && error && 'message' in error) return redactText(String((error as { message?: unknown }).message || fallback), extraSecrets)
  }
  if (payload && typeof payload === 'object' && 'message' in payload) return redactText(String((payload as { message?: unknown }).message || fallback), extraSecrets)
  return redactText(fallback, extraSecrets)
}
