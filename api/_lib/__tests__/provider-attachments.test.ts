import { afterEach, describe, expect, it } from 'vitest'
import { chatRequestSchema, parseRequest } from '../provider-schemas.js'
import { assertMultimodalSupport, anthropicMessages, geminiParts, openAiMessages } from '../providers/multimodal.js'

const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const pngDataUrl = `data:image/png;base64,${pngBytes.toString('base64')}`

function platformRequest(messages: unknown[]) {
  return { credentialMode: 'platform', messages, stream: false }
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
