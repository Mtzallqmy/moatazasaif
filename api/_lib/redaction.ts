const SECRET_KEY_PATTERN = /(api[_-]?key|token|secret|authorization|x-api-key|x-goog-api-key|service[_-]?role)/i

export function redactText(value: string, extraSecrets: string[] = [], maxLength = 2_000): string {
  let result = value
  const configuredSecrets = typeof process !== 'undefined'
    ? [process.env.SUPABASE_SERVICE_ROLE_KEY, process.env.ENCRYPTION_KEY, process.env.SUPABASE_PUBLISHABLE_KEY]
    : []
  for (const secret of [...extraSecrets, ...configuredSecrets]) {
    if (secret && secret.length >= 4) result = result.split(secret).join('[REDACTED]')
  }
  return result
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, '$1[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{6,}\b/g, 'sk-[REDACTED]')
    .replace(/\bAIza[A-Za-z0-9_-]{8,}\b/g, 'AIza[REDACTED]')
    .replace(/([?&](?:key|api_key|token)=)[^&#\s]+/gi, '$1[REDACTED]')
    .slice(0, maxLength)
}

export function redactUnknown(value: unknown, extraSecrets: string[] = [], depth = 0, maxStringLength = 2_000): unknown {
  if (depth > 5) return '[TRUNCATED]'
  if (typeof value === 'string') return redactText(value, extraSecrets, maxStringLength)
  if (value instanceof Error) {
    return { name: value.name, message: redactText(value.message, extraSecrets, maxStringLength) }
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactUnknown(item, extraSecrets, depth + 1, maxStringLength))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 100).map(([key, item]) => [
      key,
      SECRET_KEY_PATTERN.test(key) ? '[REDACTED]' : redactUnknown(item, extraSecrets, depth + 1, maxStringLength),
    ]))
  }
  return value
}

export function logTechnicalError(scope: string, error: unknown, context?: Record<string, unknown>) {
  console.error(scope, redactUnknown({ error, ...context }))
}
