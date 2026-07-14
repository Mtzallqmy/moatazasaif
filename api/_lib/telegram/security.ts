import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { ApiError } from '../http.js'
import { redactText } from '../redaction.js'

const BOT_TOKEN_PATTERN = /^\d{5,20}:[A-Za-z0-9_-]{20,256}$/
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function normalizeBotToken(value: unknown) {
  if (typeof value !== 'string') throw new ApiError(400, 'Bot Token مطلوب', 'telegram_token_invalid')
  const token = value.trim()
  if (!BOT_TOKEN_PATTERN.test(token)) throw new ApiError(400, 'صيغة Bot Token غير صالحة', 'telegram_token_invalid')
  return token
}

export function sha256Hex(value: string) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export function generateWebhookSecret() {
  return randomBytes(32).toString('base64url')
}

export function generateLinkCode() {
  const part = (length: number) => Array.from({ length }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('')
  return `${part(4)}-${part(4)}`
}

export function safeEqualText(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}

export function redactTelegram(value: unknown, botToken?: string) {
  return redactText(String(value ?? ''), botToken ? [botToken] : [], 2_000)
}
