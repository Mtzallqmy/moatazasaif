import { ApiError } from '../http.js'
import type { ProviderAttachment, ProviderChatMessage, ProviderProtocol } from './types.js'

function textAttachmentBlock(attachment: Extract<ProviderAttachment, { type: 'text' }>) {
  const label = attachment.name || 'attachment'
  return `\n\n--- ${label} (${attachment.mimeType}) ---\n${attachment.text}`
}

export function messageText(message: ProviderChatMessage) {
  return `${message.content}${(message.attachments || [])
    .filter((attachment): attachment is Extract<ProviderAttachment, { type: 'text' }> => attachment.type === 'text')
    .map(textAttachmentBlock)
    .join('')}`
}

export function hasImageAttachments(messages: ProviderChatMessage[]) {
  return messages.some((message) => message.attachments?.some((attachment) => attachment.type === 'image'))
}

function modelSupportsImages(protocol: ProviderProtocol, model: string) {
  if (protocol === 'gemini') return /vision/i.test(model) || !/^gemini-pro(?:$|-)/i.test(model)
  if (protocol === 'anthropic') return /claude-(?:3|[4-9]|sonnet|opus|haiku)/i.test(model)
  return /(?:gpt-4o|gpt-4\.1|gpt-4\.5|gpt-5|o[1-9](?:-|$)|vision|(?:^|[-_.])vl(?:[-_.]|$)|llava|pixtral|gemma-3|gemini-(?!pro)|claude-(?:3|[4-9]|sonnet|opus|haiku))/i.test(model)
}

export function assertMultimodalSupport(protocol: ProviderProtocol, model: string, messages: ProviderChatMessage[]) {
  if (!hasImageAttachments(messages)) return
  if (!modelSupportsImages(protocol, model)) {
    throw new ApiError(
      400,
      `النموذج ${model} غير معروف بدعم الصور عبر بروتوكول ${protocol}. اختر نموذجًا متعدد الوسائط أو أرسل مرفقات نصية فقط.`,
      'model_image_input_unsupported',
    )
  }
}

function imagePayload(attachment: Extract<ProviderAttachment, { type: 'image' }>) {
  return attachment.dataUrl.slice(attachment.dataUrl.indexOf(',') + 1)
}

export function openAiMessages(messages: ProviderChatMessage[]) {
  return messages.map((message) => {
    const images = (message.attachments || []).filter((attachment): attachment is Extract<ProviderAttachment, { type: 'image' }> => attachment.type === 'image')
    const text = messageText(message)
    if (!images.length) return { role: message.role, content: text }
    return {
      role: message.role,
      content: [
        ...(text ? [{ type: 'text', text }] : []),
        ...images.map((attachment) => ({ type: 'image_url', image_url: { url: attachment.dataUrl, detail: 'auto' } })),
      ],
    }
  })
}

export function anthropicMessages(messages: ProviderChatMessage[]) {
  return messages.filter((message) => message.role !== 'system').map((message) => {
    const text = messageText(message)
    const images = (message.attachments || []).filter((attachment): attachment is Extract<ProviderAttachment, { type: 'image' }> => attachment.type === 'image')
    if (!images.length) return { role: message.role, content: text }
    return {
      role: message.role,
      content: [
        ...(text ? [{ type: 'text', text }] : []),
        ...images.map((attachment) => ({
          type: 'image',
          source: { type: 'base64', media_type: attachment.mimeType, data: imagePayload(attachment) },
        })),
      ],
    }
  })
}

export function geminiParts(message: ProviderChatMessage) {
  const text = messageText(message)
  const images = (message.attachments || []).filter((attachment): attachment is Extract<ProviderAttachment, { type: 'image' }> => attachment.type === 'image')
  return [
    ...(text ? [{ text }] : []),
    ...images.map((attachment) => ({ inlineData: { mimeType: attachment.mimeType, data: imagePayload(attachment) } })),
  ]
}
