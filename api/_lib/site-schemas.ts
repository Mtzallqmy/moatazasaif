import { z } from 'zod'
import { SITE_FONT_STYLES } from '../../shared/site-settings.js'
import { ApiError } from './http.js'

const trimmed = (min: number, max: number) => z.string().trim().min(min).max(max)
const optionalTrimmed = (max: number) => z.union([z.string().trim().max(max), z.null()]).optional()
const color = z.string().regex(/^#[0-9a-f]{6}$/i)
const safeHref = z.string().trim().min(1).max(500).refine((value) => {
  if (/^\/[A-Za-z0-9/_?&=.#%~-]*$/.test(value)) return true
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch {
    return false
  }
}, 'الرابط يجب أن يكون مسارًا داخليًا أو رابط HTTPS آمنًا')

export const siteSettingsPatchSchema = z.object({
  siteNameAr: trimmed(2, 80).optional(),
  siteNameEn: trimmed(2, 80).optional(),
  taglineAr: trimmed(2, 180).optional(),
  taglineEn: trimmed(2, 180).optional(),
  footerTextAr: trimmed(2, 180).optional(),
  footerTextEn: trimmed(2, 180).optional(),
  primaryColor: color.optional(),
  accentColor: color.optional(),
  fontStyle: z.enum(SITE_FONT_STYLES).optional(),
  allowRegistration: z.boolean().optional(),
  blogEnabled: z.boolean().optional(),
  publicStatusEnabled: z.boolean().optional(),
  maintenanceMode: z.boolean().optional(),
  maintenanceMessageAr: optionalTrimmed(240),
  maintenanceMessageEn: optionalTrimmed(240),
}).strict().refine((value) => Object.keys(value).length > 0, 'أرسل إعدادًا واحدًا على الأقل')

export const navigationCreateSchema = z.object({
  location: z.enum(['header', 'footer']),
  labelAr: trimmed(1, 80),
  labelEn: trimmed(1, 80),
  href: safeHref,
  isExternal: z.boolean().default(false),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(-10000).max(10000).default(0),
}).strict()

export const navigationPatchSchema = navigationCreateSchema.partial().extend({ id: z.string().uuid() }).strict()
  .refine((value) => Object.keys(value).some((key) => key !== 'id'), 'أرسل تعديلاً واحدًا على الأقل')

export const navigationDeleteSchema = z.object({ id: z.string().uuid() }).strict()

export function parseSiteRequest<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    const issue = result.error.issues[0]
    throw new ApiError(400, issue?.message || 'بيانات إعدادات الموقع غير صالحة', 'validation_error', {
      field: issue?.path.join('.') || undefined,
    })
  }
  return result.data
}
