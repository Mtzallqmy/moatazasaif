import type { VercelRequest, VercelResponse } from '../../_lib/vercel'
import { authenticate } from '../../_lib/supabase'
import { ApiError, methodNotAllowed, sendError, setJsonHeaders } from '../../_lib/http'
import { enforceRateLimit } from '../../_lib/rate-limit'
import { parseRequest } from '../../_lib/provider-schemas'
import { telegramCreateSchema, telegramDeleteSchema, telegramDiagnoseSchema, telegramPatchSchema } from '../../_lib/telegram/schemas'
import { checkTelegramWebhook, createTelegramIntegration, deleteTelegramIntegration, listOwnedTelegramIntegrations, reregisterTelegramWebhook, sendTelegramTestMessage, updateTelegramChat, updateTelegramIntegration } from '../../_lib/telegram/service'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setJsonHeaders(res)
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method || '')) return methodNotAllowed(res, ['GET', 'POST', 'PATCH', 'DELETE'])
  try {
    const auth = await authenticate(req)
    await enforceRateLimit(req, `telegram_${(req.method || 'GET').toLowerCase()}`, req.method === 'GET' ? 120 : 40, req.method === 'GET' ? 60 : 300, auth.user.id)

    if (req.method === 'GET') return res.status(200).json({ integrations: await listOwnedTelegramIntegrations(auth.user.id) })
    if (req.method === 'POST') return res.status(201).json({ integration: await createTelegramIntegration(auth.user.id, parseRequest(telegramCreateSchema, req.body)) })
    if (req.method === 'DELETE') {
      const result = await deleteTelegramIntegration(auth.user.id, parseRequest(telegramDeleteSchema, req.body).id)
      return res.status(200).json(result)
    }

    const body = parseRequest(telegramPatchSchema, req.body)
    if (body.action === 'check-webhook') return res.status(200).json({ integration: await checkTelegramWebhook(auth.user.id, body.integrationId) })
    if (body.action === 'register-webhook') return res.status(200).json({ integration: await reregisterTelegramWebhook(auth.user.id, body.integrationId) })
    if (body.action === 'test-message') return res.status(200).json(await sendTelegramTestMessage(auth.user.id, body.integrationId, body.chatId))
    if (body.action === 'chat-allowed') return res.status(200).json({ chat: await updateTelegramChat(auth.user.id, body.integrationId, body.chatId, body.isAllowed) })
    if (body.action === 'update') {
      return res.status(200).json({ integration: await updateTelegramIntegration(auth.user.id, body.integrationId, { name: body.name, providerId: body.providerId, model: body.model, isEnabled: body.isEnabled }) })
    }
    throw new ApiError(400, 'إجراء Telegram غير معروف', 'telegram_action_invalid')
  } catch (error) {
    return sendError(res, error)
  }
}
