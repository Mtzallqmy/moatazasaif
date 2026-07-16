import type { VercelRequest, VercelResponse } from '../_lib/vercel.js'
import { getAdminClient, requireRoles } from '../_lib/supabase.js'
import { ApiError, methodNotAllowed, sendError, setJsonHeaders } from '../_lib/http.js'
import { enforceRateLimit } from '../_lib/rate-limit.js'
import { recordAudit } from '../_lib/audit.js'
import {
  navigationCreateSchema,
  navigationDeleteSchema,
  navigationPatchSchema,
  parseSiteRequest,
  siteSettingsPatchSchema,
} from '../_lib/site-schemas.js'
import { DEFAULT_SITE_SETTINGS, type SiteNavigationItem, type SiteSettings } from '../../shared/site-settings.js'

const CONTENT_ROLES = ['owner', 'admin', 'manager', 'editor'] as const
const SETTINGS_ROLES = ['owner', 'admin'] as const

function settingsFromRow(row: Record<string, unknown> | null): SiteSettings {
  if (!row) return DEFAULT_SITE_SETTINGS
  return {
    siteNameAr: String(row.site_name_ar || DEFAULT_SITE_SETTINGS.siteNameAr),
    siteNameEn: String(row.site_name_en || DEFAULT_SITE_SETTINGS.siteNameEn),
    taglineAr: String(row.tagline_ar || DEFAULT_SITE_SETTINGS.taglineAr),
    taglineEn: String(row.tagline_en || DEFAULT_SITE_SETTINGS.taglineEn),
    footerTextAr: String(row.footer_text_ar || DEFAULT_SITE_SETTINGS.footerTextAr),
    footerTextEn: String(row.footer_text_en || DEFAULT_SITE_SETTINGS.footerTextEn),
    primaryColor: String(row.primary_color || DEFAULT_SITE_SETTINGS.primaryColor),
    accentColor: String(row.accent_color || DEFAULT_SITE_SETTINGS.accentColor),
    fontStyle: row.font_style === 'humanist' || row.font_style === 'editorial' ? row.font_style : 'modern',
    allowRegistration: row.allow_registration !== false,
    blogEnabled: row.blog_enabled !== false,
    publicStatusEnabled: row.public_status_enabled === true,
    maintenanceMode: row.maintenance_mode === true,
    maintenanceMessageAr: typeof row.maintenance_message_ar === 'string' ? row.maintenance_message_ar : undefined,
    maintenanceMessageEn: typeof row.maintenance_message_en === 'string' ? row.maintenance_message_en : undefined,
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : undefined,
  }
}

function navigationFromRow(row: Record<string, unknown>): SiteNavigationItem {
  return {
    id: String(row.id),
    location: row.location === 'footer' ? 'footer' : 'header',
    labelAr: String(row.label_ar),
    labelEn: String(row.label_en),
    href: String(row.href),
    isExternal: row.is_external === true,
    isActive: row.is_active !== false,
    sortOrder: Number(row.sort_order || 0),
  }
}

function settingsToRow(input: Record<string, unknown>, actorId: string) {
  const fields: Record<string, unknown> = { updated_by: actorId, updated_at: new Date().toISOString() }
  const mapping: Record<string, string> = {
    siteNameAr: 'site_name_ar', siteNameEn: 'site_name_en', taglineAr: 'tagline_ar', taglineEn: 'tagline_en',
    footerTextAr: 'footer_text_ar', footerTextEn: 'footer_text_en', primaryColor: 'primary_color', accentColor: 'accent_color',
    fontStyle: 'font_style', allowRegistration: 'allow_registration', blogEnabled: 'blog_enabled',
    publicStatusEnabled: 'public_status_enabled', maintenanceMode: 'maintenance_mode',
    maintenanceMessageAr: 'maintenance_message_ar', maintenanceMessageEn: 'maintenance_message_en',
  }
  for (const [key, column] of Object.entries(mapping)) if (key in input) fields[column] = input[key] ?? null
  return fields
}

function navigationToRow(input: Record<string, unknown>) {
  const fields: Record<string, unknown> = { updated_at: new Date().toISOString() }
  const mapping: Record<string, string> = {
    location: 'location', labelAr: 'label_ar', labelEn: 'label_en', href: 'href',
    isExternal: 'is_external', isActive: 'is_active', sortOrder: 'sort_order',
  }
  for (const [key, column] of Object.entries(mapping)) if (key in input) fields[column] = input[key]
  return fields
}

