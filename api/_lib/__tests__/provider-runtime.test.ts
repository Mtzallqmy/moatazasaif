import { describe, expect, it } from 'vitest'
import { canonicalProviderModel, classifyProviderError, inferProtocol, isPrivateIpAddress, providerBaseUrl, sanitizeProviderEndpoint } from '../provider-runtime.js'

describe('provider runtime', () => {
  it('detects native protocols', () => {
    expect(inferProtocol('gemini', null)).toBe('gemini')
    expect(inferProtocol('custom', 'https://api.anthropic.com/v1')).toBe('anthropic')
    expect(inferProtocol('openrouter', null)).toBe('openai-compatible')
  })

  it('normalizes known base URLs', () => {
    expect(providerBaseUrl({ type: 'openai', base_url: null })).toBe('https://api.openai.com/v1')
    expect(providerBaseUrl({ type: 'custom', base_url: 'https://example.com/v1/' })).toBe('https://example.com/v1')
  })

  it('normalizes only legacy Zyloo Kimi aliases', () => {
    expect(canonicalProviderModel({ type: 'zyloo', base_url: null }, 'moonshotai/kimi-k3')).toBe('zyloo/kimi-k3')
    expect(canonicalProviderModel({ type: 'custom', base_url: 'https://api.zyloo.io/v1' }, 'kimi-k2.5')).toBe('zyloo/kimi-k2.5')
    expect(canonicalProviderModel({ type: 'openrouter', base_url: null }, 'moonshotai/kimi-k3')).toBe('moonshotai/kimi-k3')
  })

  it('removes credentials and query secrets from reported endpoints', () => {
    expect(sanitizeProviderEndpoint('https://user:pass@example.com/v1/models?key=secret#part')).toBe('https://example.com/v1/models')
  })

  it('blocks private address families', () => {
    expect(isPrivateIpAddress('127.0.0.1')).toBe(true)
    expect(isPrivateIpAddress('10.1.2.3')).toBe(true)
    expect(isPrivateIpAddress('172.20.1.1')).toBe(true)
    expect(isPrivateIpAddress('192.168.1.1')).toBe(true)
    expect(isPrivateIpAddress('8.8.8.8')).toBe(false)
  })

  it('classifies payment and quota responses separately from authentication failures', () => {
    expect(classifyProviderError({ status: 402, message: 'Payment Required', code: 'payment_required', protocol: 'openai-compatible' })).toMatchObject({ category: 'quota' })
    expect(classifyProviderError({ status: 400, message: 'Insufficient credit', code: 'insufficient_quota', protocol: 'openai-compatible' })).toMatchObject({ category: 'quota' })
    expect(classifyProviderError({ status: 401, message: 'Invalid API key', code: 'invalid_api_key', protocol: 'openai-compatible' })).toMatchObject({ category: 'authentication' })
    expect(classifyProviderError({ status: 400, message: "Unknown model 'x'", code: 'invalid_model', protocol: 'openai-compatible' })).toMatchObject({ category: 'model' })
  })
})
