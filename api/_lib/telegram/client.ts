import { getTelegramRuntimeEnv } from '../env.js'
import { redactText } from '../redaction.js'
import { TelegramApiError, type TelegramBotUser, type TelegramWebhookInfo } from './types.js'

const TELEGRAM_API_BASE = 'https://api.telegram.org/bot'
const MAX_TELEGRAM_RESPONSE_BYTES = 1_000_000

type TelegramResponse<T> = { ok: boolean; result?: T; description?: string; error_code?: number; parameters?: { retry_after?: number } }

function endpoint(token: string, method: string) {
  // Token syntax is validated before this function is called. It stays in a
  // server-only URL and is never included in an error or returned value.
  return `${TELEGRAM_API_BASE}${token}/${method}`
}

function timeoutSignal(callerSignal?: AbortSignal) {
  const timeout = AbortSignal.timeout(getTelegramRuntimeEnv().TELEGRAM_API_TIMEOUT_MS)
  return callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout
}

async function waitRetry(seconds: number, signal?: AbortSignal) {
  if (seconds <= 0) return
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, Math.min(seconds, 5) * 1_000)
    const abort = () => { clearTimeout(timer); reject(new TelegramApiError({ method: 'retry', description: 'تم إيقاف طلب Telegram', status: 499 })) }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

async function readResponse(response: Response) {
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > MAX_TELEGRAM_RESPONSE_BYTES) throw new TelegramApiError({ method: 'response', description: 'استجابة Telegram كبيرة جدًا', status: response.status })
  const reader = response.body?.getReader()
  if (!reader) return ''
  const decoder = new TextDecoder()
  let total = 0
  let output = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_TELEGRAM_RESPONSE_BYTES) {
        await reader.cancel('telegram response too large').catch(() => undefined)
        throw new TelegramApiError({ method: 'response', description: 'استجابة Telegram كبيرة جدًا', status: response.status })
      }
      output += decoder.decode(value, { stream: true })
    }
    return output + decoder.decode()
  } finally {
    reader.releaseLock()
  }
}

export async function callTelegram<T>(token: string, method: string, body: Record<string, unknown> = {}, signal?: AbortSignal, retry = true): Promise<T> {
  const url = endpoint(token, method)
  const timeout = timeoutSignal(signal)
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: timeout,
      redirect: 'error',
    })
  } catch (error: any) {
    if (signal?.aborted) throw new TelegramApiError({ method, description: 'تم إيقاف طلب Telegram', status: 499 })
    if (timeout.aborted || error?.name === 'TimeoutError') throw new TelegramApiError({ method, description: 'انتهت مهلة Telegram', status: 504 })
    throw new TelegramApiError({ method, description: redactText(error?.message || 'تعذر الاتصال بـ Telegram'), status: 503 })
  }

  let payload: TelegramResponse<T>
  try {
    payload = JSON.parse(await readResponse(response)) as TelegramResponse<T>
  } catch (error) {
    if (error instanceof TelegramApiError) throw error
    throw new TelegramApiError({ method, description: 'أعاد Telegram استجابة غير صالحة', status: response.status })
  }

  if (payload.ok && response.ok) return payload.result as T
  const retryAfter = Number(payload.parameters?.retry_after || 0)
  if (payload.error_code === 429 && retry && retryAfter > 0 && retryAfter <= 5) {
    await waitRetry(retryAfter, signal)
    return callTelegram<T>(token, method, body, signal, false)
  }
  throw new TelegramApiError({
    method,
    description: redactText(payload.description || `فشل استدعاء Telegram (${response.status})`, [token]),
    errorCode: payload.error_code,
    retryAfter: retryAfter || undefined,
    status: response.status,
  })
}

export function getMe(token: string, signal?: AbortSignal) {
  return callTelegram<TelegramBotUser>(token, 'getMe', {}, signal)
}

export function setWebhook(token: string, body: { url: string; secret_token: string; allowed_updates: string[]; drop_pending_updates: boolean }, signal?: AbortSignal) {
  return callTelegram<boolean>(token, 'setWebhook', body, signal)
}

export function deleteWebhook(token: string, dropPendingUpdates = false, signal?: AbortSignal) {
  return callTelegram<boolean>(token, 'deleteWebhook', { drop_pending_updates: dropPendingUpdates }, signal)
}

export function getWebhookInfo(token: string, signal?: AbortSignal) {
  return callTelegram<TelegramWebhookInfo>(token, 'getWebhookInfo', {}, signal)
}

export function sendMessage(token: string, body: { chat_id: string | number; text: string }, signal?: AbortSignal) {
  return callTelegram<Record<string, unknown>>(token, 'sendMessage', body, signal)
}

export function sendChatAction(token: string, body: { chat_id: string | number; action: 'typing' }, signal?: AbortSignal) {
  return callTelegram<boolean>(token, 'sendChatAction', body, signal)
}

export function setMyCommands(token: string, commands: Array<{ command: string; description: string }>, signal?: AbortSignal) {
  return callTelegram<boolean>(token, 'setMyCommands', { commands }, signal)
}
