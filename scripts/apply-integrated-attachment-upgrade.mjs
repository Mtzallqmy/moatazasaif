// One-shot branch upgrade runner. The workflow removes this file after successful verification.
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function write(relativePath, content) {
  const target = path.join(root, relativePath)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
}

function replaceExact(relativePath, before, after, label) {
  const current = read(relativePath)
  if (!current.includes(before)) throw new Error(`Could not locate ${label} in ${relativePath}`)
  write(relativePath, current.replace(before, after))
}

const oldAttachmentPolicy = `const MAX_ATTACHMENT_COUNT = 3;
const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;
const ATTACHMENT_ACCEPT =
  "image/png,image/jpeg,image/webp,text/plain,text/markdown,application/json,.txt,.md,.markdown,.json";
const ALLOWED_ATTACHMENT_TYPES = new Set<ChatAttachmentMimeType>([
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
  "text/markdown",
  "application/json",
]);

function attachmentType(file: File): ChatAttachmentMimeType | null {
  if (ALLOWED_ATTACHMENT_TYPES.has(file.type as ChatAttachmentMimeType)) {
    return file.type as ChatAttachmentMimeType;
  }
  const extension = file.name.toLowerCase().split(".").pop();
  if (extension === "txt") return "text/plain";
  if (extension === "md" || extension === "markdown") return "text/markdown";
  if (extension === "json") return "application/json";
  return null;
}`

const newAttachmentPolicy = `const MAX_ATTACHMENT_COUNT = 3;
const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;
const ATTACHMENT_ACCEPT = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
  "text/markdown",
  "application/json",
  "text/csv",
  "text/tab-separated-values",
  "application/xml",
  "text/xml",
  "application/yaml",
  "text/yaml",
  "application/x-yaml",
  "application/sql",
  "text/javascript",
  "application/javascript",
  "text/typescript",
  "application/typescript",
  "text/x-python",
  "text/html",
  "text/css",
  "text/x-shellscript",
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".csv",
  ".tsv",
  ".xml",
  ".yaml",
  ".yml",
  ".sql",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".py",
  ".html",
  ".htm",
  ".css",
  ".sh",
  ".bash",
].join(",");
const ALLOWED_ATTACHMENT_TYPES = new Set<ChatAttachmentMimeType>([
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
  "text/markdown",
  "application/json",
  "text/csv",
  "text/tab-separated-values",
  "application/xml",
  "text/xml",
  "application/yaml",
  "text/yaml",
  "application/x-yaml",
  "application/sql",
  "text/javascript",
  "application/javascript",
  "text/typescript",
  "application/typescript",
  "text/x-python",
  "text/html",
  "text/css",
  "text/x-shellscript",
]);
const TEXT_ATTACHMENT_BY_EXTENSION: Readonly<Record<string, ChatAttachmentMimeType>> = {
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  json: "application/json",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  xml: "application/xml",
  yaml: "application/yaml",
  yml: "application/yaml",
  sql: "application/sql",
  js: "text/javascript",
  jsx: "text/javascript",
  mjs: "text/javascript",
  cjs: "text/javascript",
  ts: "text/typescript",
  tsx: "text/typescript",
  py: "text/x-python",
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  sh: "text/x-shellscript",
  bash: "text/x-shellscript",
};

function attachmentType(file: File): ChatAttachmentMimeType | null {
  if (ALLOWED_ATTACHMENT_TYPES.has(file.type as ChatAttachmentMimeType)) {
    return file.type as ChatAttachmentMimeType;
  }
  const extension = file.name.toLowerCase().split(".").pop() || "";
  return TEXT_ATTACHMENT_BY_EXTENSION[extension] || null;
}`

replaceExact('src/pages/Chat.tsx', oldAttachmentPolicy, newAttachmentPolicy, 'client attachment policy')

replaceExact(
  'src/pages/Chat.tsx',
  `function readAsDataUrl(file: File) {`,
  `function looksLikeBinaryText(text: string) {
  const sample = text.slice(0, 8192);
  if (sample.includes("\\u0000")) return true;
  let controlCharacters = 0;
  for (let index = 0; index < sample.length; index += 1) {
    const code = sample.charCodeAt(index);
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
      controlCharacters += 1;
    }
  }
  return controlCharacters > Math.max(4, Math.ceil(sample.length * 0.01));
}

function readAsDataUrl(file: File) {`,
  'binary-text detector',
)

