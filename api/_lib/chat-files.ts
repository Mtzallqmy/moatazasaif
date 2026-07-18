import { createHash, randomUUID } from 'node:crypto'
import { CHAT_FILE_BUCKET, CHAT_FILE_MIME_TYPES, MAX_CHAT_FILE_BYTES, isImageMimeType, safeFileName, type ChatFileMimeType } from '../../shared/file-contract.js'
import { ApiError } from './http.js'

export type ValidatedChatFile = {
  id: string
  name: string
  mimeType: ChatFileMimeType
  kind: 'image' | 'text'
  bytes: Buffer
  sha256: string
}

function validImageSignature(mimeType: ChatFileMimeType, bytes: Buffer) {
  if (mimeType === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  if (mimeType === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (mimeType === 'image/webp') return bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  return true
}

function looksLikeBinaryText(bytes: Buffer) {
  const sample = bytes.subarray(0, 8_192)
  if (sample.includes(0)) return true
  let controls = 0
  for (const value of sample) if (value < 32 && value !== 9 && value !== 10 && value !== 13) controls += 1
  return controls > Math.max(4, Math.ceil(sample.length * 0.01))
}

export function validateChatFile(input: { name: unknown; mimeType: unknown; dataBase64: unknown; size?: unknown }): ValidatedChatFile {
  if (typeof input.name !== 'string' || typeof input.mimeType !== 'string' || typeof input.dataBase64 !== 'string') {
    throw new ApiError(400, 'بيانات الملف غير مكتملة', 'file_validation_error')
  }
  if (!(CHAT_FILE_MIME_TYPES as readonly string[]).includes(input.mimeType)) {
    throw new ApiError(400, 'نوع الملف غير مدعوم', 'file_type_unsupported')
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.dataBase64) || input.dataBase64.length % 4 !== 0) {
    throw new ApiError(400, 'ترميز الملف غير صالح', 'file_encoding_invalid')
  }
  const bytes = Buffer.from(input.dataBase64, 'base64')
  if (!bytes.length || bytes.byteLength > MAX_CHAT_FILE_BYTES) {
    throw new ApiError(413, 'حجم الملف خارج الحد المسموح', 'file_size_invalid')
  }
  if (typeof input.size === 'number' && input.size !== bytes.byteLength) {
    throw new ApiError(400, 'حجم الملف لا يطابق البيانات', 'file_size_mismatch')
  }
  const mimeType = input.mimeType as ChatFileMimeType
  if (isImageMimeType(mimeType) && !validImageSignature(mimeType, bytes)) {
    throw new ApiError(400, 'توقيع الصورة لا يطابق نوعها', 'file_signature_invalid')
  }
  if (!isImageMimeType(mimeType)) {
    if (looksLikeBinaryText(bytes)) throw new ApiError(400, 'الملف النصي يحتوي بيانات ثنائية', 'binary_text_rejected')
    if (mimeType === 'application/json') {
      try { JSON.parse(bytes.toString('utf8')) } catch { throw new ApiError(400, 'ملف JSON غير صالح', 'invalid_json_file') }
    }
  }
  return {
    id: randomUUID(),
    name: safeFileName(input.name),
    mimeType,
    kind: isImageMimeType(mimeType) ? 'image' : 'text',
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}

export function chatFileStoragePath(userId: string, chatId: string, file: Pick<ValidatedChatFile, 'id' | 'name'>) {
  return `${userId}/${chatId}/${file.id}/${file.name}`
}

export function publicChatFile(row: Record<string, unknown>) {
  const id = String(row.id)
  return {
    fileId: id,
    type: row.kind === 'image' ? 'image' : 'text',
    mimeType: String(row.mime_type),
    name: String(row.original_name),
    size: Number(row.size_bytes),
    downloadUrl: `/api/files/${encodeURIComponent(id)}`,
  }
}

export { CHAT_FILE_BUCKET }
