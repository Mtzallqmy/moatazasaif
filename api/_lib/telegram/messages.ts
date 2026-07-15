import type { ProviderChatMessage } from '../providers/types.js'
import type { TelegramChat, TelegramMessage, TelegramUpdate } from './types.js'

export const TELEGRAM_MAX_MESSAGE_LENGTH = 4_096

export function splitTelegramMessage(value: string, maxLength = TELEGRAM_MAX_MESSAGE_LENGTH) {
  const text = String(value || '').trim()
  if (!text) return ['']
  const chars = Array.from(text)
  const chunks: string[] = []
  let offset = 0
  while (offset < chars.length) {
    const remaining = chars.length - offset
    if (remaining <= maxLength) {
      chunks.push(chars.slice(offset).join(''))
      break
    }
    const candidate = chars.slice(offset, offset + maxLength)
    const paragraphBreak = Math.max(candidate.lastIndexOf('\n\n'), candidate.lastIndexOf('\n'))
    const spaceBreak = candidate.lastIndexOf(' ')
    const cut = paragraphBreak >= Math.floor(maxLength * 0.55)
      ? paragraphBreak
      : spaceBreak >= Math.floor(maxLength * 0.65) ? spaceBreak : maxLength
    const chunk = candidate.slice(0, cut).join('').trim()
    chunks.push(chunk || candidate.slice(0, maxLength).join(''))
    offset += chunk ? Array.from(chunk).length : maxLength
    while (offset < chars.length && (chars[offset] === '\n' || chars[offset] === ' ')) offset += 1
  }
  return chunks
}

export function telegramCommand(text: string) {
  const match = /^\/(start|connect|help|new|status)(?:@([A-Za-z0-9_]{1,64}))?(?:\s+([\s\S]*))?$/i.exec(text.trim())
  if (!match) return null
  return { command: match[1].toLowerCase(), botUsername: match[2], args: (match[3] || '').trim() }
}

export function messageFromUpdate(update: TelegramUpdate): TelegramMessage | undefined {
  return update.message || update.edited_message || update.callback_query?.message
}

export function chatIdFromMessage(message?: TelegramMessage) {
  return message ? String(message.chat.id) : undefined
}

export function userIdFromMessage(message?: TelegramMessage) {
  return message?.from ? String(message.from.id) : undefined
}

export function publicChatFields(message: TelegramMessage) {
  return {
    telegram_chat_id: String(message.chat.id),
    telegram_user_id: message.from ? String(message.from.id) : null,
    chat_type: message.chat.type,
    username: message.chat.username || null,
    first_name: message.chat.first_name || null,
    last_name: message.chat.last_name || null,
    title: message.chat.title || null,
  }
}

export function publicChatFieldsFromChat(chat: TelegramChat) {
  return {
    telegram_chat_id: String(chat.id),
    telegram_user_id: chat.type === 'private' ? String(chat.id) : null,
    chat_type: chat.type,
    username: chat.username || null,
    first_name: chat.first_name || null,
    last_name: chat.last_name || null,
    title: chat.title || null,
  }
}

export function providerMessagesFromTelegramRows(rows: Array<{ role: 'user' | 'assistant'; content: string }>): ProviderChatMessage[] {
  return rows.map((row) => ({ role: row.role, content: row.content }))
}
