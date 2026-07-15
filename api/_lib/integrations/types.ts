export type ExternalIntegrationKind = 'github' | 'whatsapp'

export interface ExternalIntegrationRow {
  id: string
  user_id: string
  kind: ExternalIntegrationKind
  name: string
  encrypted_credentials: { ciphertext: string; iv: string; authTag: string }
  config: Record<string, unknown>
  external_account_id: string
  external_account_name: string | null
  is_enabled: boolean
  status: 'connected' | 'error' | 'disabled'
  last_checked_at: string | null
  last_error_message: string | null
  created_at: string
  updated_at: string
}

export interface PublicExternalIntegration {
  id: string
  kind: ExternalIntegrationKind
  name: string
  accountId: string
  accountName?: string
  config: Record<string, unknown>
  isEnabled: boolean
  status: 'connected' | 'error' | 'disabled'
  lastCheckedAt?: string
  lastErrorMessage?: string
  createdAt: string
  updatedAt: string
}

export interface GitHubCredentials { token: string }
export interface WhatsAppCredentials { accessToken: string; phoneNumberId: string; apiVersion: string }
