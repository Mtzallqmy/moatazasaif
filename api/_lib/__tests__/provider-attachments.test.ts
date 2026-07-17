import { afterEach, describe, expect, it } from 'vitest'
import { chatRequestSchema, parseRequest } from '../provider-schemas.js'
import { assertMultimodalSupport, anthropicMessages, geminiParts, openAiMessages } from '../providers/multimodal.js'

const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const pngDataUrl = `data:image/png;base64,${pngBytes.toString('base64')}`

function platformRequest(messages: unknown[]) {
  return { credentialMode: 'platform', messages, stream: false }
}

function textAttachmentRequest(mimeType: string, text: string, name: string) {
  return platformRequest([{
    role: 'user',
    content: 'حلل الملف',
    attachments: [{ type: 'text', mimeType, text, name, size: Buffer.byteLength(text) }],
  }])
}

afterEach(() => {
  delete process.env.PROVIDER_MAX_OUTPUT_TOKENS
})

describe('chat attachment contract', () => {
  it('accepts up to three inline image/text attachments on the final user message', () => {
    const parsed = parseRequest(chatRequestSchema, platformRequest([{
      role: 'user',
      content: 'حلل الملفات',
      attachments: [
        { type: 'image', mimeType: 'image/png', dataUrl: pngDataUrl, name: 'chart.png', size: pngBytes.byteLength },
        { type: 'text', mimeType: 'application/json', text: '{"ok":true}', name: 'data.json', size: 11 },
      ],
    }]))
    expect(parsed.credentialMode).toBe('platform')
    expect(parsed.messages[0].attachments).toHaveLength(2)
  })

  it('accepts supported data, query, markup and source-code attachments', () => {
    const samples = [
      ['text/csv', 'name,value\nalpha,1', 'data.csv'],
      ['text/tab-separated-values', 'name\tvalue\nalpha\t1', 'data.tsv'],
      ['application/xml', '<root><value>1</value></root>', 'data.xml'],
      ['application/yaml', 'service:\n  enabled: true', 'config.yaml'],
      ['application/sql', 'select id from users;', 'query.sql'],
      ['text/javascript', 'export const answer = 42', 'answer.js'],
      ['text/typescript', 'export const answer: number = 42', 'answer.ts'],
      ['text/x-python', 'print("hello")', 'hello.py'],
      ['text/html', '<main>Hello</main>', 'index.html'],
      ['text/css', 'main { display: block; }', 'style.css'],
      ['text/x-shellscript', '#!/bin/sh\necho hello', 'hello.sh'],
    ]

    for (const [mimeType, text, name] of samples) {
      expect(chatRequestSchema.safeParse(textAttachmentRequest(mimeType, text, name)).success).toBe(true)
    }
  })

  it('rejects external image URLs, MIME spoofing, and inaccurate declared sizes', () => {
    for (const attachment of [
      { type: 'image', mimeType: 'image/png', dataUrl: 'https://example.com/a.png' },
      { type: 'image', mimeType: 'image/jpeg', dataUrl: pngDataUrl },
      { type: 'image', mimeType: 'image/png', dataUrl: pngDataUrl, size: 5_000 },
    ]) {
      expect(chatRequestSchema.safeParse(platformRequest([{ role: 'user', content: 'x', attachments: [attachment] }])).success).toBe(false)
    }
  })

  it('rejects attachments outside the final user message and invalid JSON text', () => {
    expect(chatRequestSchema.safeParse(platformRequest([
      { role: 'user', content: 'old', attachments: [{ type: 'text', mimeType: 'text/plain', text: 'secret' }] },
      { role: 'user', content: 'new' },
    ])).success).toBe(false)
    expect(chatRequestSchema.safeParse(platformRequest([{
      role: 'user', content: 'x', attachments: [{ type: 'text', mimeType: 'application/json', text: '{bad}' }],
    }])).success).toBe(false)
  })

  it('rejects binary data disguised as text and unsupported executable/archive MIME types', () => {
    expect(chatRequestSchema.safeParse(textAttachmentRequest('text/plain', 'safe\u0000binary', 'payload.txt')).success).toBe(false)
    expect(chatRequestSchema.safeParse(textAttachmentRequest('application/x-msdownload', 'MZ', 'payload.exe')).success).toBe(false)
    expect(chatRequestSchema.safeParse(textAttachmentRequest('application/zip', 'PK', 'payload.zip')).success).toBe(false)
  })
})

describe('provider multimodal conversion', () => {
  const message = {
    role: 'user' as const,
    content: 'Describe',
    attachments: [
      { type: 'text' as const, mimeType: 'text/plain' as const, text: 'context', name: 'notes.txt' },
      { type: 'image' as const, mimeType: 'image/png' as const, dataUrl: pngDataUrl, name: 'chart.png' },
    ],
  }

  it('converts images without exposing an external fetch URL', () => {
    const openAi = openAiMessages([message]) as any[]
    expect(openAi[0].content).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'image_url', image_url: { url: pngDataUrl, detail: 'auto' } })]))

    const anthropic = anthropicMessages([message]) as any[]
    expect(anthropic[0].content).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'image', source: expect.objectContaining({ media_type: 'image/png', data: pngBytes.toString('base64') }) })]))

    const gemini = geminiParts(message) as any[]
    expect(gemini).toEqual(expect.arrayContaining([expect.objectContaining({ inlineData: { mimeType: 'image/png', data: pngBytes.toString('base64') } })]))
  })

  it('rejects clearly text-only or unknown image models with an actionable code', () => {
    expect(() => assertMultimodalSupport('anthropic', 'claude-2.1', [message])).toThrow(expect.objectContaining({ code: 'model_image_input_unsupported' }))
    expect(() => assertMultimodalSupport('openai-compatible', 'text-only-private-model', [message])).toThrow(expect.objectContaining({ code: 'model_image_input_unsupported' }))
    expect(() => assertMultimodalSupport('gemini', 'gemini-pro', [message])).toThrow(expect.objectContaining({ code: 'model_image_input_unsupported' }))
    expect(() => assertMultimodalSupport('gemini', 'gemini-pro-vision', [message])).not.toThrow()
    expect(() => assertMultimodalSupport('gemini', 'gemini-2.5-pro', [message])).not.toThrow()
  })
})
