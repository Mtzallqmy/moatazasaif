export const CHAT_FILE_BUCKET = 'chat-files'
export const MAX_CHAT_FILE_BYTES = 3 * 1024 * 1024
export const MAX_CHAT_FILES_PER_MESSAGE = 5
export const MAX_PROJECT_FILE_BYTES = 2 * 1024 * 1024
export const MAX_PROJECT_FILES = 200

export const CHAT_IMAGE_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
] as const

export const CHAT_TEXT_MIME_TYPES = [
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
] as const

export const CHAT_FILE_MIME_TYPES = [
  ...CHAT_IMAGE_MIME_TYPES,
  ...CHAT_TEXT_MIME_TYPES,
] as const

export type ChatFileMimeType = (typeof CHAT_FILE_MIME_TYPES)[number]
export type ChatImageMimeType = (typeof CHAT_IMAGE_MIME_TYPES)[number]
export type ChatTextMimeType = (typeof CHAT_TEXT_MIME_TYPES)[number]

const extensionMimeTypes: Record<string, ChatFileMimeType> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  json: 'application/json',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  xml: 'application/xml',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  sql: 'application/sql',
  js: 'text/javascript',
  mjs: 'text/javascript',
  cjs: 'text/javascript',
  jsx: 'text/javascript',
  ts: 'text/typescript',
  mts: 'text/typescript',
  cts: 'text/typescript',
  tsx: 'text/typescript',
  py: 'text/x-python',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  sh: 'text/x-shellscript',
  bash: 'text/x-shellscript',
}

export function fileMimeType(name: string, browserType?: string): ChatFileMimeType | null {
  if ((CHAT_FILE_MIME_TYPES as readonly string[]).includes(browserType || '')) {
    return browserType as ChatFileMimeType
  }
  const extension = name.toLowerCase().split('.').pop() || ''
  return extensionMimeTypes[extension] || null
}

export function isImageMimeType(value: string): value is ChatImageMimeType {
  return (CHAT_IMAGE_MIME_TYPES as readonly string[]).includes(value)
}

export function safeFileName(value: string) {
  const normalized = value.normalize('NFKC').replace(/[\u0000-\u001f\u007f/\\]/g, '-').trim()
  return (normalized || 'file').slice(0, 200)
}

export function safeProjectPath(value: string) {
  const normalized = value.normalize('NFKC').replace(/\\/g, '/').replace(/^\/+/, '').trim()
  if (!normalized || normalized.length > 240 || /(^|\/)\.\.(\/|$)/.test(normalized) || /[\u0000-\u001f\u007f]/.test(normalized)) {
    return null
  }
  return normalized
}
