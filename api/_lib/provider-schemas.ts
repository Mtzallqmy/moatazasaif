import { z } from 'zod'
import { getProviderDefinition, isProviderType, PROVIDER_PROTOCOLS } from '../../shared/provider-registry.js'
import type { CredentialMode as SharedCredentialMode } from '../../shared/credential-mode.js'
import { ApiError } from './http.js'

const emptyToUndefined = (value: unknown) => typeof value === 'string' && value.trim() === '' ? undefined : value
const trimmed = (max: number) => z.string().trim().min(1).max(max)
const optionalTrimmed = (max: number) => z.preprocess(emptyToUndefined, z.string().trim().min(1).max(max).optional())
const optionalUrl = z.preprocess(emptyToUndefined, z.string().trim().url().max(1_000).optional())

export const credentialModeSchema = z.enum(['session', 'saved', 'platform'])
export type CredentialMode = SharedCredentialMode

export const providerProtocolSchema = z.enum(PROVIDER_PROTOCOLS)
export type ProviderProtocol = z.infer<typeof providerProtocolSchema>
export type ProviderProtocolInput = ProviderProtocol

export const providerTypeSchema = trimmed(40).refine(isProviderType, 'نوع المزود غير مدعوم')

export const ephemeralProviderSchema = z.object({
  type: providerTypeSchema,
  protocol: providerProtocolSchema.optional(),
  baseUrl: optionalUrl,
  apiKey: trimmed(8_192),
  model: optionalTrimmed(300),
}).strict().superRefine((provider, context) => validateProviderAddress(provider, context))

export type EphemeralProviderConfig = z.infer<typeof ephemeralProviderSchema>

const savedSelectionFields = {
  credentialMode: z.literal('saved'),
  providerId: z.string().uuid(),
}

const sessionSelectionFields = {
  credentialMode: z.literal('session'),
  provider: ephemeralProviderSchema,
}

const platformSelectionFields = {
  credentialMode: z.literal('platform'),
}

export const providerSelectionSchema = z.discriminatedUnion('credentialMode', [
  z.object(savedSelectionFields).strict(),
  z.object(sessionSelectionFields).strict(),
])

export const providerTestRequestSchema = providerSelectionSchema

export const providerCreateSchema = z.object({
  credentialMode: z.literal('saved'),
  name: trimmed(80),
  type: providerTypeSchema,
  protocol: providerProtocolSchema.optional(),
  baseUrl: optionalUrl,
  apiKey: trimmed(8_192),
  model: optionalTrimmed(300),
}).strict().superRefine((provider, context) => validateProviderAddress(provider, context))

export const providerPatchSchema = z.object({
  id: z.string().uuid(),
  apiKey: optionalTrimmed(8_192),
  name: optionalTrimmed(80),
  model: optionalTrimmed(300).nullable().optional(),
  baseUrl: optionalUrl,
  protocol: providerProtocolSchema.optional(),
  isEnabled: z.boolean().optional(),
  priority: z.number().int().min(0).max(100_000).optional(),
  timeout: z.number().int().min(5_000).max(45_000).optional(),
  retries: z.number().int().min(0).max(5).optional(),
  maxConnections: z.number().int().min(1).max(100).optional(),
  tags: z.array(trimmed(40)).max(50).optional(),
}).strict()

export const providerManagerActionSchema = z.object({
  action: z.enum(['test', 'health', 'discover', 'reload', 'reset-circuit']),
  providerId: z.string().uuid(),
}).strict()

export const providerPlatformConfigSchema = z.object({
  providerId: z.string().uuid(),
  isShared: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  dailyRequestLimit: z.number().int().min(1).max(100_000).optional(),
  dailyTokenLimit: z.number().int().min(1_000).max(1_000_000_000).optional(),
}).strict().refine((value) => Object.keys(value).some((key) => key !== 'providerId'), {
  message: 'يجب إرسال إعداد منصة واحد على الأقل',
})

export const providerDeleteSchema = z.object({ id: z.string().uuid() }).strict()

const attachmentName = z.string().trim().min(1).max(200).optional()
const attachmentSize = z.number().int().min(0).max(3 * 1024 * 1024).optional()
const imageMimeType = z.enum(['image/png', 'image/jpeg', 'image/webp'])
const textMimeType = z.enum([
  'text/plain',
  'text/markdown',
  'application/json',
  'text/csv',
  'text/tab-separated-values',
  'application/xml',
  'text/xml',
  'application/yaml',
  'text/yaml',
  'application/x-yaml',
  'application/sql',
  'text/javascript',
  'application/javascript',
  'text/typescript',
  'application/typescript',
  'text/x-python',
  'text/html',
  'text/css',
  'text/x-shellscript',
])
const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024

function decodedImage(value: string) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value)
  if (!match || match[2].length % 4 !== 0) return undefined
  return { mimeType: match[1], bytes: Buffer.from(match[2], 'base64') }
}

function roughlyMatchesSize(declared: number | undefined, actual: number) {
  if (declared === undefined) return true
  return Math.abs(declared - actual) <= Math.max(32, Math.ceil(actual * 0.01))
}

function looksLikeBinaryText(value: string) {
  const sample = value.slice(0, 8_192)
  if (sample.includes('\u0000')) return true
  let controlCharacters = 0
  for (let index = 0; index < sample.length; index += 1) {
    const code = sample.charCodeAt(index)
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) controlCharacters += 1
  }
  return controlCharacters > Math.max(4, Math.ceil(sample.length * 0.01))
}

