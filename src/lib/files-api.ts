import type { ChatAttachment, ChatAttachmentMetadata } from '../types'
import { apiJson, authHeaders } from './api'

function bytesToBase64(bytes: Uint8Array) {
  let binary = ''
  const chunk = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk))
  }
  return btoa(binary)
}

function attachmentBase64(attachment: ChatAttachment) {
  if (attachment.type === 'image') {
    const comma = attachment.dataUrl.indexOf(',')
    if (comma < 0) throw new Error('invalid_image_data')
    return attachment.dataUrl.slice(comma + 1)
  }
  return bytesToBase64(new TextEncoder().encode(attachment.text))
}

export async function uploadChatAttachments(chatId: string, messageId: string, attachments: ChatAttachment[]) {
  const uploaded: ChatAttachmentMetadata[] = []
  try {
    for (const attachment of attachments) {
      const body = await apiJson<{ file: ChatAttachmentMetadata }>('/api/files', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify({
          chatId,
          messageId,
          name: attachment.name || 'attachment',
          mimeType: attachment.mimeType,
          size: attachment.size,
          dataBase64: attachmentBase64(attachment),
        }),
      })
      uploaded.push(body.file)
    }
    return uploaded
  } catch (error) {
    await Promise.allSettled(uploaded.flatMap((file) => file.fileId ? [deleteChatFile(file.fileId)] : []))
    throw error
  }
}

export async function deleteChatFile(fileId: string) {
  await apiJson('/api/files/' + encodeURIComponent(fileId), { method: 'DELETE', headers: await authHeaders(false) })
}
