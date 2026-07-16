import type { VercelRequest, VercelResponse } from '../../_lib/vercel.js'
import { getAdminClient, requireRoles } from '../../_lib/supabase.js'
import { ApiError, methodNotAllowed, optionalString, requireString, sendError, setJsonHeaders } from '../../_lib/http.js'
import { CONTENT_ROLES, contentWriteError, optionalBoolean, optionalInteger, queryString, requireId, requireSlug } from '../../_lib/content.js'
import { enforceRateLimit } from '../../_lib/rate-limit.js'
import { writeAuditEvent } from '../../_lib/audit.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setJsonHeaders(res)
  res.setHeader('X-API-Version', '1')
  try {
    const admin = getAdminClient()
    if (req.method === 'GET') {
      await enforceRateLimit(req, 'content_sections_read', 240, 60)
      const manage = queryString(req.query.manage) === 'true'
      if (manage) await requireRoles(req, [...CONTENT_ROLES])
      let query = admin.from('content_sections').select('*').order('sort_order').order('created_at')
      if (!manage) query = query.eq('is_visible', true)
      const { data, error } = await query
      if (error) throw new ApiError(500, 'تعذر قراءة الأقسام', 'sections_read_failed')
      res.setHeader('Cache-Control', manage ? 'no-store' : 'public, max-age=60, s-maxage=300, stale-while-revalidate=600')
      return res.status(200).json({ data: data || [] })
    }

    const auth = await requireRoles(req, [...CONTENT_ROLES])
    await enforceRateLimit(req, 'content_sections_write', 60, 3600, auth.user.id)
    if (req.method === 'POST') {
      const payload = {
        slug: requireSlug(req.body?.slug, 80),
        name_ar: requireString(req.body?.nameAr, 'nameAr', 120),
        name_en: optionalString(req.body?.nameEn, 120) || null,
        description_ar: optionalString(req.body?.descriptionAr, 2_000) || null,
        description_en: optionalString(req.body?.descriptionEn, 2_000) || null,
        sort_order: optionalInteger(req.body?.sortOrder) ?? 0,
        is_visible: optionalBoolean(req.body?.isVisible) ?? true,
        created_by: auth.user.id,
      }
      const { data, error } = await admin.from('content_sections').insert(payload).select('*').single()
      if (error) contentWriteError(error, 'تعذر إنشاء القسم')
      await writeAuditEvent(auth.user.id, 'CONTENT_SECTION_CREATED', { sectionId: data.id, slug: data.slug })
      return res.status(201).json({ data })
    }
    if (req.method === 'PATCH') {
      const id = requireId(req.body?.id)
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (req.body?.slug !== undefined) patch.slug = requireSlug(req.body.slug, 80)
      if (req.body?.nameAr !== undefined) patch.name_ar = requireString(req.body.nameAr, 'nameAr', 120)
      if (req.body?.nameEn !== undefined) patch.name_en = optionalString(req.body.nameEn, 120) || null
      if (req.body?.descriptionAr !== undefined) patch.description_ar = optionalString(req.body.descriptionAr, 2_000) || null
      if (req.body?.descriptionEn !== undefined) patch.description_en = optionalString(req.body.descriptionEn, 2_000) || null
      if (req.body?.sortOrder !== undefined) patch.sort_order = optionalInteger(req.body.sortOrder)
      if (req.body?.isVisible !== undefined) patch.is_visible = optionalBoolean(req.body.isVisible)
      const { data, error } = await admin.from('content_sections').update(patch).eq('id', id).select('*').maybeSingle()
      if (error) contentWriteError(error, 'تعذر تحديث القسم')
      if (!data) throw new ApiError(404, 'القسم غير موجود', 'section_not_found')
      await writeAuditEvent(auth.user.id, 'CONTENT_SECTION_UPDATED', { sectionId: data.id, slug: data.slug })
      return res.status(200).json({ data })
    }
    if (req.method === 'DELETE') {
      const id = requireId(req.body?.id)
      const { data, error } = await admin.from('content_sections').update({ is_visible: false, updated_at: new Date().toISOString() }).eq('id', id).select('*').maybeSingle()
      if (error) contentWriteError(error, 'تعذر أرشفة القسم')
      if (!data) throw new ApiError(404, 'القسم غير موجود', 'section_not_found')
      await writeAuditEvent(auth.user.id, 'CONTENT_SECTION_ARCHIVED', { sectionId: data.id, slug: data.slug })
      return res.status(200).json({ data })
    }
    return methodNotAllowed(res, ['GET', 'POST', 'PATCH', 'DELETE'])
  } catch (error) { return sendError(res, error) }
}
