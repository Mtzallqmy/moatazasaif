import { z } from 'zod'
import type { VercelRequest, VercelResponse } from '../_lib/vercel.js'
import { authenticate, getAdminClient } from '../_lib/supabase.js'
import { ApiError, methodNotAllowed, optionalString, requireString, sendError, setJsonHeaders } from '../_lib/http.js'

const chatIdSchema = z.string().uuid()
const roleSchema = z.enum(['user', 'assistant', 'system', 'tool'])
const credentialModeSchema = z.enum(['saved', 'platform'])
const messageSchema = z.object({
  id: z.string().uuid(),
  role: roleSchema,
  content: z.string().trim().min(1).max(200_000),
  model: z.string().trim().max(200).optional(),
  tokens: z.number().int().nonnegative().max(10_000_000).optional(),
  attachments: z.array(z.object({
    type: z.enum(['image', 'text']),
    mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp', 'text/plain', 'text/markdown', 'application/json']),
    name: z.string().max(255).optional(),
    size: z.number().int().nonnegative().max(10_000_000).optional(),
  })).max(8).optional(),
})

function mapChat(row: Record<string, unknown>) {
  return {
    id: row.id,
    title: row.title,
    providerId: row.provider_id || '',
    credentialMode: row.credential_mode === 'platform' ? 'platform' : 'saved',
    model: row.model || '',
    mode: row.mode === 'agent' ? 'agent' : 'chat',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: row.message_count || 0,
  }
}

function mapMessage(row: Record<string, unknown>) {
  return {
    id: row.id,
    chatId: row.chat_id,
    role: row.role,
    content: row.content,
    attachments: Array.isArray(row.attachments) ? row.attachments : undefined,
    createdAt: row.created_at,
    model: row.model || undefined,
    tokens: row.tokens || undefined,
  }
}

function routeParts(req: VercelRequest) {
  const value = req.query.chatRoute
  const raw = Array.isArray(value) ? value[0] : value
  return (raw || '').split('/').filter(Boolean)
}

