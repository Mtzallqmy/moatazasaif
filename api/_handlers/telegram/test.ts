import type { VercelRequest, VercelResponse } from '../../_lib/vercel.js'
import { authenticate } from '../../_lib/supabase.js'
import { methodNotAllowed, sendError, setJsonHeaders } from '../../_lib/http.js'
import { enforceRateLimit } from '../../_lib/rate-limit.js'
import { parseRequest } from '../../_lib/provider-schemas.js'
import { telegramTestSchema } from '../../_lib/telegram/schemas.js'
import { testTelegramToken } from '../../_lib/telegram/service.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setJsonHeaders(res)
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
  try {
    const auth = await authenticate(req)
    await enforceRateLimit(req, 'telegram_test', 20, 300, auth.user.id)
    return res.status(200).json(await testTelegramToken(parseRequest(telegramTestSchema, req.body).botToken))
  } catch (error) {
    return sendError(res, error)
  }
}
