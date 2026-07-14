export const PROVIDER_PROTOCOLS = ['openai-compatible', 'gemini', 'anthropic'] as const

export type ProviderProtocol = (typeof PROVIDER_PROTOCOLS)[number]

export interface ProviderDefinition {
  type: string
  label: string
  defaultBaseUrl: string
  protocol: ProviderProtocol
  requiresCustomBaseUrl: boolean
}

/**
 * المصدر الوحيد لأنواع المزودات التي يمكن عرضها أو حفظها أو تشغيلها.
 * قاعدة البيانات تتحقق من صيغة النوع فقط، بينما هذه القائمة تحدد الأنواع المدعومة فعليًا.
 */
export const PROVIDER_DEFINITIONS = [
  { type: 'openai', label: 'OpenAI', defaultBaseUrl: 'https://api.openai.com/v1', protocol: 'openai-compatible', requiresCustomBaseUrl: false },
  { type: 'openrouter', label: 'OpenRouter', defaultBaseUrl: 'https://openrouter.ai/api/v1', protocol: 'openai-compatible', requiresCustomBaseUrl: false },
  { type: 'gemini', label: 'Google Gemini', defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta', protocol: 'gemini', requiresCustomBaseUrl: false },
  { type: 'anthropic', label: 'Anthropic Claude', defaultBaseUrl: 'https://api.anthropic.com/v1', protocol: 'anthropic', requiresCustomBaseUrl: false },
  { type: 'groq', label: 'Groq', defaultBaseUrl: 'https://api.groq.com/openai/v1', protocol: 'openai-compatible', requiresCustomBaseUrl: false },
  { type: 'deepseek', label: 'DeepSeek', defaultBaseUrl: 'https://api.deepseek.com/v1', protocol: 'openai-compatible', requiresCustomBaseUrl: false },
  { type: 'mistral', label: 'Mistral AI', defaultBaseUrl: 'https://api.mistral.ai/v1', protocol: 'openai-compatible', requiresCustomBaseUrl: false },
  { type: 'together', label: 'Together AI', defaultBaseUrl: 'https://api.together.xyz/v1', protocol: 'openai-compatible', requiresCustomBaseUrl: false },
  { type: 'nvidia', label: 'NVIDIA NIM', defaultBaseUrl: 'https://integrate.api.nvidia.com/v1', protocol: 'openai-compatible', requiresCustomBaseUrl: false },
  { type: 'dahl', label: 'dahl.global (Kimi)', defaultBaseUrl: 'https://inference.dahl.global/v1', protocol: 'openai-compatible', requiresCustomBaseUrl: false },
  { type: 'openai-compatible', label: 'OpenAI-compatible', defaultBaseUrl: '', protocol: 'openai-compatible', requiresCustomBaseUrl: true },
  { type: 'custom', label: 'مخصص', defaultBaseUrl: '', protocol: 'openai-compatible', requiresCustomBaseUrl: true },
] as const satisfies readonly ProviderDefinition[]

export type ProviderType = (typeof PROVIDER_DEFINITIONS)[number]['type']

export function getProviderDefinition(type: string): ProviderDefinition | undefined {
  return PROVIDER_DEFINITIONS.find((provider) => provider.type === type)
}

export function isProviderType(type: string): type is ProviderType {
  return Boolean(getProviderDefinition(type))
}

export function resolveProviderProtocol(
  type: string,
  explicitProtocol?: ProviderProtocol | null,
  baseUrl?: string | null,
): ProviderProtocol {
  if (explicitProtocol) return explicitProtocol
  const definition = getProviderDefinition(type)
  if (definition && type !== 'custom') return definition.protocol

  try {
    const host = baseUrl ? new URL(baseUrl).hostname.toLowerCase() : ''
    if (host.includes('generativelanguage.googleapis.com')) return 'gemini'
    if (host.includes('anthropic.com')) return 'anthropic'
  } catch {
    // URL validation is performed by the API schema and SSRF guard.
  }
  return definition?.protocol || 'openai-compatible'
}

export function resolveProviderBaseUrl(type: string, baseUrl?: string | null): string {
  const value = baseUrl?.trim() || getProviderDefinition(type)?.defaultBaseUrl || ''
  return value.replace(/\/+$/, '')
}
