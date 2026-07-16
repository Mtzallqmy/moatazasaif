import { ApiError } from '../http.js'
import { integrationSignal, readIntegrationJson, upstreamMessage } from './http.js'

const TOKEN_PATTERN = /^[\x21-\x7e]{20,8192}$/
const PHONE_ID_PATTERN = /^\d{5,30}$/
const RECIPIENT_PATTERN = /^\+?\d{8,20}$/
const VERSION_PATTERN = /^v\d{1,2}\.\d$/

export interface WhatsAppPhone {
  id: string
  displayPhoneNumber?: string
  verifiedName?: string
  qualityRating?: string
  apiVersion: string
}

export function normalizeWhatsAppCredentials(accessTokenValue: unknown, phoneNumberIdValue: unknown, apiVersionValue: unknown = 'v25.0') {
  const accessToken = typeof accessTokenValue === 'string' ? accessTokenValue.trim() : ''
  const phoneNumberId = typeof phoneNumberIdValue === 'string' ? phoneNumberIdValue.trim() : ''
  const apiVersion = typeof apiVersionValue === 'string' ? apiVersionValue.trim() : 'v25.0'
  if (!TOKEN_PATTERN.test(accessToken)) throw new ApiError(400, 'WhatsApp access token غير صالح', 'whatsapp_token_invalid')
  if (!PHONE_ID_PATTERN.test(phoneNumberId)) throw new ApiError(400, 'WhatsApp Phone Number ID غير صالح', 'whatsapp_phone_id_invalid')
  if (!VERSION_PATTERN.test(apiVersion)) throw new ApiError(400, 'إصدار WhatsApp Graph API غير صالح', 'whatsapp_api_version_invalid')
  return { accessToken, phoneNumberId, apiVersion }
}

async function graphRequest(path: string, accessToken: string, init: RequestInit, fetcher: typeof fetch) {
  let response: Response
  try {
    response = await fetcher(`https://graph.facebook.com${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', ...init.headers },
      signal: integrationSignal(init.signal || undefined),
      redirect: 'error',
    })
  } catch {
    throw new ApiError(503, 'تعذر الاتصال بـ WhatsApp Cloud API', 'whatsapp_unreachable')
  }
  const payload = await readIntegrationJson(response)
  if (!response.ok) {
    if (response.status === 401) throw new ApiError(401, 'WhatsApp access token غير صالح أو منتهي', 'whatsapp_token_rejected')
    throw new ApiError(response.status === 400 ? 400 : 502, upstreamMessage(payload, 'فشل استدعاء WhatsApp Cloud API', [accessToken]), 'whatsapp_api_failed', { status: response.status })
  }
  return payload
}

export async function testWhatsAppCredentials(accessTokenValue: unknown, phoneNumberIdValue: unknown, apiVersionValue: unknown = 'v25.0', fetcher: typeof fetch = fetch): Promise<WhatsAppPhone> {
  const { accessToken, phoneNumberId, apiVersion } = normalizeWhatsAppCredentials(accessTokenValue, phoneNumberIdValue, apiVersionValue)
  const fields = 'id,display_phone_number,verified_name,quality_rating'
  const payload = await graphRequest(`/${apiVersion}/${phoneNumberId}?fields=${encodeURIComponent(fields)}`, accessToken, { method: 'GET' }, fetcher) as { id?: string; display_phone_number?: string; verified_name?: string; quality_rating?: string }
  if (!payload.id) throw new ApiError(502, 'استجابة رقم WhatsApp ناقصة', 'whatsapp_phone_invalid')
  return { id: String(payload.id), displayPhoneNumber: payload.display_phone_number, verifiedName: payload.verified_name, qualityRating: payload.quality_rating, apiVersion }
}

export async function sendWhatsAppText(accessTokenValue: unknown, phoneNumberIdValue: unknown, apiVersionValue: unknown, recipientValue: unknown, textValue: unknown, fetcher: typeof fetch = fetch) {
  const { accessToken, phoneNumberId, apiVersion } = normalizeWhatsAppCredentials(accessTokenValue, phoneNumberIdValue, apiVersionValue)
  const recipient = typeof recipientValue === 'string' ? recipientValue.trim() : ''
  const message = typeof textValue === 'string' ? textValue.trim() : ''
  if (!RECIPIENT_PATTERN.test(recipient)) throw new ApiError(400, 'رقم المستلم بصيغة دولية غير صالح', 'whatsapp_recipient_invalid')
  if (!message || message.length > 4_096) throw new ApiError(400, 'نص رسالة WhatsApp غير صالح', 'whatsapp_message_invalid')
  const payload = await graphRequest(`/${apiVersion}/${phoneNumberId}/messages`, accessToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: recipient.replace(/^\+/, ''), type: 'text', text: { preview_url: false, body: message } }),
  }, fetcher) as { messages?: Array<{ id?: string }> }
  const messageId = payload.messages?.[0]?.id
  if (!messageId) throw new ApiError(502, 'لم يؤكد WhatsApp إرسال الرسالة', 'whatsapp_send_unconfirmed')
  return { sent: true, messageId }
}
