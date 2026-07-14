import { getProviderRuntimeEnv } from '../env.js'
import { extractModelIds, normalizeProviderError, parseSseStream, parseStreamJson, providerFetch, readProviderJson } from './http.js'
import { emptyUsage, ProviderRequestError, type ProviderAdapter, type ProviderChatMessage, type ProviderConfig, type ProviderGenerateResult, type ProviderStreamEvent, type ProviderTestResult, usage } from './types.js'

function headers(config: ProviderConfig) {
  const result: Record<string, string> = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.apiKey}`,
    'User-Agent': 'Moataz-AI/1.0',
    'X-Title': 'Moataz AI',
  }
  const appUrl = getProviderRuntimeEnv().APP_URL
  if (appUrl) result['HTTP-Referer'] = appUrl
  return result
}

function chatBody(model: string, messages: ProviderChatMessage[], stream: boolean) {
  return { model, messages, stream, temperature: 0.7, max_tokens: getProviderRuntimeEnv().PROVIDER_MAX_OUTPUT_TOKENS }
}

export const openAiCompatibleAdapter: ProviderAdapter = {
  protocol: 'openai-compatible',

  async listModels(config, signal) {
    const candidates = [`${config.baseUrl}/models`]
    if (!/\/v\d+(beta)?$/i.test(config.baseUrl)) candidates.push(`${config.baseUrl}/v1/models`)
    let lastError: unknown
    for (const endpoint of Array.from(new Set(candidates))) {
      try {
        const response = await providerFetch(endpoint, { headers: headers(config) }, signal)
        const payload = await readProviderJson(response, endpoint)
        return { models: extractModelIds(payload), endpoint, httpStatus: response.status }
      } catch (error) {
        lastError = error
        if (!(error instanceof ProviderRequestError) || ![404, 405].includes(error.details.status || 0)) throw error
      }
    }
    throw lastError || new ProviderRequestError({ message: 'لم يتم العثور على بوابة اكتشاف النماذج', code: 'models_endpoint_missing', endpoint: config.baseUrl })
  },

  async testConnection(config, signal): Promise<ProviderTestResult> {
    let discovered: Awaited<ReturnType<ProviderAdapter['listModels']>>
    try {
      discovered = await this.listModels(config, signal)
    } catch (discoveryError) {
      if (!config.model) throw discoveryError
      const generated = await this.generateText(config, config.model, [{ role: 'user', content: 'Reply with OK only.' }], signal)
      return { models: [config.model], endpoint: generated.endpoint, httpStatus: generated.httpStatus, testedModel: config.model, warning: 'تعذر اكتشاف النماذج؛ تم التحقق بطلب توليد فعلي.' }
    }
    if (config.model) {
      const generated = await this.generateText(config, config.model, [{ role: 'user', content: 'Reply with OK only.' }], signal)
      return { models: Array.from(new Set([...discovered.models, config.model])), endpoint: generated.endpoint, httpStatus: generated.httpStatus, testedModel: config.model }
    }
    if (discovered.models.length) return discovered
    throw new ProviderRequestError({ message: 'نجح الاتصال لكن قائمة النماذج فارغة؛ حدد نموذجًا لاختبار التوليد', code: 'empty_model_list', endpoint: discovered.endpoint })
  },

  async generateText(config, model, messages, signal): Promise<ProviderGenerateResult> {
    const chatEndpoint = `${config.baseUrl}/chat/completions`
    try {
      const response = await providerFetch(chatEndpoint, { method: 'POST', headers: headers(config), body: JSON.stringify(chatBody(model, messages, false)) }, signal)
      const payload = await readProviderJson(response, chatEndpoint)
      const content = payload?.choices?.[0]?.message?.content
      if (typeof content !== 'string' || !content) throw new ProviderRequestError({ message: 'استجابة المزود لا تحتوي choices[0].message.content', code: 'invalid_chat_response', endpoint: chatEndpoint })
      return { content, usage: usage(payload?.usage?.prompt_tokens, payload?.usage?.completion_tokens, payload?.usage?.total_tokens), protocol: this.protocol, endpoint: chatEndpoint, httpStatus: response.status }
    } catch (error) {
      if (!(error instanceof ProviderRequestError) || ![404, 405].includes(error.details.status || 0)) throw error
    }

    const endpoint = `${config.baseUrl}/responses`
    const input = messages.map((message) => `${message.role.toUpperCase()}: ${message.content}`).join('\n\n')
    const response = await providerFetch(endpoint, { method: 'POST', headers: headers(config), body: JSON.stringify({ model, input, max_output_tokens: getProviderRuntimeEnv().PROVIDER_MAX_OUTPUT_TOKENS }) }, signal)
    const payload = await readProviderJson(response, endpoint)
    const content = payload?.output_text || payload?.output?.flatMap?.((item: any) => item?.content || []).map((item: any) => item?.text || '').join('') || ''
    if (!content) throw new ProviderRequestError({ message: 'بوابة responses أعادت استجابة دون نص', code: 'invalid_responses_response', endpoint })
    return { content, usage: usage(payload?.usage?.input_tokens, payload?.usage?.output_tokens, payload?.usage?.total_tokens), protocol: this.protocol, endpoint, httpStatus: response.status }
  },

  async *streamText(config, model, messages, signal): AsyncGenerator<ProviderStreamEvent> {
    const endpoint = `${config.baseUrl}/chat/completions`
    const response = await providerFetch(endpoint, { method: 'POST', headers: headers(config), body: JSON.stringify({ ...chatBody(model, messages, true), stream_options: { include_usage: true } }) }, signal)
    if (!response.ok) await readProviderJson(response, endpoint)
    yield { event: 'meta', data: { model, provider: config.type, protocol: this.protocol, endpoint } }
    let finalUsage = emptyUsage()
    for await (const message of parseSseStream(response, endpoint)) {
      if (message.data === '[DONE]') break
      const payload = parseStreamJson(message.data, endpoint)
      const content = payload?.choices?.[0]?.delta?.content
      if (typeof content === 'string' && content) yield { event: 'delta', data: { content } }
      if (payload?.usage) {
        finalUsage = usage(payload.usage.prompt_tokens, payload.usage.completion_tokens, payload.usage.total_tokens)
        yield { event: 'usage', data: finalUsage }
      }
    }
    if (!finalUsage.totalTokens) yield { event: 'usage', data: finalUsage }
    yield { event: 'done', data: {} }
  },

  normalizeError(error) { return normalizeProviderError(error, this.protocol) },
}
