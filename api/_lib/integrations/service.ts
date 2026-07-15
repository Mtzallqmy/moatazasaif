import { recordAudit } from '../audit.js'
import { decryptSecret, encryptSecret } from '../crypto.js'
import { ApiError } from '../http.js'
import { redactText } from '../redaction.js'
import { getAdminClient } from '../supabase.js'
import { listGitHubRepositories, testGitHubToken } from './github.js'
import type { ExternalIntegrationCreateInput, ExternalIntegrationTestInput } from './schemas.js'
import type { ExternalIntegrationRow, GitHubCredentials, PublicExternalIntegration, WhatsAppCredentials } from './types.js'
import { sendWhatsAppText, testWhatsAppCredentials } from './whatsapp.js'

function publicIntegration(row: ExternalIntegrationRow): PublicExternalIntegration {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    accountId: row.external_account_id,
    accountName: row.external_account_name || undefined,
    config: row.config || {},
    isEnabled: row.is_enabled,
    status: row.status,
    lastCheckedAt: row.last_checked_at || undefined,
    lastErrorMessage: row.last_error_message || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function credentials<T>(row: ExternalIntegrationRow): T {
  try {
    return JSON.parse(decryptSecret(row.encrypted_credentials)) as T
  } catch {
    throw new ApiError(500, 'تعذر فك بيانات اعتماد التكامل', 'integration_credentials_unavailable')
  }
}

async function ownedIntegration(userId: string, integrationId: string) {
  const { data, error } = await getAdminClient().from('external_integrations').select('*').eq('id', integrationId).eq('user_id', userId).maybeSingle()
  if (error) throw new ApiError(500, 'تعذر قراءة التكامل', 'integration_read_failed')
  if (!data) throw new ApiError(404, 'التكامل غير موجود', 'integration_not_found')
  return data as ExternalIntegrationRow
}

async function updateCheck(row: ExternalIntegrationRow, updates: Record<string, unknown>) {
  const { data, error } = await getAdminClient().from('external_integrations').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', row.id).eq('user_id', row.user_id).select('*').single()
  if (error || !data) throw new ApiError(500, 'تعذر تحديث حالة التكامل', 'integration_update_failed')
  return publicIntegration(data as ExternalIntegrationRow)
}

export async function listExternalIntegrations(userId: string) {
  const { data, error } = await getAdminClient().from('external_integrations').select('*').eq('user_id', userId).order('created_at', { ascending: false })
  if (error) throw new ApiError(500, 'تعذر تحميل التكاملات', 'integrations_read_failed')
  return (data || []).map((row) => publicIntegration(row as ExternalIntegrationRow))
}

export async function testExternalCredentials(input: ExternalIntegrationTestInput) {
  if (input.kind === 'github') return { kind: input.kind, account: await testGitHubToken(input.token) }
  return { kind: input.kind, phone: await testWhatsAppCredentials(input.accessToken, input.phoneNumberId, input.apiVersion) }
}

export async function createExternalIntegration(userId: string, input: ExternalIntegrationCreateInput) {
  const checkedAt = new Date().toISOString()
  let values: Record<string, unknown>
  if (input.kind === 'github') {
    const account = await testGitHubToken(input.token)
    values = {
      user_id: userId,
      kind: input.kind,
      name: input.name,
      encrypted_credentials: encryptSecret(JSON.stringify({ token: input.token } satisfies GitHubCredentials)),
      external_account_id: account.id,
      external_account_name: account.login,
      config: { login: account.login, displayName: account.name, avatarUrl: account.avatarUrl, scopes: account.scopes, rateLimitRemaining: account.rateLimitRemaining },
      last_checked_at: checkedAt,
    }
  } else {
    const phone = await testWhatsAppCredentials(input.accessToken, input.phoneNumberId, input.apiVersion)
    values = {
      user_id: userId,
      kind: input.kind,
      name: input.name,
      encrypted_credentials: encryptSecret(JSON.stringify({ accessToken: input.accessToken, phoneNumberId: input.phoneNumberId, apiVersion: input.apiVersion } satisfies WhatsAppCredentials)),
      external_account_id: phone.id,
      external_account_name: phone.displayPhoneNumber || phone.verifiedName || phone.id,
      config: { displayPhoneNumber: phone.displayPhoneNumber, verifiedName: phone.verifiedName, qualityRating: phone.qualityRating, apiVersion: phone.apiVersion },
      last_checked_at: checkedAt,
    }
  }

  const { data, error } = await getAdminClient().from('external_integrations').insert(values).select('*').single()
  if (error?.code === '23505') throw new ApiError(409, 'هذا الحساب متصل بالفعل', 'integration_already_exists')
  if (error || !data) throw new ApiError(500, 'تعذر حفظ التكامل', 'integration_create_failed')
  await recordAudit(userId, userId, 'EXTERNAL_INTEGRATION_CREATED', { integrationId: data.id, kind: input.kind })
  return publicIntegration(data as ExternalIntegrationRow)
}

export async function checkExternalIntegration(userId: string, integrationId: string) {
  const row = await ownedIntegration(userId, integrationId)
  try {
    if (row.kind === 'github') {
      const account = await testGitHubToken(credentials<GitHubCredentials>(row).token)
      const result = await updateCheck(row, { status: row.is_enabled ? 'connected' : 'disabled', last_checked_at: new Date().toISOString(), last_error_message: null, external_account_name: account.login, config: { login: account.login, displayName: account.name, avatarUrl: account.avatarUrl, scopes: account.scopes, rateLimitRemaining: account.rateLimitRemaining } })
      await recordAudit(userId, userId, 'EXTERNAL_INTEGRATION_CHECKED', { integrationId, kind: row.kind, ok: true })
      return result
    }
    const value = credentials<WhatsAppCredentials>(row)
    const phone = await testWhatsAppCredentials(value.accessToken, value.phoneNumberId, value.apiVersion)
    const result = await updateCheck(row, { status: row.is_enabled ? 'connected' : 'disabled', last_checked_at: new Date().toISOString(), last_error_message: null, external_account_name: phone.displayPhoneNumber || phone.verifiedName || phone.id, config: { displayPhoneNumber: phone.displayPhoneNumber, verifiedName: phone.verifiedName, qualityRating: phone.qualityRating, apiVersion: phone.apiVersion } })
    await recordAudit(userId, userId, 'EXTERNAL_INTEGRATION_CHECKED', { integrationId, kind: row.kind, ok: true })
    return result
  } catch (error) {
    const message = redactText(error instanceof Error ? error.message : 'فشل اختبار الاتصال')
    await updateCheck(row, { status: 'error', last_checked_at: new Date().toISOString(), last_error_message: message })
    await recordAudit(userId, userId, 'EXTERNAL_INTEGRATION_CHECKED', { integrationId, kind: row.kind, ok: false })
    throw error
  }
}

export async function getExternalRepositories(userId: string, integrationId: string) {
  const row = await ownedIntegration(userId, integrationId)
  if (row.kind !== 'github') throw new ApiError(400, 'هذا الإجراء خاص بـ GitHub', 'integration_kind_mismatch')
  if (!row.is_enabled) throw new ApiError(409, 'التكامل معطل', 'integration_disabled')
  const repositories = await listGitHubRepositories(credentials<GitHubCredentials>(row).token)
  await recordAudit(userId, userId, 'GITHUB_REPOSITORIES_LISTED', { integrationId, count: repositories.length })
  return repositories
}

export async function sendExternalWhatsAppMessage(userId: string, integrationId: string, recipient: string, message: string) {
  const row = await ownedIntegration(userId, integrationId)
  if (row.kind !== 'whatsapp') throw new ApiError(400, 'هذا الإجراء خاص بـ WhatsApp', 'integration_kind_mismatch')
  if (!row.is_enabled) throw new ApiError(409, 'التكامل معطل', 'integration_disabled')
  const value = credentials<WhatsAppCredentials>(row)
  const result = await sendWhatsAppText(value.accessToken, value.phoneNumberId, value.apiVersion, recipient, message)
  await recordAudit(userId, userId, 'WHATSAPP_TEST_MESSAGE_SENT', { integrationId, messageId: result.messageId })
  return result
}

export async function setExternalIntegrationEnabled(userId: string, integrationId: string, isEnabled: boolean) {
  const row = await ownedIntegration(userId, integrationId)
  if (!isEnabled) {
    const result = await updateCheck(row, { is_enabled: false, status: 'disabled', last_error_message: null })
    await recordAudit(userId, userId, 'EXTERNAL_INTEGRATION_TOGGLED', { integrationId, kind: row.kind, isEnabled: false })
    return result
  }
  await updateCheck(row, { is_enabled: true, status: 'error', last_error_message: 'جارٍ إعادة التحقق من الاتصال' })
  await recordAudit(userId, userId, 'EXTERNAL_INTEGRATION_TOGGLED', { integrationId, kind: row.kind, isEnabled: true })
  return checkExternalIntegration(userId, integrationId)
}

export async function deleteExternalIntegration(userId: string, integrationId: string) {
  const row = await ownedIntegration(userId, integrationId)
  const { error } = await getAdminClient().from('external_integrations').delete().eq('id', integrationId).eq('user_id', userId)
  if (error) throw new ApiError(500, 'تعذر حذف التكامل', 'integration_delete_failed')
  await recordAudit(userId, userId, 'EXTERNAL_INTEGRATION_DELETED', { integrationId, kind: row.kind })
  return { deleted: true }
}