export const chatAttachmentSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('image'),
    mimeType: imageMimeType,
    dataUrl: z.string().max(Math.ceil(MAX_ATTACHMENT_BYTES * 4 / 3) + 100),
    name: attachmentName,
    size: attachmentSize,
  }).strict().superRefine((attachment, context) => {
    const decoded = decodedImage(attachment.dataUrl)
    if (!decoded || decoded.mimeType !== attachment.mimeType) {
      context.addIssue({ code: 'custom', path: ['dataUrl'], message: 'بيانات الصورة أو MIME غير صالحة' })
      return
    }
    if (decoded.bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      context.addIssue({ code: 'custom', path: ['dataUrl'], message: 'حجم الصورة أكبر من الحد المسموح' })
    }
    const validMagic = attachment.mimeType === 'image/png'
      ? decoded.bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      : attachment.mimeType === 'image/jpeg'
        ? decoded.bytes[0] === 0xff && decoded.bytes[1] === 0xd8 && decoded.bytes[2] === 0xff
        : decoded.bytes.subarray(0, 4).toString('ascii') === 'RIFF' && decoded.bytes.subarray(8, 12).toString('ascii') === 'WEBP'
    if (!validMagic) context.addIssue({ code: 'custom', path: ['dataUrl'], message: 'توقيع ملف الصورة لا يطابق MIME' })
    if (!roughlyMatchesSize(attachment.size, decoded.bytes.byteLength)) {
      context.addIssue({ code: 'custom', path: ['size'], message: 'الحجم المصرح لا يطابق حمولة الصورة' })
    }
  }),
  z.object({
    type: z.literal('text'),
    mimeType: textMimeType,
    text: z.string().min(1).max(MAX_ATTACHMENT_BYTES),
    name: attachmentName,
    size: attachmentSize,
  }).strict().superRefine((attachment, context) => {
    const actual = Buffer.byteLength(attachment.text, 'utf8')
    if (actual > MAX_ATTACHMENT_BYTES) context.addIssue({ code: 'custom', path: ['text'], message: 'حجم الملف النصي أكبر من الحد المسموح' })
    if (!roughlyMatchesSize(attachment.size, actual)) context.addIssue({ code: 'custom', path: ['size'], message: 'الحجم المصرح لا يطابق النص' })
    if (looksLikeBinaryText(attachment.text)) context.addIssue({ code: 'custom', path: ['text'], message: 'الملف يحتوي بيانات ثنائية غير مسموحة' })
    if (attachment.mimeType === 'application/json') {
      try { JSON.parse(attachment.text) } catch { context.addIssue({ code: 'custom', path: ['text'], message: 'مرفق JSON غير صالح' }) }
    }
  }),
])

export const chatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string().trim().max(100_000),
  attachments: z.array(chatAttachmentSchema).max(5).optional(),
}).strict().superRefine((message, context) => {
  if (!message.content && !message.attachments?.length) {
    context.addIssue({ code: 'custom', path: ['content'], message: 'الرسالة أو المرفق مطلوب' })
  }
})

const chatFields = {
  model: optionalTrimmed(300),
  messages: z.array(chatMessageSchema).min(1).max(100),
  stream: z.boolean().default(true),
}

export const chatRequestSchema = z.discriminatedUnion('credentialMode', [
  z.object({ ...savedSelectionFields, ...chatFields }).strict(),
  z.object({ ...sessionSelectionFields, ...chatFields }).strict(),
  z.object({ ...platformSelectionFields, messages: chatFields.messages, stream: chatFields.stream }).strict(),
]).superRefine((body, context) => {
  const total = body.messages.reduce((sum, message) => sum + message.content.length, 0)
  if (total > 500_000) context.addIssue({ code: 'custom', path: ['messages'], message: 'سياق المحادثة أكبر من الحد المسموح' })
  let attachmentBytes = 0
  body.messages.forEach((message, index) => {
    if (!message.attachments?.length) return
    if (index !== body.messages.length - 1 || message.role !== 'user') {
      context.addIssue({ code: 'custom', path: ['messages', index, 'attachments'], message: 'المرفقات مسموحة في آخر رسالة مستخدم فقط' })
    }
    for (const attachment of message.attachments) {
      if (attachment.type === 'text') attachmentBytes += Buffer.byteLength(attachment.text, 'utf8')
      else attachmentBytes += decodedImage(attachment.dataUrl)?.bytes.byteLength || MAX_ATTACHMENT_BYTES + 1
    }
  })
  if (attachmentBytes > MAX_ATTACHMENT_BYTES) {
    context.addIssue({ code: 'custom', path: ['messages'], message: 'إجمالي المرفقات أكبر من 3MB' })
  }
})

export type ProviderSelection = z.infer<typeof providerSelectionSchema>
export type ChatRequest = z.infer<typeof chatRequestSchema>

function validateProviderAddress(
  provider: { type: string; protocol?: ProviderProtocol; baseUrl?: string },
  context: z.RefinementCtx,
) {
  const definition = getProviderDefinition(provider.type)
  if (definition?.requiresCustomBaseUrl && !provider.baseUrl) {
    context.addIssue({ code: 'custom', path: ['baseUrl'], message: 'Base URL مطلوب لهذا المزود' })
  }
  if (provider.type === 'custom' && !provider.protocol) {
    context.addIssue({ code: 'custom', path: ['protocol'], message: 'البروتوكول مطلوب للمزود المخصص' })
  }
  if (definition && provider.type !== 'custom' && provider.protocol && provider.protocol !== definition.protocol) {
    context.addIssue({ code: 'custom', path: ['protocol'], message: `البروتوكول لا يطابق نوع المزود (${definition.protocol})` })
  }
}

export function parseRequest<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (result.success) return result.data
  throw new ApiError(400, 'بيانات الطلب غير صالحة', 'validation_error', {
    issues: result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
  })
}
