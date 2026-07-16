import type { VercelRequest, VercelResponse } from '../_lib/vercel.js'
import { methodNotAllowed, sendError, setJsonHeaders } from '../_lib/http.js'
import { getAdminClient } from '../_lib/supabase.js'
import { authenticateApiKey, requestId, requireScope, writeApiUsage } from '../_lib/public-api.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setJsonHeaders(res)
  const id = requestId(req, res)
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
  const started = Date.now()
  let context
  try {
    context = await authenticateApiKey(req)
    requireScope(context, 'models:read')
    const { data, error } = await getAdminClient().from('providers')
      .select('id,name,type,protocol,model,models')
      .eq('is_platform_shared', true).eq('is_enabled', true).eq('status', 'connected')
    if (error) throw error
    const allowed = new Set(context.allowedModels)
    const seen = new Set<string>()
    const models = (data || []).flatMap((provider: any) => {
      const names = Array.isArray(provider.models) && provider.models.length ? provider.models : [provider.model]
      return names.filter(Boolean).filter((name: string) => !allowed.size || allowed.has(name)).filter((name: string) => !seen.has(name) && seen.add(name)).map((name: string) => ({
        id: name,
        object: 'model',
        owned_by: 'moataz-ai',
        provider: provider.type,
        capabilities: ['chat'],
      }))
    })
    await writeApiUsage({ context, requestId: id, endpoint: '/v1/models', method: 'GET', statusCode: 200, service: 'ai', latencyMs: Date.now() - started, req })
    return res.status(200).json({ object: 'list', data: models })
  } catch (error) {
    if (context) await writeApiUsage({ context, requestId: id, endpoint: '/v1/models', method: 'GET', statusCode: (error as any)?.status || 500, service: 'ai', latencyMs: Date.now() - started, errorCode: (error as any)?.code, safeErrorMessage: error instanceof Error ? error.message : undefined, req })
    return sendError(res, error)
  }
}