async function readConfiguration(includeInactive = false) {
  const admin = getAdminClient()
  let navigationQuery = admin.from('site_navigation').select('*').order('location').order('sort_order').order('created_at')
  if (!includeInactive) navigationQuery = navigationQuery.eq('is_active', true)
  const [settingsResult, navigationResult] = await Promise.all([
    admin.from('site_settings').select('*').eq('id', 1).maybeSingle(),
    navigationQuery,
  ])
  if (settingsResult.error || navigationResult.error) throw new ApiError(500, 'تعذر قراءة إعدادات الموقع', 'site_settings_read_failed')
  return {
    settings: settingsFromRow(settingsResult.data as Record<string, unknown> | null),
    navigation: (navigationResult.data || []).map((row) => navigationFromRow(row as Record<string, unknown>)),
  }
}

export default async function siteSettingsHandler(req: VercelRequest, res: VercelResponse) {
  setJsonHeaders(res)
  const scope = Array.isArray(req.query.scope) ? req.query.scope[0] : req.query.scope
  const isPublic = scope === 'public'
  const methods = isPublic ? ['GET'] : ['GET', 'PATCH', 'POST', 'DELETE']
  if (!methods.includes(req.method || '')) return methodNotAllowed(res, methods)

  try {
    if (isPublic) {
      await enforceRateLimit(req, 'site_settings_public_read', 240, 60)
      const configuration = await readConfiguration(false)
      res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=120, stale-while-revalidate=300')
      res.setHeader('X-API-Version', '1')
      return res.status(200).json({ data: configuration })
    }

    if (req.method === 'GET') {
      const auth = await requireRoles(req, [...SETTINGS_ROLES])
      await enforceRateLimit(req, 'site_settings_admin_read', 120, 60, auth.user.id)
      return res.status(200).json(await readConfiguration(true))
    }

    if (req.method === 'PATCH' && req.body && typeof req.body === 'object' && 'id' in req.body) {
      const auth = await requireRoles(req, [...CONTENT_ROLES])
      await enforceRateLimit(req, 'site_navigation_write', 60, 300, auth.user.id)
      const input = parseSiteRequest(navigationPatchSchema, req.body)
      const { data, error } = await getAdminClient().from('site_navigation').update(navigationToRow(input)).eq('id', input.id).select('*').maybeSingle()
      if (error) throw new ApiError(500, 'تعذر تحديث رابط التنقل', 'site_navigation_update_failed')
      if (!data) throw new ApiError(404, 'رابط التنقل غير موجود', 'site_navigation_not_found')
      await recordAudit(auth.user.id, null, 'SITE_NAVIGATION_UPDATED', { navigationId: input.id })
      return res.status(200).json({ item: navigationFromRow(data as Record<string, unknown>) })
    }

    if (req.method === 'PATCH') {
      const auth = await requireRoles(req, [...SETTINGS_ROLES])
      await enforceRateLimit(req, 'site_settings_write', 30, 300, auth.user.id)
      const input = parseSiteRequest(siteSettingsPatchSchema, req.body)
      const { data, error } = await getAdminClient().from('site_settings').update(settingsToRow(input, auth.user.id)).eq('id', 1).select('*').single()
      if (error) throw new ApiError(500, 'تعذر حفظ إعدادات الموقع', 'site_settings_update_failed')
      await recordAudit(auth.user.id, null, 'SITE_SETTINGS_UPDATED', { fields: Object.keys(input) })
      return res.status(200).json({ settings: settingsFromRow(data as Record<string, unknown>) })
    }

    if (req.method === 'POST') {
      const auth = await requireRoles(req, [...CONTENT_ROLES])
      await enforceRateLimit(req, 'site_navigation_write', 60, 300, auth.user.id)
      const input = parseSiteRequest(navigationCreateSchema, req.body)
      const { data, error } = await getAdminClient().from('site_navigation').insert({ ...navigationToRow(input), created_by: auth.user.id }).select('*').single()
      if (error) throw new ApiError(500, 'تعذر إضافة رابط التنقل', 'site_navigation_create_failed')
      await recordAudit(auth.user.id, null, 'SITE_NAVIGATION_CREATED', { navigationId: data.id })
      return res.status(201).json({ item: navigationFromRow(data as Record<string, unknown>) })
    }

    const auth = await requireRoles(req, [...CONTENT_ROLES])
    await enforceRateLimit(req, 'site_navigation_write', 60, 300, auth.user.id)
    const input = parseSiteRequest(navigationDeleteSchema, req.body)
    const { data, error } = await getAdminClient().from('site_navigation').delete().eq('id', input.id).select('id').maybeSingle()
    if (error) throw new ApiError(500, 'تعذر حذف رابط التنقل', 'site_navigation_delete_failed')
    if (!data) throw new ApiError(404, 'رابط التنقل غير موجود', 'site_navigation_not_found')
    await recordAudit(auth.user.id, null, 'SITE_NAVIGATION_DELETED', { navigationId: input.id })
    return res.status(204).end()
  } catch (error) {
    return sendError(res, error)
  }
}
