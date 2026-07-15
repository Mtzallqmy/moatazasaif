import { z } from 'zod'

const uuid = z.string().uuid()
const name = z.string().trim().min(1).max(80)
const secret = z.string().trim().min(20).max(8_192)
const phoneNumberId = z.string().trim().regex(/^\d{5,30}$/)
const apiVersion = z.string().trim().regex(/^v\d{1,2}\.\d$/).default('v25.0')

export const externalIntegrationCreateSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('github'), name, token: secret }).strict(),
  z.object({ kind: z.literal('whatsapp'), name, accessToken: secret, phoneNumberId, apiVersion }).strict(),
])

export const externalIntegrationTestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('github'), token: secret }).strict(),
  z.object({ kind: z.literal('whatsapp'), accessToken: secret, phoneNumberId, apiVersion }).strict(),
])

export const externalIntegrationPatchSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('check'), integrationId: uuid }).strict(),
  z.object({ action: z.literal('repositories'), integrationId: uuid }).strict(),
  z.object({ action: z.literal('send-message'), integrationId: uuid, recipient: z.string().trim().regex(/^\+?\d{8,20}$/), message: z.string().trim().min(1).max(4_096) }).strict(),
  z.object({ action: z.literal('set-enabled'), integrationId: uuid, isEnabled: z.boolean() }).strict(),
])

export const externalIntegrationDeleteSchema = z.object({ id: uuid }).strict()

export type ExternalIntegrationCreateInput = z.infer<typeof externalIntegrationCreateSchema>
export type ExternalIntegrationTestInput = z.infer<typeof externalIntegrationTestSchema>
