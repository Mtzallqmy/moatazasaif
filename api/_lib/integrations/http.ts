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
  const text = await response.text()
  if (Buffer.byteLength(text) > MAX_INTEGRATION_RESPONSE_BYTES) throw new ApiError(502, 'استجابة منصة التكامل أكبر من الحد الآمن', 'integration_response_too_large')
  try { return text ? JSON.parse(text) as unknown : {} } catch { throw new ApiError(502, 'استجابة منصة التكامل غير صالحة', 'integration_response_invalid') }
}

export function upstreamMessage(payload: unknown, fallback: string) {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const error = (payload as { error?: unknown }).error
    if (typeof error === 'object' && error && 'message' in error) return redactText(String((error as { message?: unknown }).message || fallback))
  }
  if (payload && typeof payload === 'object' && 'message' in payload) return redactText(String((payload as { message?: unknown }).message || fallback))
  return fallback
}
