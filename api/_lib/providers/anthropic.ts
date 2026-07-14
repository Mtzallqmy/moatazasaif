import { getProviderRuntimeEnv } from '../env.js'
import { extractModelIds, normalizeProviderError, parseSseStream, parseStreamJson, providerFetch, readProviderJson } from './http.js'
import { emptyUsage, ProviderRequestError, type ProviderAdapter, type ProviderChatMessage, type ProviderConfig, type ProviderGenerateResult, type ProviderStreamEvent, type ProviderTestResult, usage } from './types.js'

function headers(config: ProviderConfig) {
  return { 'Content-Type': 'application/json', 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' }
}

function requestBody(model: string, messages: ProviderChatMessage[], stream: boolean) {
  const system = messages.find((message) => message.role === 'system')?.content
  return {
    model,
    max_tokens: getProviderRuntimeEnv().PROVIDER_MAX_OUTPUT_TOKENS,
    stream,
    ...(system ? { system } : {}),
    messages: messages.filter((message) => message.role !== 'system').map((message) => ({ role: message.role, content: message.content })),
  }
}

export const anthropicAdapter: ProviderAdapter = {
  protocol: 'anthropic',

  async listModels(config, signal) {
    const endpoint = `${config.baseUrl}/models`
    const response = await providerFetch(endpoint, { headers: headers(config) }, signal)
    return { models: extractModelIds(await readProviderJson(response, endpoint)), endpoint, httpStatus: response.status }
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
    const endpoint = `${config.baseUrl}/messages`
    const response = await providerFetch(endpoint, { method: 'POST', headers: headers(config), body: JSON.stringify(requestBody(model, messages, false)) }, signal)
    const payload = await readProviderJson(response, endpoint)
    const content = payload?.content?.map((part: any) => part?.text || '').join('') || ''
    if (!content) throw new ProviderRequestError({ message: 'أعاد Anthropic استجابة ناجحة دون نص', code: 'empty_response', endpoint })
    return { content, usage: usage(payload?.usage?.input_tokens, payload?.usage?.output_tokens), protocol: this.protocol, endpoint, httpStatus: response.status }
  },

  async *streamText(config, model, messages, signal): AsyncGenerator<ProviderStreamEvent> {
    const endpoint = `${config.baseUrl}/messages`
    const response = await providerFetch(endpoint, { method: 'POST', headers: headers(config), body: JSON.stringify(requestBody(model, messages, true)) }, signal)
    if (!response.ok) await readProviderJson(response, endpoint)
    yield { event: 'meta', data: { model, provider: config.type, protocol: this.protocol, endpoint } }
    let finalUsage = emptyUsage()
    for await (const message of parseSseStream(response, endpoint)) {
      const payload = parseStreamJson(message.data, endpoint)
      const eventType = payload?.type || message.event
      if (eventType === 'content_block_delta' && payload?.delta?.type === 'text_delta' && typeof payload.delta.text === 'string') {
        yield { event: 'delta', data: { content: payload.delta.text } }
      }
      if (eventType === 'message_start' && payload?.message?.usage) {
        finalUsage = usage(payload.message.usage.input_tokens, 0)
        yield { event: 'usage', data: finalUsage }
      }
      if (eventType === 'message_delta' && payload?.usage) {
        finalUsage = usage(finalUsage.inputTokens, payload.usage.output_tokens)
        yield { event: 'usage', data: finalUsage }
      }
      if (eventType === 'error') throw new ProviderRequestError({ message: payload?.error?.message || 'أرسل Anthropic حدث خطأ', code: payload?.error?.type || 'provider_stream_error', endpoint })
      if (eventType === 'message_stop') break
    }
    if (!finalUsage.totalTokens) yield { event: 'usage', data: finalUsage }
    yield { event: 'done', data: {} }
  },

  normalizeError(error) { return normalizeProviderError(error, this.protocol) },
}
