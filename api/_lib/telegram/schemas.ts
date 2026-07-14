import { z } from 'zod'

const uuid = z.string().uuid()
const name = z.string().trim().min(1).max(80)
const model = z.string().trim().min(1).max(300)

export const telegramCreateSchema = z.object({
  name,
  botToken: z.string().trim().min(20).max(300),
  providerId: uuid,
  model,
}).strict()

export const telegramTestSchema = z.object({ botToken: z.string().trim().min(20).max(300) }).strict()
export const telegramLinkCodeSchema = z.object({ integrationId: uuid }).strict()
export const telegramDiagnoseSchema = z.object({ integrationId: uuid }).strict()

export const telegramPatchSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('check-webhook'), integrationId: uuid }).strict(),
  z.object({ action: z.literal('register-webhook'), integrationId: uuid }).strict(),
  z.object({ action: z.literal('test-message'), integrationId: uuid, chatId: uuid }).strict(),
  z.object({ action: z.literal('chat-allowed'), integrationId: uuid, chatId: uuid, isAllowed: z.boolean() }).strict(),
  z.object({ action: z.literal('update'), integrationId: uuid, name: name.optional(), providerId: uuid.optional(), model: model.optional(), isEnabled: z.boolean().optional() }).strict(),
])

export const telegramDeleteSchema = z.object({ id: uuid }).strict()
