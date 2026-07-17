import type { ProviderProtocol } from '../../../shared/provider-registry.js'

export type { ProviderProtocol }

export interface ProviderConfig {
  type: string
  name?: string
  protocol: ProviderProtocol
  baseUrl: string
  apiKey: string
  model?: string
}

export interface ProviderChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  attachments?: ProviderAttachment[]
}

export type ProviderTextAttachmentMimeType =
  | 'text/plain'
  | 'text/markdown'
  | 'application/json'
  | 'text/csv'
  | 'text/tab-separated-values'
  | 'application/xml'
  | 'text/xml'
  | 'application/yaml'
  | 'text/yaml'
  | 'application/x-yaml'
  | 'application/sql'
  | 'text/javascript'
  | 'application/javascript'
  | 'text/typescript'
  | 'application/typescript'
  | 'text/x-python'
  | 'text/html'
  | 'text/css'
  | 'text/x-shellscript'

export type ProviderAttachment =
  | { type: 'image'; mimeType: 'image/png' | 'image/jpeg' | 'image/webp'; dataUrl: string; name?: string; size?: number }
  | { type: 'text'; mimeType: ProviderTextAttachmentMimeType; text: string; name?: string; size?: number }

export interface ProviderUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export type ProviderStreamEvent =
  | { event: 'meta'; data: { model: string; provider: string; protocol: ProviderProtocol; endpoint: string } }
  | { event: 'delta'; data: { content: string } }
  | { event: 'usage'; data: ProviderUsage }
  | { event: 'error'; data: { code: string; message: string; category: string } }
  | { event: 'done'; data: Record<string, never> }

export interface ProviderGenerateResult {
  content: string
  usage: ProviderUsage
  protocol: ProviderProtocol
  endpoint: string
  httpStatus?: number
}

export interface ProviderTestResult {
  models: string[]
  endpoint: string
  testedModel?: string
  warning?: string
  httpStatus?: number
}

export interface ProviderErrorDetails {
  message: string
  code?: string
  type?: string
  status?: number
  endpoint?: string
  requestId?: string
  causeName?: string
}

export class ProviderRequestError extends Error {
  constructor(public readonly details: ProviderErrorDetails) {
    super(details.message)
    this.name = 'ProviderRequestError'
  }
}

export interface NormalizedProviderError extends ProviderErrorDetails {
  protocol: ProviderProtocol
}

export interface ProviderAdapter {
  readonly protocol: ProviderProtocol
  testConnection(config: ProviderConfig, signal?: AbortSignal): Promise<ProviderTestResult>
  listModels(config: ProviderConfig, signal?: AbortSignal): Promise<{ models: string[]; endpoint: string; httpStatus?: number }>
  generateText(config: ProviderConfig, model: string, messages: ProviderChatMessage[], signal?: AbortSignal): Promise<ProviderGenerateResult>
  streamText(config: ProviderConfig, model: string, messages: ProviderChatMessage[], signal?: AbortSignal): AsyncGenerator<ProviderStreamEvent>
  normalizeError(error: unknown): NormalizedProviderError
}

export function emptyUsage(): ProviderUsage {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
}

export function usage(inputTokens = 0, outputTokens = 0, totalTokens?: number): ProviderUsage {
  return {
    inputTokens: Number.isFinite(inputTokens) ? inputTokens : 0,
    outputTokens: Number.isFinite(outputTokens) ? outputTokens : 0,
    totalTokens: Number.isFinite(totalTokens) ? Number(totalTokens) : (inputTokens || 0) + (outputTokens || 0),
  }
}