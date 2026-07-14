import type { VercelRequest, VercelResponse } from '../../_lib/vercel'
import { authenticate } from '../../_lib/supabase'
import { methodNotAllowed, sendError, setJsonHeaders } from '../../_lib/http'
import { enforceRateLimit } from '../../_lib/rate-limit'
import { parseRequest } from '../../_lib/provider-schemas'
import { telegramLinkCodeSchema } from '../../_lib/telegram/schemas'
import { createTelegramLinkCode } from '../../_lib/telegram/service'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setJsonHeaders(res)
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
  try {
    const auth = await authenticate(req)
    await enforceRateLimit(req, 'telegram_link_code', 20, 600, auth.user.id)
    return res.status(200).json(await createTelegramLinkCode(auth.user.id, parseRequest(telegramLinkCodeSchema, req.body).integrationId))
  } catch (error) {
    return sendError(res, error)
  }
}
