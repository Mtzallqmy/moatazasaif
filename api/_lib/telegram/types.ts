import { z } from 'zod'

export interface TelegramApiErrorDetails {
  method: string
  description: string
  errorCode?: number
  retryAfter?: number
  status?: number
}

export class TelegramApiError extends Error {
  constructor(public readonly details: TelegramApiErrorDetails) {
    super(details.description)
    this.name = 'TelegramApiError'
  }
}

export interface TelegramBotUser {
  id: number | string
  is_bot: boolean
  first_name: string
  username?: string
}

export interface TelegramWebhookInfo {
  url: string
  pending_update_count: number
  last_error_message?: string
  last_error_date?: number
  max_connections?: number
  ip_address?: string
}

export interface TelegramChat {
  id: number | string
  type: string
  username?: string
  first_name?: string
  last_name?: string
  title?: string
}

export interface TelegramMessage {
  message_id: number
  from?: { id: number | string; is_bot?: boolean; username?: string; first_name?: string; last_name?: string }
  chat: TelegramChat
  date?: number
  text?: string
}

export interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
  edited_message?: TelegramMessage
  callback_query?: {
    id: string
    from?: { id: number | string; is_bot?: boolean; username?: string; first_name?: string; last_name?: string }
    message?: TelegramMessage
    data?: string
  }
}

const telegramId = z.union([z.number().int(), z.string().trim().min(1).max(32)])
const telegramUser = z.object({
  id: telegramId,
  is_bot: z.boolean().optional(),
  username: z.string().max(255).optional(),
  first_name: z.string().max(255).optional(),
  last_name: z.string().max(255).optional(),
}).passthrough()
const telegramChat = z.object({
  id: telegramId,
  type: z.string().min(1).max(32),
  username: z.string().max(255).optional(),
  first_name: z.string().max(255).optional(),
  last_name: z.string().max(255).optional(),
  title: z.string().max(255).optional(),
}).passthrough()
const telegramMessage = z.object({
  message_id: z.number().int(),
  from: telegramUser.optional(),
  chat: telegramChat,
  date: z.number().int().optional(),
  text: z.string().max(100_000).optional(),
}).passthrough()

export const telegramUpdateSchema = z.object({
  update_id: z.number().int().nonnegative(),
  message: telegramMessage.optional(),
  edited_message: telegramMessage.optional(),
  callback_query: z.object({
    id: z.string().min(1).max(255),
    from: telegramUser.optional(),
    message: telegramMessage.optional(),
    data: z.string().max(4_096).optional(),
  }).passthrough().optional(),
}).passthrough()

export type TelegramUpdateInput = z.infer<typeof telegramUpdateSchema>

export interface TelegramIntegrationRow {
  id: string
  user_id: string
  name: string
  bot_id: string
  bot_username: string | null
  bot_first_name: string | null
  encrypted_bot_token: { ciphertext: string; iv: string; authTag: string }
  webhook_secret_hash: string
  provider_id: string
  model: string
  is_enabled: boolean
  status: 'registering' | 'connected' | 'error' | 'disabled'
  webhook_url: string | null
  pending_update_count: number | null
  last_error_message: string | null
  last_webhook_checked_at: string | null
  last_update_at: string | null
  created_at: string
  updated_at: string
}

export interface TelegramChatLinkRow {
  id: string
  integration_id: string
  telegram_chat_id: string
  telegram_user_id: string | null
  chat_type: string | null
  username: string | null
  first_name: string | null
  last_name: string | null
  title: string | null
  is_allowed: boolean
  linked_at: string
  last_message_at: string | null
}

export interface TelegramPublicChatLink {
  id: string
  telegramChatId: string
  telegramUserId?: string
  chatType?: string
  username?: string
  firstName?: string
  lastName?: string
  title?: string
  isAllowed: boolean
  linkedAt: string
  lastMessageAt?: string
}

export interface TelegramPublicIntegration {
  id: string
  name: string
  botId: string
  botUsername?: string
  botFirstName?: string
  providerId: string
  model: string
  status: TelegramIntegrationRow['status']
  isEnabled: boolean
  webhookUrl?: string
  pendingUpdateCount?: number
  lastErrorMessage?: string
  lastWebhookCheckedAt?: string
  lastUpdateAt?: string
  createdAt: string
  updatedAt: string
  chats: TelegramPublicChatLink[]
}
