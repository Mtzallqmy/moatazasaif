import type { VercelRequest, VercelResponse } from '../_lib/vercel.js'
import { authenticate, getAdminClient } from '../_lib/supabase.js'
import { ApiError, methodNotAllowed, sendError, setJsonHeaders } from '../_lib/http.js'
import { enforceRateLimit } from '../_lib/rate-limit.js'
import { CHAT_FILE_BUCKET, chatFileStoragePath, publicChatFile, validateChatFile } from '../_lib/chat-files.js'

function routeId(req: VercelRequest) {
  const value = Array.isArray(req.query.fileRoute) ? req.query.fileRoute[0] : req.query.fileRoute
  return value?.split('/').filter(Boolean)[0]
}

async function ownedFile(id: string, userId: string) {
  const { data, error } = await getAdminClient().from('chat_files').select('*').eq('id', id).eq('user_id', userId).maybeSingle()
  if (error) throw new ApiError(500, 'تعذر قراءة الملف', 'file_read_failed')
  if (!data) throw new ApiError(404, 'الملف غير موجود', 'file_not_found')
  return data as Record<string, unknown>
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const auth = await authenticate(req)
    const admin = getAdminClient()
    const id = routeId(req)

    if (!id && req.method === 'POST') {
      setJsonHeaders(res)
      await enforceRateLimit(req, 'chat_file_upload', 30, 300, auth.user.id)
      const chatId = typeof req.body?.chatId === 'string' ? req.body.chatId : ''
      const messageId = typeof req.body?.messageId === 'string' ? req.body.messageId : ''
      if (!/^[0-9a-f-]{36}$/i.test(chatId) || !/^[0-9a-f-]{36}$/i.test(messageId)) {
        throw new ApiError(400, 'معرّف المحادثة أو الرسالة غير صالح', 'file_parent_invalid')
      }
      const { data: chat, error: chatError } = await admin.from('chats').select('id').eq('id', chatId).eq('user_id', auth.user.id).maybeSingle()
      if (chatError) throw new ApiError(500, 'تعذر التحقق من المحادثة', 'chat_lookup_failed')
      if (!chat) throw new ApiError(404, 'المحادثة غير موجودة', 'chat_not_found')

      const file = validateChatFile(req.body || {})
      const storagePath = chatFileStoragePath(auth.user.id, chatId, file)
      const { error: uploadError } = await admin.storage.from(CHAT_FILE_BUCKET).upload(storagePath, file.bytes, {
        contentType: file.mimeType,
        cacheControl: '3600',
        upsert: false,
      })
      if (uploadError) throw new ApiError(502, 'تعذر رفع الملف إلى التخزين الخاص', 'file_storage_upload_failed')
      const { data, error } = await admin.from('chat_files').insert({
        id: file.id,
        user_id: auth.user.id,
        chat_id: chatId,
        message_id: messageId,
        storage_path: storagePath,
        original_name: file.name,
        mime_type: file.mimeType,
        kind: file.kind,
        size_bytes: file.bytes.byteLength,
        sha256: file.sha256,
      }).select('*').single()
      if (error || !data) {
        await admin.storage.from(CHAT_FILE_BUCKET).remove([storagePath])
        throw new ApiError(500, 'تعذر تسجيل الملف', 'file_metadata_create_failed')
      }
      return res.status(201).json({ file: publicChatFile(data as Record<string, unknown>) })
    }

    if (id && req.method === 'GET') {
      await enforceRateLimit(req, 'chat_file_download', 120, 60, auth.user.id)
      const file = await ownedFile(id, auth.user.id)
      if (req.query.mode === 'metadata') {
        setJsonHeaders(res)
        return res.status(200).json({ file: publicChatFile(file) })
      }
      const { data, error } = await admin.storage.from(CHAT_FILE_BUCKET).download(String(file.storage_path))
      if (error || !data) throw new ApiError(502, 'تعذر تنزيل الملف', 'file_storage_download_failed')
      const bytes = Buffer.from(await data.arrayBuffer())
      const download = req.query.download === '1'
      const safeName = String(file.original_name).replace(/["\\\r\n]/g, '-')
      res.setHeader('Content-Type', String(file.mime_type))
      res.setHeader('Content-Length', String(bytes.byteLength))
      res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(safeName)}`)
      res.setHeader('Cache-Control', 'private, max-age=300')
      res.setHeader('X-Content-Type-Options', 'nosniff')
      return res.status(200).send(bytes)
    }

    if (id && req.method === 'DELETE') {
      setJsonHeaders(res)
      await enforceRateLimit(req, 'chat_file_delete', 30, 300, auth.user.id)
      const file = await ownedFile(id, auth.user.id)
      const { error: storageError } = await admin.storage.from(CHAT_FILE_BUCKET).remove([String(file.storage_path)])
      if (storageError) throw new ApiError(502, 'تعذر حذف الملف من التخزين', 'file_storage_delete_failed')
      const { error } = await admin.from('chat_files').delete().eq('id', id).eq('user_id', auth.user.id)
      if (error) throw new ApiError(500, 'تعذر حذف سجل الملف', 'file_delete_failed')
      return res.status(204).send('')
    }

    setJsonHeaders(res)
    return methodNotAllowed(res, ['GET', 'POST', 'DELETE'])
  } catch (error) {
    setJsonHeaders(res)
    return sendError(res, error)
  }
}
