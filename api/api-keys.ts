import { z } from 'zod'
import type { VercelRequest, VercelResponse } from './_lib/vercel.js'
import { ApiError, methodNotAllowed, sendError, setJsonHeaders } from './_lib/http.js'
import { authenticate, getAdminClient } from './_lib/supabase.js'
import { API_SCOPES, generateApiKey } from './_lib/public-api.js'

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  environment: z.enum(['live','test']).default('live'),
  scopes: z.array(z.enum(API_SCOPES)).min(1).max(API_SCOPES.length),
  allowedModels: z.array(z.string().trim().min(1).max(300)).max(200).default([]),
  allowedServices: z.array(z.string().trim().min(1).max(80)).max(50).default([]),
  allowedIps: z.array(z.string().trim().min(3).max(64)).max(50).default([]),
  rateLimitPerMinute: z.number().int().min(1).max(10_000).default(60),
  dailyRequestLimit: z.number().int().min(1).max(10_000_000).nullable().optional(),
  monthlyRequestLimit: z.number().int().min(1).max(100_000_000).nullable().optional(),
  monthlyCreditLimit: z.number().min(0).max(1_000_000_000).nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
}).strict()

const actionSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(['rotate','revoke']),
}).strict()

const publicColumns = 'id,name,environment,key_prefix,key_preview,scopes,allowed_models,allowed_services,allowed_ips,rate_limit_per_minute,daily_request_limit,monthly_request_limit,monthly_credit_limit,expires_at,last_used_at,last_used_ip,revoked_at,created_at,updated_at'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setJsonHeaders(res)
  try {
    const auth = await authenticate(req)
    const admin = getAdminClient()
    if (req.method === 'GET') {
      const { data, error } = await admin.from('api_keys').select(publicColumns).eq('user_id', auth.user.id).order('created_at', { ascending: false })
      if (error) throw new ApiError(500, 'تعذر قراءة مفاتيح API', 'api_keys_read_failed')
      return res.status(200).json({ apiKeys: data || [] })
    }
    if (req.method === 'POST') {
      const parsed = createSchema.safeParse(req.body)
      if (!parsed.success) throw new ApiError(422, 'بيانات مفتاح API غير صالحة', 'validation_error', { issues: parsed.error.issues })
      const generated = generateApiKey(parsed.data.environment)
      const { data, error } = await admin.from('api_keys').insert({
        user_id: auth.user.id,
        name: parsed.data.name,
        environment: parsed.data.environment,
        key_prefix: generated.prefix,
        key_hash: generated.hash,
        key_preview: generated.preview,
        scopes: parsed.data.scopes,
        allowed_models: parsed.data.allowedModels,
        allowed_services: parsed.data.allowedServices,
        allowed_ips: parsed.data.allowedIps,
        rate_limit_per_minute: parsed.data.rateLimitPerMinute,
        daily_request_limit: parsed.data.dailyRequestLimit ?? null,
        monthly_request_limit: parsed.data.monthlyRequestLimit ?? null,
        monthly_credit_limit: parsed.data.monthlyCreditLimit ?? null,
        expires_at: parsed.data.expiresAt ?? null,
      }).select(publicColumns).single()
      if (error) throw new ApiError(500, 'تعذر إنشاء مفتاح API', 'api_key_create_failed')
      return res.status(201).json({ apiKey: data, secret: generated.raw, warning: 'انسخ المفتاح الآن. لن تتمكن من رؤيته مرة أخرى.' })
    }
    if (req.method === 'PATCH') {
      const parsed = actionSchema.safeParse(req.body)
      if (!parsed.success) throw new ApiError(422, 'بيانات العملية غير صالحة', 'validation_error')
      const { data: current, error: readError } = await admin.from('api_keys').select('*').eq('id', parsed.data.id).eq('user_id', auth.user.id).maybeSingle()
      if (readError || !current) throw new ApiError(404, 'مفتاح API غير موجود', 'resource_not_owned')
      if (parsed.data.action === 'revoke') {
        const { data, error } = await admin.from('api_keys').update({ revoked_at: new Date().toISOString() }).eq('id', current.id).eq('user_id', auth.user.id).select(publicColumns).single()
        if (error) throw new ApiError(500, 'تعذر إلغاء المفتاح', 'api_key_revoke_failed')
        return res.status(200).json({ apiKey: data })
      }
      const generated = generateApiKey(current.environment)
      const { data, error } = await admin.from('api_keys').update({ key_prefix: generated.prefix, key_hash: generated.hash, key_preview: generated.preview, revoked_at: null, last_used_at: null, last_used_ip: null }).eq('id', current.id).eq('user_id', auth.user.id).select(publicColumns).single()
      if (error) throw new ApiError(500, 'تعذر تدوير المفتاح', 'api_key_rotate_failed')
      return res.status(200).json({ apiKey: data, secret: generated.raw, warning: 'انسخ المفتاح الآن. لن تتمكن من رؤيته مرة أخرى.' })
    }
    return methodNotAllowed(res, ['GET','POST','PATCH'])
  } catch (error) {
    return sendError(res, error)
  }
}
