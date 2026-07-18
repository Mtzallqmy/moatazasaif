import type { VercelRequest, VercelResponse } from './_lib/vercel.js'
import { getServerEnv } from './_lib/env.js'
import { getAdminClient } from './_lib/supabase.js'
import { methodNotAllowed, setJsonHeaders } from './_lib/http.js'
import { logTechnicalError } from './_lib/redaction.js'
import platformProvider from './_handlers/platform-provider.js'
import sitemap from './_handlers/sitemap.js'
import announcements from './_handlers/v1/announcements.js'
import articles from './_handlers/v1/articles.js'
import contentSummary from './_handlers/v1/content-summary.js'
import sections from './_handlers/v1/sections.js'
import status from './_handlers/v1/status.js'
import siteSettings from './_handlers/site-settings.js'
import publicApiV1 from './_handlers/public-api-v1.js'
import apiKeys from './_handlers/api-keys.js'
import chats from './_handlers/chats.js'
import providerManager from './_handlers/provider-manager.js'
import files from './_handlers/files.js'
import projects from './_handlers/projects.js'
import { runScheduledProviderHealthChecks } from './_lib/provider-manager.js'

const routedHandlers: Record<string, (req: VercelRequest, res: VercelResponse) => unknown> = {
  'platform-provider': platformProvider,
  sitemap,
  'v1-announcements': announcements,
  'v1-articles': articles,
  'v1-content-summary': contentSummary,
  'v1-sections': sections,
  'v1-status': status,
  'site-settings': siteSettings,
  'public-api-v1': publicApiV1,
  'api-keys': apiKeys,
  chats,
  'provider-manager': providerManager,
  files,
  projects,
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const route = Array.isArray(req.query.route) ? req.query.route[0] : req.query.route
  if (route && routedHandlers[route]) return routedHandlers[route](req, res)
  if (route === 'provider-health') {
    setJsonHeaders(res)
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    const secret = process.env.CRON_SECRET
    const authorization = req.headers.authorization
    if (!secret || authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'غير مصرح', code: 'cron_unauthorized' })
    try {
      const result = await runScheduledProviderHealthChecks(getAdminClient())
      return res.status(200).json({ ...result, timestamp: new Date().toISOString() })
    } catch (error) {
      logTechnicalError('[scheduled-provider-health-failed]', error)
      return res.status(503).json({ error: 'تعذر فحص المزودات', code: 'provider_health_failed' })
    }
  }
  if (route === 'health') {
    setJsonHeaders(res)
    if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
    return res.status(200).json({ status: 'ok', service: 'moataz-ai', timestamp: new Date().toISOString() })
  }
  setJsonHeaders(res)
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
  try {
    getServerEnv()
    const admin = getAdminClient()
    const [{ error: profileError }, { error: rateLimitError }] = await Promise.all([
      admin.from('profiles').select('id', { head: true, count: 'exact' }).limit(1),
      admin.rpc('consume_api_rate_limit', {
        p_key_hash: '0'.repeat(64),
        p_action: 'readiness_probe',
        p_limit: 100000,
        p_window_seconds: 60,
      }).single(),
    ])
    if (profileError) throw profileError
    if (rateLimitError) throw rateLimitError
    return res.status(200).json({ status: 'ready', timestamp: new Date().toISOString() })
  } catch (error) {
    logTechnicalError('[readiness-failed]', error)
    return res.status(503).json({ status: 'not_ready', timestamp: new Date().toISOString() })
  }
}
