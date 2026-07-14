export const CREDENTIAL_MODES = ['session', 'saved'] as const
export type CredentialMode = (typeof CREDENTIAL_MODES)[number]
