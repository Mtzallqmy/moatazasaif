import { z } from 'zod'
import { getProviderDefinition, isProviderType, PROVIDER_PROTOCOLS } from '../../shared/provider-registry'
import type { CredentialMode as SharedCredentialMode } from '../../shared/credential-mode'
import { ApiError } from './http'

const emptyToUndefined = (value: unknown) => typeof value === 'string' && value.trim() === '' ? undefined : value
const trimmed = (max: number) => z.string().trim().min(1).max(max)
const optionalTrimmed = (max: number) => z.preprocess(emptyToUndefined, z.string().trim().min(1).max(max).optional())
const optionalUrl = z.preprocess(emptyToUndefined, z.string().trim().url().max(1_000).optional())

export const credentialModeSchema = z.enum(['session', 'saved'])
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
  name: optionalTrimmed(80),
  model: optionalTrimmed(300).nullable().optional(),
  baseUrl: optionalUrl,
  protocol: providerProtocolSchema.optional(),
  isEnabled: z.boolean().optional(),
}).strict()

export const providerDeleteSchema = z.object({ id: z.string().uuid() }).strict()

export const chatMessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: trimmed(100_000),
}).strict()

const chatFields = {
  model: optionalTrimmed(300),
  messages: z.array(chatMessageSchema).min(1).max(100),
  stream: z.boolean().default(true),
}

export const chatRequestSchema = z.discriminatedUnion('credentialMode', [
  z.object({ ...savedSelectionFields, ...chatFields }).strict(),
  z.object({ ...sessionSelectionFields, ...chatFields }).strict(),
]).superRefine((body, context) => {
  const total = body.messages.reduce((sum, message) => sum + message.content.length, 0)
  if (total > 500_000) context.addIssue({ code: 'custom', path: ['messages'], message: 'سياق المحادثة أكبر من الحد المسموح' })
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
