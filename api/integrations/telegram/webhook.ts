import type { VercelRequest, VercelResponse } from '../../_lib/vercel'
import { ApiError, sendError, setJsonHeaders } from '../../_lib/http'
import { scheduleTelegramWork } from '../../_lib/telegram/background'
import { findIntegrationByWebhookSecret, processTelegramUpdate, saveReceivedTelegramUpdate } from '../../_lib/telegram/service'
import { telegramUpdateSchema } from '../../_lib/telegram/types'

function headerValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setJsonHeaders(res)
  if (req.method !== 'POST') return res.status(405).json({ error: 'الطريقة غير مسموحة', code: 'method_not_allowed' })
  try {
    const secret = headerValue(req.headers['x-telegram-bot-api-secret-token'])
    if (!secret || secret.length > 256) throw new ApiError(401, 'Webhook Secret غير صالح', 'telegram_webhook_unauthorized')
    const integration = await findIntegrationByWebhookSecret(secret)
    if (!integration) throw new ApiError(401, 'Webhook Secret غير صالح', 'telegram_webhook_unauthorized')
    let rawBody: unknown = req.body
    if (typeof req.body === 'string') {
      try { rawBody = JSON.parse(req.body) } catch { throw new ApiError(400, 'بنية تحديث Telegram غير صالحة', 'telegram_update_invalid') }
    }
    const parsed = telegramUpdateSchema.safeParse(rawBody)
    if (!parsed.success) throw new ApiError(400, 'بنية تحديث Telegram غير صالحة', 'telegram_update_invalid')
    const accepted = await saveReceivedTelegramUpdate(integration.id, parsed.data)
    if (accepted) scheduleTelegramWork(processTelegramUpdate(integration.id, parsed.data.update_id, parsed.data))
    return res.status(200).json({ ok: true })
  } catch (error) {
    return sendError(res, error)
  }
}