replaceExact(
  'src/pages/Chat.tsx',
  `          const text = await file.text();
          if (!text.length) throw new Error("empty_text_file");`,
  `          const text = await file.text();
          if (!text.length) throw new Error("empty_text_file");
          if (looksLikeBinaryText(text)) throw new Error("binary_text_file");`,
  'client binary-text validation',
)

replaceExact(
  'src/pages/Chat.tsx',
  `"اكتب رسالة أو أرفق صورة أو ملفًا نصيًا للبدء.",
                       "Type a message or attach an image or text file to begin.",`,
  `"اكتب رسالة أو أرفق صورة أو ملف بيانات أو كود للبدء.",
                       "Type a message or attach an image, data file, or source file to begin.",`,
  'empty-state attachment copy',
)

replaceExact(
  'src/pages/Chat.tsx',
  `"إرفاق صورة أو ملف نصي",
                   "Attach an image or text file",`,
  `"إرفاق صورة أو ملف بيانات أو كود",
                   "Attach an image, data file, or source file",`,
  'attachment button label',
)

replaceExact(
  'src/pages/Chat.tsx',
  `"PNG، JPEG، WebP، TXT، Markdown، JSON • Enter للإرسال",
               "PNG, JPEG, WebP, TXT, Markdown, JSON • Press Enter to send",`,
  `"صور، نصوص، CSV، XML، YAML، SQL وملفات كود • Enter للإرسال",
               "Images, text, CSV, XML, YAML, SQL, and source files • Press Enter to send",`,
  'attachment help copy',
)

const oldMimeTypes = `export type ChatAttachmentMimeType =
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "text/plain"
  | "text/markdown"
  | "application/json";`
const newMimeTypes = `export type ChatAttachmentMimeType =
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "text/plain"
  | "text/markdown"
  | "application/json"
  | "text/csv"
  | "text/tab-separated-values"
  | "application/xml"
  | "text/xml"
  | "application/yaml"
  | "text/yaml"
  | "application/x-yaml"
  | "application/sql"
  | "text/javascript"
  | "application/javascript"
  | "text/typescript"
  | "application/typescript"
  | "text/x-python"
  | "text/html"
  | "text/css"
  | "text/x-shellscript";

export type ChatTextAttachmentMimeType = Exclude<
  ChatAttachmentMimeType,
  "image/png" | "image/jpeg" | "image/webp"
>;`
replaceExact('src/types/index.ts', oldMimeTypes, newMimeTypes, 'frontend attachment MIME union')

replaceExact(
  'src/types/index.ts',
  `      mimeType: Extract<
        ChatAttachmentMimeType,
        "text/plain" | "text/markdown" | "application/json"
      >;`,
  `      mimeType: ChatTextAttachmentMimeType;`,
  'frontend text attachment type',
)

replaceExact(
  'api/_lib/providers/types.ts',
  `  | { type: 'text'; mimeType: 'text/plain' | 'text/markdown' | 'application/json'; text: string; name?: string; size?: number }`,
  `  | { type: 'text'; mimeType: 'text/plain' | 'text/markdown' | 'application/json' | 'text/csv' | 'text/tab-separated-values' | 'application/xml' | 'text/xml' | 'application/yaml' | 'text/yaml' | 'application/x-yaml' | 'application/sql' | 'text/javascript' | 'application/javascript' | 'text/typescript' | 'application/typescript' | 'text/x-python' | 'text/html' | 'text/css' | 'text/x-shellscript'; text: string; name?: string; size?: number }`,
  'provider attachment MIME union',
)

replaceExact(
  'api/_lib/provider-schemas.ts',
  `const textMimeType = z.enum(['text/plain', 'text/markdown', 'application/json'])`,
  `const textMimeType = z.enum([
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
])`,
  'server attachment MIME allowlist',
)

