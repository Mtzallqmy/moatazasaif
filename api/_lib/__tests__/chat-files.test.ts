import { describe, expect, it } from 'vitest'
import { validateChatFile } from '../chat-files.js'

describe('private chat file validation', () => {
  it('accepts verified UTF-8 source files and computes a digest', () => {
    const text = 'export const answer = 42\n'
    const file = validateChatFile({ name: '../app.ts', mimeType: 'text/typescript', size: Buffer.byteLength(text), dataBase64: Buffer.from(text).toString('base64') })
    expect(file.name).toBe('..-app.ts')
    expect(file.kind).toBe('text')
    expect(file.sha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('rejects a spoofed image signature', () => {
    expect(() => validateChatFile({ name: 'fake.png', mimeType: 'image/png', dataBase64: Buffer.from('not-a-png').toString('base64') })).toThrow(expect.objectContaining({ code: 'file_signature_invalid' }))
  })
})
