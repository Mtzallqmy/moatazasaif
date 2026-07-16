export const CREDENTIAL_MODES = ['session', 'saved', 'platform'] as const
export type CredentialMode = (typeof CREDENTIAL_MODES)[number]
