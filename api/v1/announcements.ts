import type { VercelRequest, VercelResponse } from '../_lib/vercel.js'
import { getAdminClient, requireRoles } from '../_lib/supabase.js'
import { ApiError, methodNotAllowed, optionalString, requireString, sendError, setJsonHeaders } from '../_lib/http.js'
import { CONTENT_ROLES, contentWriteError, optionalBoolean, optionalInteger, optionalIsoDate, optionalSafeUrl, queryString, requireId } from '../_lib/content.js'
import { enforceRateLimit } from '../_lib/rate-limit.js'
import { writeAuditEvent } from '../_lib/audit.js'

function placement(value: unknown) {
  if (value !== 'top' && value !== 'dashboard') throw new ApiError(400, 'موضع الإعلان غير صالح', 'invalid_placement')
  return value
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setJsonHeaders(res)
  res.setHeader('X-API-Version', '1')
  try {
    const admin = getAdminClient()
    if (req.method === 'GET') {
      await enforceRateLimit(req, 'announcements_read', 300, 60)
      const manage = queryString(req.query.manage) === 'true'
      if (manage) await requireRoles(req, [...CONTENT_ROLES])
      let query = admin.from('announcements').select('*').order('sort_order').order('created_at', { ascending: false })
      const requestedPlacement = queryString(req.query.placement)
      if (requestedPlacement) query = query.eq('placement', placement(requestedPlacement))
      if (!manage) query = query.eq('is_active', true).or(`starts_at.is.null,starts_at.lte.${new Date().toISOString()}`).or(`ends_at.is.null,ends_at.gt.${new Date().toISOString()}`)
      const { data, error } = await query.limit(manage ? 100 : 10)
      if (error) throw new ApiError(500, 'تعذر قراءة الإعلانات', 'announcements_read_failed')
      res.setHeader('Cache-Control', manage ? 'no-store' : 'public, max-age=30, s-maxage=120, stale-while-revalidate=300')
      return res.status(200).json({ data: data || [] })
    }

    const auth = await requireRoles(req, [...CONTENT_ROLES])
    await enforceRateLimit(req, 'announcements_write', 60, 3600, auth.user.id)
    if (req.method === 'POST') {
      const payload = {
        text_ar: requireString(req.body?.textAr, 'textAr', 300),
        text_en: optionalString(req.body?.textEn, 300) || null,
        href: optionalSafeUrl(req.body?.href) || null,
        placement: placement(req.body?.placement || 'top'),
        is_active: optionalBoolean(req.body?.isActive) ?? true,
        starts_at: optionalIsoDate(req.body?.startsAt) || null,
        ends_at: optionalIsoDate(req.body?.endsAt) || null,
        sort_order: optionalInteger(req.body?.sortOrder) ?? 0,
        created_by: auth.user.id,
      }
      const { data, error } = await admin.from('announcements').insert(payload).select('*').single()
      if (error) contentWriteError(error, 'تعذر إنشاء الإعلان')
      await writeAuditEvent(auth.user.id, 'ANNOUNCEMENT_CREATED', { announcementId: data.id, placement: data.placement })
      return res.status(201).json({ data })
    }
    if (req.method === 'PATCH') {
      const id = requireId(req.body?.id)
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (req.body?.textAr !== undefined) patch.text_ar = requireString(req.body.textAr, 'textAr', 300)
      if (req.body?.textEn !== undefined) patch.text_en = optionalString(req.body.textEn, 300) || null
      if (req.body?.href !== undefined) patch.href = optionalSafeUrl(req.body.href) || null
      if (req.body?.placement !== undefined) patch.placement = placement(req.body.placement)
      if (req.body?.isActive !== undefined) patch.is_active = optionalBoolean(req.body.isActive)
      if (req.body?.startsAt !== undefined) patch.starts_at = optionalIsoDate(req.body.startsAt) || null
      if (req.body?.endsAt !== undefined) patch.ends_at = optionalIsoDate(req.body.endsAt) || null
      if (req.body?.sortOrder !== undefined) patch.sort_order = optionalInteger(req.body.sortOrder)
      const { data, error } = await admin.from('announcements').update(patch).eq('id', id).select('*').maybeSingle()
      if (error) contentWriteError(error, 'تعذر تحديث الإعلان')
      if (!data) throw new ApiError(404, 'الإعلان غير موجود', 'announcement_not_found')
      await writeAuditEvent(auth.user.id, 'ANNOUNCEMENT_UPDATED', { announcementId: data.id, placement: data.placement })
      return res.status(200).json({ data })
    }
    if (req.method === 'DELETE') {
      const id = requireId(req.body?.id)
      const { data, error } = await admin.from('announcements').update({ is_active: false, updated_at: new Date().toISOString() }).eq('id', id).select('*').maybeSingle()
      if (error) contentWriteError(error, 'تعذر إيقاف الإعلان')
      if (!data) throw new ApiError(404, 'الإعلان غير موجود', 'announcement_not_found')
      await writeAuditEvent(auth.user.id, 'ANNOUNCEMENT_DISABLED', { announcementId: data.id, placement: data.placement })
      return res.status(200).json({ data })
    }
    return methodNotAllowed(res, ['GET', 'POST', 'PATCH', 'DELETE'])
  } catch (error) { return sendError(res, error) }
}
