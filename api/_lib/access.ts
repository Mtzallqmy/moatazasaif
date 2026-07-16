export const OWNER_EMAILS = ['mtzallqmy@gmail.com', 'moataz77549@gmail.com'] as const

export function isOwnerEmail(value: string | null | undefined) {
  return Boolean(value && OWNER_EMAILS.includes(value.trim().toLowerCase() as (typeof OWNER_EMAILS)[number]))
}
