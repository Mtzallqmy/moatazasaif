import { ApiError, optionalString, requireString } from './http.js'

export const CONTENT_ROLES = ['owner', 'admin', 'manager', 'editor'] as const
export const ARTICLE_STATUSES = ['draft', 'published', 'archived'] as const

export function queryString(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export function requireId(value: unknown) {
  const id = requireString(value, 'id', 64)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new ApiError(400, 'المعرف غير صالح', 'invalid_id')
  }
  return id
}

export function requireSlug(value: unknown, maxLength = 120) {
  const slug = requireString(value, 'slug', maxLength).toLowerCase()
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new ApiError(400, 'المسار يجب أن يحتوي على أحرف إنجليزية صغيرة وأرقام وشرطات فقط', 'invalid_slug')
  }
  return slug
}

export function optionalBoolean(value: unknown) {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new ApiError(400, 'قيمة منطقية غير صالحة', 'validation_error')
  return value
}

export function optionalInteger(value: unknown, min = -10_000, max = 10_000) {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new ApiError(400, 'قيمة رقمية غير صالحة', 'validation_error')
  return value as number
}

export function optionalSafeUrl(value: unknown) {
  const url = optionalString(value, 1_000)
  if (!url) return undefined
  if (url.startsWith('/') && !url.startsWith('//')) return url
  try {
    if (new URL(url).protocol !== 'https:') throw new Error('protocol')
    return url
  } catch {
    throw new ApiError(400, 'الرابط يجب أن يكون نسبيًا أو يستخدم HTTPS', 'invalid_url')
  }
}

export function optionalIsoDate(value: unknown) {
  const raw = optionalString(value, 64)
  if (!raw) return undefined
  const date = new Date(raw)
  if (!Number.isFinite(date.getTime())) throw new ApiError(400, 'التاريخ غير صالح', 'invalid_date')
  return date.toISOString()
}

export function pageParams(query: Record<string, string | string[] | undefined>) {
  const page = Math.max(1, Math.min(10_000, Number.parseInt(queryString(query.page) || '1', 10) || 1))
  const limit = Math.max(1, Math.min(50, Number.parseInt(queryString(query.limit) || '20', 10) || 20))
  return { page, limit, from: (page - 1) * limit, to: page * limit - 1 }
}

export function contentWriteError(error: { code?: string } | null, fallback: string): never {
  if (error?.code === '23505') throw new ApiError(409, 'المسار مستخدم مسبقًا', 'slug_conflict')
  if (error?.code === '23503') throw new ApiError(400, 'القسم المحدد غير موجود', 'invalid_section')
  throw new ApiError(500, fallback, 'content_write_failed')
}
