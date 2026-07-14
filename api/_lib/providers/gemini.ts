import { getProviderRuntimeEnv } from '../env'
import { extractModelIds, normalizeProviderError, parseSseStream, parseStreamJson, providerFetch, readProviderJson } from './http'
import { emptyUsage, ProviderRequestError, type ProviderAdapter, type ProviderChatMessage, type ProviderConfig, type ProviderGenerateResult, type ProviderStreamEvent, type ProviderTestResult, usage } from './types'

function headers(config: ProviderConfig) {
  return { 'Content-Type': 'application/json', 'x-goog-api-key': config.apiKey }
}

function normalizedModel(model: string) { return model.replace(/^models\//, '') }

function requestBody(messages: ProviderChatMessage[]) {
  const system = messages.find((message) => message.role === 'system')?.content
  const contents = messages.filter((message) => message.role !== 'system').map((message) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: message.content }],
  }))
  return {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents,
    generationConfig: { maxOutputTokens: getProviderRuntimeEnv().PROVIDER_MAX_OUTPUT_TOKENS },
  }
}

export const geminiAdapter: ProviderAdapter = {
  protocol: 'gemini',

  async listModels(config, signal) {
    const endpoint = `${config.baseUrl}/models`
    const response = await providerFetch(endpoint, { headers: headers(config) }, signal)
    const payload = await readProviderJson(response, endpoint)
    const allowed = new Set((payload?.models || []).filter((row: any) => row?.supportedGenerationMethods?.includes('generateContent') !== false).map((row: any) => String(row.name || '').replace(/^models\//, '')))
    return { models: extractModelIds(payload).filter((model) => !allowed.size || allowed.has(model)), endpoint, httpStatus: response.status }
  },

  async testConnection(config, signal): Promise<ProviderTestResult> {
    let discovered: Awaited<ReturnType<ProviderAdapter['listModels']>>
    try {
      discovered = await this.listModels(config, signal)
    } catch (error) {
      if (!config.model) throw error
      const generated = await this.generateText(config, config.model, [{ role: 'user', content: 'Reply with OK only.' }], signal)
      return { models: [config.model], testedModel: config.model, endpoint: generated.endpoint, httpStatus: generated.httpStatus, warning: 'تعذر اكتشاف النماذج؛ تم التحقق بطلب توليد فعلي.' }
    }
    if (config.model) {
      const generated = await this.generateText(config, config.model, [{ role: 'user', content: 'Reply with OK only.' }], signal)
      return { models: Array.from(new Set([...discovered.models, config.model])), testedModel: config.model, endpoint: generated.endpoint, httpStatus: generated.httpStatus }
    }
    if (discovered.models.length) return discovered
    throw new ProviderRequestError({ message: 'نجح الاتصال لكن قائمة النماذج فارغة؛ حدد نموذجًا لاختبار التوليد', code: 'empty_model_list', endpoint: discovered.endpoint })
  },

  async generateText(config, model, messages, signal): Promise<ProviderGenerateResult> {
    const endpoint = `${config.baseUrl}/models/${encodeURIComponent(normalizedModel(model))}:generateContent`
    const response = await providerFetch(endpoint, { method: 'POST', headers: headers(config), body: JSON.stringify(requestBody(messages)) }, signal)
    const payload = await readProviderJson(response, endpoint)
    const content = payload?.candidates?.[0]?.content?.parts?.map((part: any) => part?.text || '').join('') || ''
    if (!content) throw new ProviderRequestError({ message: 'أعاد Gemini استجابة ناجحة دون نص', code: 'empty_response', endpoint })
    const metadata = payload?.usageMetadata || {}
    return { content, usage: usage(metadata.promptTokenCount, metadata.candidatesTokenCount, metadata.totalTokenCount), protocol: this.protocol, endpoint, httpStatus: response.status }
  },

  async *streamText(config, model, messages, signal): AsyncGenerator<ProviderStreamEvent> {
    const endpoint = `${config.baseUrl}/models/${encodeURIComponent(normalizedModel(model))}:streamGenerateContent?alt=sse`
    const response = await providerFetch(endpoint, { method: 'POST', headers: headers(config), body: JSON.stringify(requestBody(messages)) }, signal)
    if (!response.ok) await readProviderJson(response, endpoint)
    yield { event: 'meta', data: { model, provider: config.type, protocol: this.protocol, endpoint } }
    let finalUsage = emptyUsage()
    for await (const message of parseSseStream(response, endpoint)) {
      const payload = parseStreamJson(message.data, endpoint)
      const content = payload?.candidates?.[0]?.content?.parts?.map((part: any) => part?.text || '').join('') || ''
      if (content) yield { event: 'delta', data: { content } }
      if (payload?.usageMetadata) {
        finalUsage = usage(payload.usageMetadata.promptTokenCount, payload.usageMetadata.candidatesTokenCount, payload.usageMetadata.totalTokenCount)
        yield { event: 'usage', data: finalUsage }
      }
    }
    if (!finalUsage.totalTokens) yield { event: 'usage', data: finalUsage }
    yield { event: 'done', data: {} }
  },

  normalizeError(error) { return normalizeProviderError(error, this.protocol) },
}