replaceExact(
  'api/_lib/provider-schemas.ts',
  `function roughlyMatchesSize(declared: number | undefined, actual: number) {
  if (declared === undefined) return true
  return Math.abs(declared - actual) <= Math.max(32, Math.ceil(actual * 0.01))
}`,
  `function roughlyMatchesSize(declared: number | undefined, actual: number) {
  if (declared === undefined) return true
  return Math.abs(declared - actual) <= Math.max(32, Math.ceil(actual * 0.01))
}

function looksLikeBinaryText(value: string) {
  const sample = value.slice(0, 8_192)
  if (sample.includes('\\u0000')) return true
  let controlCharacters = 0
  for (let index = 0; index < sample.length; index += 1) {
    const code = sample.charCodeAt(index)
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) controlCharacters += 1
  }
  return controlCharacters > Math.max(4, Math.ceil(sample.length * 0.01))
}`,
  'server binary-text detector',
)

replaceExact(
  'api/_lib/provider-schemas.ts',
  `    if (!roughlyMatchesSize(attachment.size, actual)) context.addIssue({ code: 'custom', path: ['size'], message: 'الحجم المصرح لا يطابق النص' })
    if (attachment.mimeType === 'application/json') {`,
  `    if (!roughlyMatchesSize(attachment.size, actual)) context.addIssue({ code: 'custom', path: ['size'], message: 'الحجم المصرح لا يطابق النص' })
    if (looksLikeBinaryText(attachment.text)) context.addIssue({ code: 'custom', path: ['text'], message: 'الملف يحتوي بيانات ثنائية غير مسموحة' })
    if (attachment.mimeType === 'application/json') {`,
  'server binary-text validation',
)

write('api/_lib/__tests__/provider-attachments.test.ts', `import { describe, expect, it } from 'vitest'
import { chatRequestSchema } from '../provider-schemas.js'

function requestWithAttachment(mimeType: string, text: string, name: string) {
  return {
    credentialMode: 'saved' as const,
    providerId: '00000000-0000-4000-8000-000000000001',
    model: 'test-model',
    stream: false,
    messages: [{
      role: 'user' as const,
      content: 'حلل الملف',
      attachments: [{ type: 'text' as const, mimeType, text, name, size: Buffer.byteLength(text) }],
    }],
  }
}

describe('chat attachment validation', () => {
  it('accepts CSV, YAML, SQL and source-code text attachments', () => {
    const samples = [
      ['text/csv', 'name,value\\nalpha,1', 'data.csv'],
      ['application/yaml', 'service:\\n  enabled: true', 'config.yaml'],
      ['application/sql', 'select id from users;', 'query.sql'],
      ['text/typescript', 'export const answer: number = 42', 'answer.ts'],
      ['text/x-python', 'print("hello")', 'hello.py'],
    ]
    for (const [mimeType, text, name] of samples) {
      expect(chatRequestSchema.safeParse(requestWithAttachment(mimeType, text, name)).success).toBe(true)
    }
  })

  it('rejects binary content disguised as a text attachment', () => {
    const result = chatRequestSchema.safeParse(requestWithAttachment('text/plain', 'safe\\u0000binary', 'payload.txt'))
    expect(result.success).toBe(false)
  })

  it('keeps executable and archive MIME types blocked', () => {
    const result = chatRequestSchema.safeParse(requestWithAttachment('application/x-msdownload', 'MZ', 'payload.exe'))
    expect(result.success).toBe(false)
  })
})
`)

write('docs/chat-attachments-security.md', `# Chat attachment security

The chat accepts a deliberately limited set of image, text, data, markup, query, and source-code formats.

## Supported formats

- Images: PNG, JPEG, WebP
- Text: TXT, Markdown
- Data and markup: JSON, CSV, TSV, XML, YAML
- Queries and source: SQL, JavaScript, TypeScript, Python, HTML, CSS, shell scripts

## Enforced controls

- At most three attachments per request.
- Aggregate attachment payload is limited to 3 MiB.
- Image MIME values must match both the data URL and the file magic bytes.
- Text sizes are recomputed on the server and compared with the declared size.
- NUL bytes and abnormal control-character density are rejected to block binary files disguised as text.
- JSON is parsed before it is sent to a provider.
- Attachments are accepted only on the final user message in a request.
- Executables, archives, office files, PDFs, and arbitrary binary formats remain blocked until dedicated safe extractors are implemented.

The browser allowlist is only a usability layer. The server performs the authoritative validation.
`)

fs.rmSync(path.join(root, 'scripts/apply-integrated-attachment-upgrade.mjs'))
fs.rmSync(path.join(root, '.github/workflows/apply-integrated-attachment-upgrade.yml'))