async function ownedChat(chatId: string, userId: string) {
  const parsed = chatIdSchema.safeParse(chatId)
  if (!parsed.success) throw new ApiError(400, 'معرّف المحادثة غير صالح', 'invalid_chat_id')
  const { data, error } = await getAdminClient().from('chats').select('*').eq('id', parsed.data).eq('user_id', userId).maybeSingle()
  if (error) throw new ApiError(500, 'تعذر قراءة المحادثة', 'chat_read_failed')
  if (!data) throw new ApiError(404, 'المحادثة غير موجودة', 'chat_not_found')
  return data as Record<string, unknown>
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setJsonHeaders(res)
  try {
    const auth = await authenticate(req)
    const admin = getAdminClient()
    const parts = routeParts(req)

    if (parts.length === 0 && req.method === 'GET') {
      const { data, error } = await admin.from('chats').select('*').eq('user_id', auth.user.id).order('updated_at', { ascending: false })
      if (error) throw new ApiError(500, 'تعذر تحميل المحادثات', 'chat_list_failed')
      return res.status(200).json({ chats: (data || []).map((row) => mapChat(row as Record<string, unknown>)) })
    }

    if (parts.length === 0 && req.method === 'POST') {
      const providerId = optionalString(req.body?.providerId, 128)
      const credentialMode = credentialModeSchema.parse(req.body?.credentialMode || 'saved')
      const model = requireString(req.body?.model, 'model', 200)
      const mode = req.body?.mode === 'agent' ? 'agent' : 'chat'
      if (credentialMode === 'saved' && !providerId) throw new ApiError(400, 'المزود مطلوب للمحادثة المحفوظة', 'provider_required')
      if (providerId) {
        const { data: provider, error: providerError } = await admin.from('providers').select('id').eq('id', providerId).eq('user_id', auth.user.id).maybeSingle()
        if (providerError) throw new ApiError(500, 'تعذر التحقق من ملكية المزود', 'provider_lookup_failed')
        if (!provider) throw new ApiError(404, 'المزود غير موجود', 'provider_not_found')
      }
      const { data, error } = await admin.from('chats').insert({ user_id: auth.user.id, provider_id: credentialMode === 'platform' ? null : providerId, credential_mode: credentialMode, model, mode, title: 'محادثة جديدة' }).select('*').single()
      if (error || !data) throw new ApiError(500, 'تعذر إنشاء المحادثة', 'chat_create_failed')
      return res.status(201).json({ chat: mapChat(data as Record<string, unknown>) })
    }

    const chat = await ownedChat(parts[0] || '', auth.user.id)
    const chatId = String(chat.id)
    if (parts.length === 2 && parts[1] === 'messages' && req.method === 'GET') {
      const { data, error } = await admin.from('messages').select('*').eq('chat_id', chatId).eq('user_id', auth.user.id).order('created_at', { ascending: true })
      if (error) throw new ApiError(500, 'تعذر تحميل رسائل المحادثة', 'message_list_failed')
      return res.status(200).json({ messages: (data || []).map((row) => mapMessage(row as Record<string, unknown>)) })
    }

    if (parts.length === 2 && parts[1] === 'messages' && req.method === 'POST') {
      const message = messageSchema.parse(req.body)
      const { data, error } = await admin.from('messages').insert({ id: message.id, chat_id: chatId, user_id: auth.user.id, role: message.role, content: message.content, attachments: message.attachments || null, model: message.model || null, tokens: message.tokens || null }).select('*').single()
      if (error || !data) throw new ApiError(error?.code === '23505' ? 409 : 500, error?.code === '23505' ? 'الرسالة موجودة مسبقًا' : 'تعذر حفظ الرسالة', error?.code === '23505' ? 'message_duplicate' : 'message_insert_failed')
      await admin.from('chats').update({ message_count: Number(chat.message_count || 0) + 1, updated_at: new Date().toISOString() }).eq('id', chatId).eq('user_id', auth.user.id)
      return res.status(201).json({ message: mapMessage(data as Record<string, unknown>) })
    }

    if (parts.length === 1 && req.method === 'PATCH') {
      const patch: Record<string, unknown> = {}
      if (req.body?.title !== undefined) patch.title = requireString(req.body.title, 'title', 200)
      if (req.body?.model !== undefined) patch.model = requireString(req.body.model, 'model', 200)
      if (req.body?.mode !== undefined) patch.mode = req.body.mode === 'agent' ? 'agent' : 'chat'
      if (req.body?.message_count !== undefined) patch.message_count = z.number().int().nonnegative().max(10_000_000).parse(req.body.message_count)
      if (req.body?.credential_mode !== undefined) patch.credential_mode = credentialModeSchema.parse(req.body.credential_mode)
      if (req.body?.provider_id !== undefined) patch.provider_id = optionalString(req.body.provider_id, 128) || null
      if (!Object.keys(patch).length) throw new ApiError(400, 'لا توجد تغييرات صالحة', 'empty_chat_update')
      if (patch.provider_id) {
        const { data: provider, error: providerError } = await admin.from('providers').select('id').eq('id', patch.provider_id).eq('user_id', auth.user.id).maybeSingle()
        if (providerError) throw new ApiError(500, 'تعذر التحقق من ملكية المزود', 'provider_lookup_failed')
        if (!provider) throw new ApiError(404, 'المزود غير موجود', 'provider_not_found')
      }
      if (patch.credential_mode === 'platform') patch.provider_id = null
      patch.updated_at = new Date().toISOString()
      const { data, error } = await admin.from('chats').update(patch).eq('id', chatId).eq('user_id', auth.user.id).select('*').single()
      if (error || !data) throw new ApiError(500, 'تعذر تحديث المحادثة', 'chat_update_failed')
      return res.status(200).json({ chat: mapChat(data as Record<string, unknown>) })
    }

    if (parts.length === 1 && req.method === 'DELETE') {
      const { error } = await admin.from('chats').delete().eq('id', chatId).eq('user_id', auth.user.id)
      if (error) throw new ApiError(500, 'تعذر حذف المحادثة', 'chat_delete_failed')
      return res.status(204).send('')
    }

    return methodNotAllowed(res, ['GET', 'POST', 'PATCH', 'DELETE'])
  } catch (error) {
    return sendError(res, error)
  }
}
