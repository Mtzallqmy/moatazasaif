import type { VercelRequest, VercelResponse } from '../../_lib/vercel.js'
import { getAdminClient } from '../../_lib/supabase.js'
import { ApiError, methodNotAllowed, sendError, setJsonHeaders } from '../../_lib/http.js'
import { enforceRateLimit } from '../../_lib/rate-limit.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setJsonHeaders(res)
  res.setHeader('X-API-Version', '1')
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
  try {
    await enforceRateLimit(req, 'content_summary_read', 240, 60)
    const admin = getAdminClient()
    const now = new Date().toISOString()
    const [articles, sections, announcements] = await Promise.all([
      admin.from('articles').select('id', { count: 'exact', head: true }).eq('status', 'published').lte('published_at', now),
      admin.from('content_sections').select('id', { count: 'exact', head: true }).eq('is_visible', true),
      admin.from('announcements').select('id', { count: 'exact', head: true }).eq('is_active', true),
    ])
    if (articles.error || sections.error || announcements.error) throw new ApiError(500, 'تعذر قراءة ملخص المحتوى', 'content_summary_failed')
    res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=120, stale-while-revalidate=300')
    return res.status(200).json({ data: { articles: articles.count || 0, sections: sections.count || 0, announcements: announcements.count || 0 } })
  } catch (error) { return sendError(res, error) }
}
