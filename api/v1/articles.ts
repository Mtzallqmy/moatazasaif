import type { VercelRequest, VercelResponse } from '../_lib/vercel.js'
import { getAdminClient, requireRoles } from '../_lib/supabase.js'
import { ApiError, methodNotAllowed, optionalString, requireString, sendError, setJsonHeaders } from '../_lib/http.js'
import { ARTICLE_STATUSES, CONTENT_ROLES, contentWriteError, optionalIsoDate, optionalSafeUrl, pageParams, queryString, requireId, requireSlug } from '../_lib/content.js'
import { enforceRateLimit } from '../_lib/rate-limit.js'
import { writeAuditEvent } from '../_lib/audit.js'

function articleStatus(value: unknown) {
  if (typeof value !== 'string' || !ARTICLE_STATUSES.includes(value as (typeof ARTICLE_STATUSES)[number])) throw new ApiError(400, 'حالة المقال غير صالحة', 'invalid_article_status')
  return value as (typeof ARTICLE_STATUSES)[number]
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setJsonHeaders(res)
  res.setHeader('X-API-Version', '1')
  try {
    const admin = getAdminClient()
    if (req.method === 'GET') {
      await enforceRateLimit(req, 'articles_read', 300, 60)
      const manage = queryString(req.query.manage) === 'true'
      if (manage) await requireRoles(req, [...CONTENT_ROLES])
      const slug = queryString(req.query.slug)
      const section = queryString(req.query.section)
      const { page, limit, from, to } = pageParams(req.query)
      const selection = section ? '*, content_sections!inner(slug,name_ar,name_en)' : '*, content_sections(slug,name_ar,name_en)'
      let query = admin.from('articles').select(selection, { count: 'exact' }).order('published_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false })
      if (slug) query = query.eq('slug', requireSlug(slug))
      if (section) query = query.eq('content_sections.slug', requireSlug(section, 80))
      if (manage) {
        const status = queryString(req.query.status)
        if (status) query = query.eq('status', articleStatus(status))
      } else {
        query = query.eq('status', 'published').not('published_at', 'is', null).lte('published_at', new Date().toISOString())
      }
      const { data, count, error } = await query.range(from, to)
      if (error) throw new ApiError(500, 'تعذر قراءة المقالات', 'articles_read_failed')
      res.setHeader('Cache-Control', manage ? 'no-store' : 'public, max-age=30, s-maxage=180, stale-while-revalidate=600')
      return res.status(200).json({ data: data || [], pagination: { page, limit, total: count || 0, pages: Math.ceil((count || 0) / limit) } })
    }

    const auth = await requireRoles(req, [...CONTENT_ROLES])
    await enforceRateLimit(req, 'articles_write', 120, 3600, auth.user.id)
    if (req.method === 'POST') {
      const status = req.body?.status === undefined ? 'draft' : articleStatus(req.body.status)
      const payload = {
        section_id: req.body?.sectionId ? requireId(req.body.sectionId) : null,
        slug: requireSlug(req.body?.slug),
        title_ar: requireString(req.body?.titleAr, 'titleAr', 200),
        title_en: optionalString(req.body?.titleEn, 200) || null,
        excerpt_ar: optionalString(req.body?.excerptAr, 500) || null,
        excerpt_en: optionalString(req.body?.excerptEn, 500) || null,
        content_ar: requireString(req.body?.contentAr, 'contentAr', 100_000),
        content_en: optionalString(req.body?.contentEn, 100_000) || null,
        cover_url: optionalSafeUrl(req.body?.coverUrl) || null,
        status,
        published_at: status === 'published' ? (optionalIsoDate(req.body?.publishedAt) || new Date().toISOString()) : null,
        author_id: auth.user.id,
        seo: req.body?.seo && typeof req.body.seo === 'object' && !Array.isArray(req.body.seo) ? req.body.seo : {},
      }
      const { data, error } = await admin.from('articles').insert(payload).select('*').single()
      if (error) contentWriteError(error, 'تعذر إنشاء المقال')
      await writeAuditEvent(auth.user.id, 'ARTICLE_CREATED', { articleId: data.id, slug: data.slug, status: data.status })
      return res.status(201).json({ data })
    }
    if (req.method === 'PATCH') {
      const id = requireId(req.body?.id)
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (req.body?.sectionId !== undefined) patch.section_id = req.body.sectionId ? requireId(req.body.sectionId) : null
      if (req.body?.slug !== undefined) patch.slug = requireSlug(req.body.slug)
      if (req.body?.titleAr !== undefined) patch.title_ar = requireString(req.body.titleAr, 'titleAr', 200)
      if (req.body?.titleEn !== undefined) patch.title_en = optionalString(req.body.titleEn, 200) || null
      if (req.body?.excerptAr !== undefined) patch.excerpt_ar = optionalString(req.body.excerptAr, 500) || null
      if (req.body?.excerptEn !== undefined) patch.excerpt_en = optionalString(req.body.excerptEn, 500) || null
      if (req.body?.contentAr !== undefined) patch.content_ar = requireString(req.body.contentAr, 'contentAr', 100_000)
      if (req.body?.contentEn !== undefined) patch.content_en = optionalString(req.body.contentEn, 100_000) || null
      if (req.body?.coverUrl !== undefined) patch.cover_url = optionalSafeUrl(req.body.coverUrl) || null
      if (req.body?.status !== undefined) {
        const status = articleStatus(req.body.status)
        patch.status = status
        patch.published_at = status === 'published' ? (optionalIsoDate(req.body?.publishedAt) || new Date().toISOString()) : null
      }
      const { data, error } = await admin.from('articles').update(patch).eq('id', id).select('*').maybeSingle()
      if (error) contentWriteError(error, 'تعذر تحديث المقال')
      if (!data) throw new ApiError(404, 'المقال غير موجود', 'article_not_found')
      await writeAuditEvent(auth.user.id, 'ARTICLE_UPDATED', { articleId: data.id, slug: data.slug, status: data.status })
      return res.status(200).json({ data })
    }
    if (req.method === 'DELETE') {
      const id = requireId(req.body?.id)
      const { data, error } = await admin.from('articles').update({ status: 'archived', published_at: null, updated_at: new Date().toISOString() }).eq('id', id).select('*').maybeSingle()
      if (error) contentWriteError(error, 'تعذر أرشفة المقال')
      if (!data) throw new ApiError(404, 'المقال غير موجود', 'article_not_found')
      await writeAuditEvent(auth.user.id, 'ARTICLE_ARCHIVED', { articleId: data.id, slug: data.slug })
      return res.status(200).json({ data })
    }
    return methodNotAllowed(res, ['GET', 'POST', 'PATCH', 'DELETE'])
  } catch (error) { return sendError(res, error) }
}
