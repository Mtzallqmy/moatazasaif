import { encryptSecret, decryptSecret } from '../crypto.js'
import { getAdminClient } from '../supabase.js'
import { ApiError } from '../http.js'
import { getTelegramRuntimeEnv, getTelegramWebhookUrl } from '../env.js'
import { generateProviderText, type ProviderRecord } from '../provider-runtime.js'
import { loadOwnedProviderCredentials } from '../provider-credentials.js'
import { enforceRateLimitKey } from '../rate-limit.js'
import { logTechnicalError, redactText } from '../redaction.js'
import { recordAudit } from '../audit.js'
import { deleteWebhook, getChat, getMe, getWebhookInfo, sendChatAction, sendMessage, setMyCommands, setWebhook } from './client.js'
import { generateLinkCode, generateWebhookSecret, normalizeBotToken, sha256Hex } from './security.js'
import { chatIdFromMessage, messageFromUpdate, publicChatFields, publicChatFieldsFromChat, providerMessagesFromTelegramRows, splitTelegramMessage, telegramCommand } from './messages.js'
import type { TelegramBotUser, TelegramChatLinkRow, TelegramIntegrationDiagnostic, TelegramIntegrationRow, TelegramPublicChatLink, TelegramPublicIntegration, TelegramUpdate, TelegramWebhookInfo } from './types.js'
import { TelegramApiError } from './types.js'

const INTEGRATION_COLUMNS = 'id,user_id,name,bot_id,bot_username,bot_first_name,encrypted_bot_token,webhook_secret_hash,previous_webhook_secret_hash,previous_webhook_secret_expires_at,provider_id,model,is_enabled,status,webhook_url,pending_update_count,last_error_message,last_webhook_checked_at,last_update_at,created_at,updated_at'

const BOT_COMMANDS = [
  { command: 'start', description: 'بدء الاستخدام وطريقة الربط' },
  { command: 'connect', description: 'ربط هذه المحادثة بحسابك' },
  { command: 'help', description: 'عرض الأوامر المتاحة' },
  { command: 'new', description: 'بدء سياق جديد' },
  { command: 'status', description: 'عرض حالة المزود والنموذج' },
]

function errorDescription(error: unknown) {
  if (error instanceof TelegramApiError) return redactText(error.details.description)
  return redactText(error instanceof Error ? error.message : 'فشل غير معروف')
}

function publicChat(row: TelegramChatLinkRow): TelegramPublicChatLink {
  return {
    id: row.id,
    telegramChatId: row.telegram_chat_id,
    telegramUserId: row.telegram_user_id || undefined,
    chatType: row.chat_type || undefined,
    username: row.username || undefined,
    firstName: row.first_name || undefined,
    lastName: row.last_name || undefined,
    title: row.title || undefined,
    isAllowed: row.is_allowed,
    linkedAt: row.linked_at,
    lastMessageAt: row.last_message_at || undefined,
  }
}

export function publicTelegramIntegration(row: TelegramIntegrationRow, chats: TelegramChatLinkRow[] = []): TelegramPublicIntegration {
  return {
    id: row.id,
    name: row.name,
    botId: row.bot_id,
    botUsername: row.bot_username || undefined,
    botFirstName: row.bot_first_name || undefined,
    providerId: row.provider_id,
    model: row.model,
    status: row.status,
    isEnabled: row.is_enabled,
    webhookUrl: row.webhook_url || undefined,
    pendingUpdateCount: row.pending_update_count ?? undefined,
    lastErrorMessage: row.last_error_message ? redactText(row.last_error_message) : undefined,
    lastWebhookCheckedAt: row.last_webhook_checked_at || undefined,
    lastUpdateAt: row.last_update_at || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    chats: chats.map(publicChat),
  }
}

export async function getOwnedTelegramIntegration(userId: string, integrationId: string, includeChats = true) {
  const admin = getAdminClient()
  const { data, error } = await admin.from('telegram_integrations').select(INTEGRATION_COLUMNS).eq('id', integrationId).eq('user_id', userId).maybeSingle()
  if (error) throw new ApiError(500, 'تعذر قراءة تكامل Telegram', 'telegram_integration_read_failed')
  if (!data) throw new ApiError(404, 'تكامل Telegram غير موجود', 'telegram_integration_not_found')
  const chats = includeChats ? await listIntegrationChats(integrationId) : []
  return { integration: data as TelegramIntegrationRow, chats }
}

export async function listOwnedTelegramIntegrations(userId: string) {
  const admin = getAdminClient()
  const { data, error } = await admin.from('telegram_integrations').select(INTEGRATION_COLUMNS).eq('user_id', userId).order('created_at', { ascending: false })
  if (error) throw new ApiError(500, 'تعذر تحميل تكاملات Telegram', 'telegram_integrations_read_failed')
  const rows = (data || []) as TelegramIntegrationRow[]
  if (!rows.length) return []
  const { data: chats, error: chatsError } = await admin.from('telegram_chat_links').select('*').in('integration_id', rows.map((row) => row.id)).order('linked_at', { ascending: false })
  if (chatsError) throw new ApiError(500, 'تعذر تحميل محادثات Telegram', 'telegram_chats_read_failed')
  const byIntegration = new Map<string, TelegramChatLinkRow[]>()
  for (const chat of (chats || []) as TelegramChatLinkRow[]) byIntegration.set(chat.integration_id, [...(byIntegration.get(chat.integration_id) || []), chat])
  return rows.map((row) => publicTelegramIntegration(row, byIntegration.get(row.id) || []))
}

async function listIntegrationChats(integrationId: string) {
  const { data, error } = await getAdminClient().from('telegram_chat_links').select('*').eq('integration_id', integrationId).order('linked_at', { ascending: false })
  if (error) throw new ApiError(500, 'تعذر تحميل محادثات Telegram', 'telegram_chats_read_failed')
  return (data || []) as TelegramChatLinkRow[]
}

async function getTelegramProvider(userId: string, providerId: string, model: string) {
  const { data, error } = await getAdminClient().from('providers').select('id,name,type,protocol,base_url,model,models,is_enabled,status').eq('id', providerId).eq('user_id', userId).maybeSingle()
  if (error) throw new ApiError(500, 'تعذر قراءة مزود الذكاء الاصطناعي', 'telegram_provider_read_failed')
  if (!data || data.is_enabled === false) throw new ApiError(404, 'المزود غير موجود أو غير مفعّل', 'telegram_provider_not_found')
  if (data.status !== 'connected') throw new ApiError(400, 'اختبر المزود بنجاح قبل ربط Telegram', 'telegram_provider_not_tested')
  const models = Array.isArray(data.models) ? data.models.filter((item: unknown): item is string => typeof item === 'string') : []
  if (models.length > 0 && !models.includes(model) && data.model !== model) throw new ApiError(400, 'النموذج غير موجود ضمن النماذج المكتشفة للمزود', 'telegram_model_not_found')
  return data as ProviderRecord & { models?: string[]; status: string; is_enabled: boolean }
}

function webhookUpdateFields(info: TelegramWebhookInfo) {
  return {
    pending_update_count: Math.max(0, Number(info.pending_update_count || 0)),
    last_webhook_checked_at: new Date().toISOString(),
    last_error_message: info.last_error_message ? redactText(info.last_error_message) : null,
  }
}

async function registerTelegramWebhook(integration: TelegramIntegrationRow, token: string) {
  const webhookUrl = getTelegramWebhookUrl()
  const secret = generateWebhookSecret()
  const secretHash = sha256Hex(secret)
  const previousHash = integration.webhook_secret_hash
  const previousExpiresAt = new Date(Date.now() + 15 * 60_000).toISOString()
  const admin = getAdminClient()

  // Stage the new hash before asking Telegram to use it, while accepting the
  // previous hash for a short grace period. This closes the failure window
  // where Telegram had a new secret but the database only knew the old one.
  const { error: secretError } = await admin.from('telegram_integrations').update({
    webhook_secret_hash: secretHash,
    previous_webhook_secret_hash: previousHash,
    previous_webhook_secret_expires_at: previousExpiresAt,
    webhook_url: webhookUrl,
    status: 'registering',
    updated_at: new Date().toISOString(),
  }).eq('id', integration.id).eq('user_id', integration.user_id)
  if (secretError) throw new ApiError(500, 'تعذر حفظ سر Webhook الجديد', 'telegram_webhook_secret_state_failed')

  try {
    await setWebhook(token, {
      url: webhookUrl,
      secret_token: secret,
      allowed_updates: ['message', 'callback_query'],
      drop_pending_updates: false,
    })
  } catch (error) {
    await admin.from('telegram_integrations').update({
      webhook_secret_hash: previousHash,
      previous_webhook_secret_hash: integration.previous_webhook_secret_hash,
      previous_webhook_secret_expires_at: integration.previous_webhook_secret_expires_at,
      status: integration.status,
      updated_at: new Date().toISOString(),
    }).eq('id', integration.id).eq('user_id', integration.user_id)
    throw error
  }

  await setMyCommands(token, BOT_COMMANDS)
  const info = await getWebhookInfo(token)
  const now = new Date().toISOString()
  const { data, error } = await admin.from('telegram_integrations').update({
    webhook_secret_hash: secretHash,
    webhook_url: webhookUrl,
    status: info.url === webhookUrl ? 'connected' : 'error',
    ...webhookUpdateFields(info),
    updated_at: now,
  }).eq('id', integration.id).eq('user_id', integration.user_id).select(INTEGRATION_COLUMNS).single()
  if (error || !data) throw new ApiError(500, 'تعذر حفظ حالة Webhook', 'telegram_webhook_state_failed')
  await recordAudit(integration.user_id, integration.user_id, 'telegram.webhook.registered', { integrationId: integration.id, botId: integration.bot_id, webhookUrl })
  if (info.url !== webhookUrl) throw new ApiError(502, 'لم يؤكد Telegram عنوان Webhook المتوقع', 'telegram_webhook_not_confirmed', { pendingUpdateCount: info.pending_update_count })
  return data as TelegramIntegrationRow
}

export async function createTelegramIntegration(userId: string, input: { name: string; botToken: string; providerId: string; model: string; telegramChatId?: string }) {
  const token = normalizeBotToken(input.botToken)
  await getTelegramProvider(userId, input.providerId, input.model)
  let bot: TelegramBotUser
  try {
    bot = await getMe(token)
  } catch (error) {
    throw new ApiError(error instanceof TelegramApiError && error.details.status === 401 ? 401 : 502, errorDescription(error), 'telegram_getme_failed')
  }
  if (!bot?.is_bot) throw new ApiError(400, 'التوكن لا يمثل Telegram Bot', 'telegram_not_a_bot')

  // A supplied chat ID enables a direct setup without requiring a one-time
  // link code. getChat is a real Telegram API check; it also gives us the
  // canonical chat metadata to store. Telegram still requires the user to
  // press Start before a bot can send the first message in a private chat.
  let directChat: Awaited<ReturnType<typeof getChat>> | undefined
  if (input.telegramChatId) {
    try {
      directChat = await getChat(token, input.telegramChatId)
    } catch (error) {
      const status = error instanceof TelegramApiError && error.details.status === 400 ? 400 : 502
      throw new ApiError(status, status === 400 ? 'معرّف Telegram غير متاح لهذا البوت. افتح البوت واضغط Start ثم أعد المحاولة.' : errorDescription(error), 'telegram_chat_validation_failed')
    }
  }

  const secret = generateWebhookSecret()
  const now = new Date().toISOString()
  const { data: inserted, error: insertError } = await getAdminClient().from('telegram_integrations').insert({
    user_id: userId,
    name: input.name.trim(),
    bot_id: String(bot.id),
    bot_username: bot.username || null,
    bot_first_name: bot.first_name || null,
    encrypted_bot_token: encryptSecret(token),
    webhook_secret_hash: sha256Hex(secret),
    provider_id: input.providerId,
    model: input.model.trim(),
    status: 'registering',
    is_enabled: true,
    created_at: now,
    updated_at: now,
  }).select(INTEGRATION_COLUMNS).single()
  if (insertError || !inserted) {
    logTechnicalError('[telegram-integration-create-failed]', insertError, { userId, botId: String(bot.id), providerId: input.providerId })
    throw new ApiError(insertError?.code === '23505' ? 409 : 500, insertError?.code === '23505' ? 'هذا البوت مرتبط مسبقًا بالمنصة؛ لكل بوت Webhook واحد فقط' : 'تعذر حفظ تكامل Telegram', insertError?.code === '23505' ? 'telegram_bot_already_exists' : 'telegram_integration_create_failed')
  }

  const integration = inserted as TelegramIntegrationRow
  let webhookConfigured = false
  try {
    // The initial secret is passed once to Telegram. It is stored only as a
    // hash, so re-registration always rotates it through the PATCH action.
    const webhookUrl = getTelegramWebhookUrl()
    await setWebhook(token, { url: webhookUrl, secret_token: secret, allowed_updates: ['message', 'callback_query'], drop_pending_updates: false })
    webhookConfigured = true
    await setMyCommands(token, BOT_COMMANDS)
    const info = await getWebhookInfo(token)
    const fields = { webhook_url: webhookUrl, status: info.url === webhookUrl ? 'connected' : 'error', ...webhookUpdateFields(info), updated_at: new Date().toISOString() }
    const { data: updated, error: updateError } = await getAdminClient().from('telegram_integrations').update(fields).eq('id', integration.id).select(INTEGRATION_COLUMNS).single()
    if (updateError || !updated) throw new ApiError(500, 'تعذر حفظ حالة Webhook', 'telegram_webhook_state_failed')
    if (info.url !== webhookUrl) throw new ApiError(502, 'لم يؤكد Telegram عنوان Webhook المتوقع', 'telegram_webhook_not_confirmed')
    if (directChat) {
      const chatFields = publicChatFieldsFromChat(directChat)
      const { error: chatError } = await getAdminClient().from('telegram_chat_links').upsert({ integration_id: integration.id, ...chatFields, is_allowed: true, linked_at: new Date().toISOString() }, { onConflict: 'integration_id,telegram_chat_id' })
      if (chatError) throw new ApiError(500, 'تم تسجيل البوت لكن تعذر حفظ معرّف Telegram', 'telegram_chat_link_failed')
      await sendText(token, String(directChat.id), 'تم ربط حسابك بنجاح. أرسل رسالتك الآن، أو استخدم /help لعرض الأوامر.').catch(() => undefined)
    }
    await recordAudit(userId, userId, 'telegram.integration.created', { integrationId: integration.id, botId: String(bot.id), providerId: input.providerId, model: input.model.trim() })
    await recordAudit(userId, userId, 'telegram.webhook.registered', { integrationId: integration.id, webhookUrl })
    return publicTelegramIntegration(updated as TelegramIntegrationRow, directChat ? await listIntegrationChats(integration.id) : [])
  } catch (error) {
    const message = errorDescription(error)
    if (webhookConfigured) {
      try { await deleteWebhook(token, false) } catch (cleanupError) { logTechnicalError('[telegram-create-cleanup-failed]', cleanupError, { integrationId: integration.id, userId }) }
    }
    // Do not leave an unusable row that blocks a retry through the unique
    // (user_id, bot_id) constraint. The token was never returned to the
    // client, and the encrypted row is removed by this ownership-scoped delete.
    await getAdminClient().from('telegram_integrations').delete().eq('id', integration.id).eq('user_id', userId)
    await recordAudit(userId, userId, 'telegram.webhook.failed', { integrationId: integration.id, error: message })
    throw error instanceof ApiError ? error : new ApiError(error instanceof TelegramApiError && error.details.status === 401 ? 401 : 502, message, 'telegram_webhook_registration_failed')
  }
}

export async function testTelegramToken(botToken: string, telegramChatId?: string) {
  const token = normalizeBotToken(botToken)
  try {
    const bot = await getMe(token)
    if (!bot?.is_bot) throw new ApiError(400, 'التوكن لا يمثل Telegram Bot', 'telegram_not_a_bot')
    let chat
    if (telegramChatId) {
      try {
        chat = await getChat(token, telegramChatId)
      } catch (error) {
        const status = error instanceof TelegramApiError && error.details.status === 400 ? 400 : 502
        throw new ApiError(status, status === 400 ? 'معرّف Telegram غير متاح لهذا البوت. افتح البوت واضغط Start ثم أعد المحاولة.' : errorDescription(error), 'telegram_chat_validation_failed')
      }
    }
    return { botId: String(bot.id), botUsername: bot.username, botFirstName: bot.first_name, chat: chat ? { id: String(chat.id), type: chat.type, username: chat.username, firstName: chat.first_name, lastName: chat.last_name, title: chat.title } : undefined, message: chat ? 'تم التحقق من التوكن ومعرّف Telegram عبر Telegram API فعليًا' : 'تم التحقق من التوكن عبر Telegram getMe فعليًا' }
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new ApiError(error instanceof TelegramApiError && error.details.status === 401 ? 401 : 502, errorDescription(error), 'telegram_getme_failed')
  }
}

export async function checkTelegramWebhook(userId: string, integrationId: string) {
  const { integration } = await getOwnedTelegramIntegration(userId, integrationId, false)
  const token = decryptSecret(integration.encrypted_bot_token)
  try {
    const info = await getWebhookInfo(token)
    const expectedUrl = getTelegramWebhookUrl()
    const fields = { ...webhookUpdateFields(info), status: integration.is_enabled ? info.url === expectedUrl ? 'connected' : 'error' : 'disabled', updated_at: new Date().toISOString() }
    const { data, error } = await getAdminClient().from('telegram_integrations').update(fields).eq('id', integration.id).select(INTEGRATION_COLUMNS).single()
    if (error || !data) throw new ApiError(500, 'تعذر حفظ فحص Webhook', 'telegram_webhook_check_failed')
    return publicTelegramIntegration(data as TelegramIntegrationRow, await listIntegrationChats(integration.id))
  } catch (error) {
    const message = errorDescription(error)
    await getAdminClient().from('telegram_integrations').update({ status: 'error', last_error_message: message, last_webhook_checked_at: new Date().toISOString() }).eq('id', integration.id)
    throw error instanceof ApiError ? error : new ApiError(502, message, 'telegram_webhook_check_failed')
  }
}

export async function diagnoseTelegramIntegration(userId: string, integrationId: string): Promise<TelegramIntegrationDiagnostic> {
  const { integration, chats } = await getOwnedTelegramIntegration(userId, integrationId, true)
  const admin = getAdminClient()
  const recommendations: string[] = []
  let tokenValid = false
  let bot: TelegramBotUser | undefined
  let webhookInfo: TelegramWebhookInfo | undefined
  let providerValid = false

  try {
    const token = decryptSecret(integration.encrypted_bot_token)
    bot = await getMe(token)
    tokenValid = Boolean(bot?.is_bot)
    if (tokenValid) {
      try {
        webhookInfo = await getWebhookInfo(token)
      } catch (error) {
        recommendations.push(`تعذر قراءة حالة Webhook: ${errorDescription(error)}`)
      }
    }
  } catch (error) {
    recommendations.push(`تحقق من Bot Token: ${errorDescription(error)}`)
  }

  try {
    await getTelegramProvider(userId, integration.provider_id, integration.model)
    providerValid = true
  } catch (error) {
    recommendations.push(errorDescription(error))
  }

  const expectedUrl = (() => { try { return getTelegramWebhookUrl() } catch { return undefined } })()
  const webhookMatches = Boolean(webhookInfo?.url && expectedUrl && webhookInfo.url === expectedUrl)
  const allowedChats = chats.filter((chat) => chat.is_allowed).length
  if (!webhookInfo?.url) recommendations.push('سجّل Webhook من زر إصلاح الاتصال.')
  else if (!webhookMatches) recommendations.push('أعد تسجيل Webhook ليطابق نقطة الاتصال الإنتاجية.')
  if (allowedChats === 0) recommendations.push('أنشئ رابط ربط آمن وافتحه من حساب Telegram المطلوب.')
  if (!providerValid) recommendations.push('اختبر مزود الذكاء الاصطناعي والنموذج ثم أعد التشخيص.')

  const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString()
  const { data: recentRows, error: activityError } = await admin.from('telegram_updates')
    .select('status,received_at,processed_at')
    .eq('integration_id', integrationId)
    .gte('received_at', since)
    .order('received_at', { ascending: false })
    .limit(500)
  if (activityError) recommendations.push('تعذر قراءة سجل نشاط آخر 24 ساعة.')
  const activity = (recentRows || []) as Array<{ status: string; received_at: string; processed_at: string | null }>
  const failed24h = activity.filter((row) => row.status === 'failed').length
  const processed24h = activity.filter((row) => row.status === 'processed').length
  const pending = Math.max(0, Number(webhookInfo?.pending_update_count || 0))
  const lastErrorAt = webhookInfo?.last_error_date ? new Date(webhookInfo.last_error_date * 1_000).toISOString() : undefined
  const recentDeliveryError = Boolean(webhookInfo?.last_error_message && (!lastErrorAt || Date.now() - new Date(lastErrorAt).getTime() < 60 * 60_000))
  const offline = !tokenValid || !webhookMatches
  const degraded = !providerValid || allowedChats === 0 || failed24h > 0 || pending > 5 || recentDeliveryError
  const overall: TelegramIntegrationDiagnostic['overall'] = offline ? 'offline' : degraded ? 'degraded' : 'healthy'

  if (webhookInfo) {
    await admin.from('telegram_integrations').update({
      ...webhookUpdateFields(webhookInfo),
      status: integration.is_enabled ? webhookMatches ? 'connected' : 'error' : 'disabled',
      updated_at: new Date().toISOString(),
    }).eq('id', integrationId).eq('user_id', userId)
  }

  const checks: TelegramIntegrationDiagnostic['checks'] = [
    { key: 'token', ok: tokenValid, labelAr: 'هوية البوت', labelEn: 'Bot identity', detailAr: tokenValid ? 'Bot Token صالح وتم التحقق من الهوية.' : 'تعذر التحقق من Bot Token.', detailEn: tokenValid ? 'The token is valid and the bot identity was verified.' : 'The bot token could not be verified.' },
    { key: 'webhook', ok: webhookMatches && !recentDeliveryError, labelAr: 'قناة Webhook', labelEn: 'Webhook channel', detailAr: webhookMatches ? recentDeliveryError ? 'العنوان صحيح لكن Telegram سجّل خطأ توصيل حديثًا.' : 'العنوان والسر يعملان على نقطة الإنتاج.' : 'العنوان غير مسجل أو لا يطابق نقطة الإنتاج.', detailEn: webhookMatches ? recentDeliveryError ? 'The URL matches, but Telegram reported a recent delivery error.' : 'The production endpoint and secret are active.' : 'The URL is missing or does not match production.' },
    { key: 'provider', ok: providerValid, labelAr: 'مزود الذكاء الاصطناعي', labelEn: 'AI provider', detailAr: providerValid ? 'المزود والنموذج محفوظان ومختبران.' : 'المزود أو النموذج غير جاهز.', detailEn: providerValid ? 'The provider and model are saved and verified.' : 'The provider or model is not ready.' },
    { key: 'chat', ok: allowedChats > 0, labelAr: 'المحادثات المصرح بها', labelEn: 'Authorized chats', detailAr: allowedChats > 0 ? `${allowedChats} محادثة مفعلة.` : 'لا توجد محادثة مفعلة.', detailEn: allowedChats > 0 ? `${allowedChats} chat(s) enabled.` : 'No chat has been enabled.' },
  ]

  return {
    overall,
    tokenValid,
    bot: bot ? { id: String(bot.id), username: bot.username, firstName: bot.first_name } : undefined,
    webhook: {
      configured: Boolean(webhookInfo?.url),
      matchesExpected: webhookMatches,
      pendingUpdateCount: pending,
      lastErrorMessage: webhookInfo?.last_error_message ? redactText(webhookInfo.last_error_message) : undefined,
      lastErrorAt,
    },
    providerValid,
    model: integration.model,
    linkedChats: chats.length,
    allowedChats,
    lastUpdateAt: integration.last_update_at || undefined,
    activity: {
      received24h: activity.length,
      processed24h,
      failed24h,
      lastReceivedAt: activity[0]?.received_at,
      lastProcessedAt: activity.find((row) => row.processed_at)?.processed_at || undefined,
    },
    checks,
    recommendations,
  }
}

export async function reregisterTelegramWebhook(userId: string, integrationId: string) {
  const { integration } = await getOwnedTelegramIntegration(userId, integrationId, false)
  if (!integration.is_enabled) throw new ApiError(400, 'فعّل التكامل قبل تسجيل Webhook', 'telegram_integration_disabled')
  const token = decryptSecret(integration.encrypted_bot_token)
  try {
    const updated = await registerTelegramWebhook(integration, token)
    return publicTelegramIntegration(updated, await listIntegrationChats(integration.id))
  } catch (error) {
    const message = errorDescription(error)
    await getAdminClient().from('telegram_integrations').update({ status: 'error', last_error_message: message, updated_at: new Date().toISOString() }).eq('id', integration.id)
    await recordAudit(userId, userId, 'telegram.webhook.failed', { integrationId, error: message })
    throw error instanceof ApiError ? error : new ApiError(502, message, 'telegram_webhook_registration_failed')
  }
}

export async function deleteTelegramIntegration(userId: string, integrationId: string) {
  const { integration } = await getOwnedTelegramIntegration(userId, integrationId, false)
  let warning: string | undefined
  try {
    await deleteWebhook(decryptSecret(integration.encrypted_bot_token), false)
  } catch (error) {
    warning = errorDescription(error)
    logTechnicalError('[telegram-delete-webhook-failed]', error, { integrationId, userId })
  }
  const { error } = await getAdminClient().from('telegram_integrations').delete().eq('id', integrationId).eq('user_id', userId)
  if (error) throw new ApiError(500, 'تعذر حذف تكامل Telegram', 'telegram_integration_delete_failed')
  await recordAudit(userId, userId, 'telegram.integration.deleted', { integrationId, warning })
  return { deleted: true, warning }
}

export async function createTelegramLinkCode(userId: string, integrationId: string) {
  const { integration } = await getOwnedTelegramIntegration(userId, integrationId, false)
  if (!integration.is_enabled) throw new ApiError(400, 'فعّل التكامل قبل إنشاء كود ربط', 'telegram_integration_disabled')
  const admin = getAdminClient()
  await admin.from('telegram_link_codes').delete().eq('integration_id', integrationId).is('used_at', null)
  const code = generateLinkCode()
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString()
  const { error } = await admin.from('telegram_link_codes').insert({ integration_id: integrationId, code_hash: sha256Hex(code), expires_at: expiresAt })
  if (error) throw new ApiError(500, 'تعذر إنشاء كود الربط', 'telegram_link_code_failed')
  const startPayload = `connect_${code}`
  const deepLink = integration.bot_username ? `https://t.me/${integration.bot_username}?start=${startPayload}` : undefined
  return { code, command: `/connect ${code}`, startPayload, deepLink, expiresAt }
}

type LinkResult = 'connected' | 'already_connected' | 'invalid'

async function consumeLinkCode(integrationId: string, code: string, message: TelegramMessageLike): Promise<LinkResult> {
  const admin = getAdminClient()
  const fields = publicChatFields(message)
  const { data: existing } = await admin.from('telegram_chat_links').select('id,is_allowed').eq('integration_id', integrationId).eq('telegram_chat_id', fields.telegram_chat_id).maybeSingle()
  if (existing?.is_allowed) return 'already_connected'
  const normalizedCode = code.trim().toUpperCase()
  if (!/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(normalizedCode)) return 'invalid'
  const { data, error } = await admin.from('telegram_link_codes').update({ used_at: new Date().toISOString() }).eq('integration_id', integrationId).eq('code_hash', sha256Hex(normalizedCode)).is('used_at', null).gt('expires_at', new Date().toISOString()).select('id').maybeSingle()
  if (error || !data) return 'invalid'
  const { error: linkError } = await admin.from('telegram_chat_links').upsert({ integration_id: integrationId, ...fields, is_allowed: true, linked_at: new Date().toISOString() }, { onConflict: 'integration_id,telegram_chat_id' })
  if (linkError) throw new ApiError(500, 'تعذر ربط محادثة Telegram', 'telegram_chat_link_failed')
  await recordAudit(null, null, 'telegram.chat.linked', { integrationId, telegramChatId: fields.telegram_chat_id })
  return 'connected'
}

type TelegramMessageLike = Parameters<typeof publicChatFields>[0]

async function sendText(token: string, chatId: string, text: string, signal?: AbortSignal) {
  const max = getTelegramRuntimeEnv().TELEGRAM_MAX_RESPONSE_CHARACTERS
  const clipped = Array.from(text).slice(0, max).join('')
  for (const chunk of splitTelegramMessage(clipped)) await sendMessage(token, { chat_id: chatId, text: chunk }, signal)
}

function commandHelp(isLinked: boolean) {
  return [isLinked ? '✅ هذه المحادثة مرتبطة وجاهزة.' : 'هذه المحادثة غير مرتبطة بعد.', '/start — عرض حالة الربط', '/connect CODE — ربط هذه المحادثة بحسابك', '/help — عرض التعليمات', '/new — بدء سياق جديد', '/status — حالة المزود والنموذج'].join('\n')
}

async function sendCommand(token: string, integration: TelegramIntegrationRow, message: TelegramMessageLike, command: { command: string; args: string }, signal?: AbortSignal) {
  const chatId = String(message.chat.id)
  const admin = getAdminClient()
  const { data: chatLink } = await admin.from('telegram_chat_links').select('id,is_allowed').eq('integration_id', integration.id).eq('telegram_chat_id', chatId).maybeSingle()
  const isLinked = Boolean(chatLink?.is_allowed)
  if (command.command === 'start') {
    const deepLinkCode = command.args.toLowerCase().startsWith('connect_') ? command.args.slice('connect_'.length) : ''
    if (deepLinkCode) {
      const result = await consumeLinkCode(integration.id, deepLinkCode, message)
      return sendText(token, chatId, result === 'connected' ? '✅ تم ربط هذه المحادثة بنجاح. أرسل أي رسالة الآن لبدء الدردشة.' : result === 'already_connected' ? '✅ هذه المحادثة مرتبطة بالفعل وجاهزة. أرسل رسالتك الآن.' : 'انتهت صلاحية رابط الربط أو استُخدم مسبقًا. أنشئ رابطًا جديدًا من الموقع.', signal)
    }
    if (isLinked) return sendText(token, chatId, '✅ حسابك مرتبط بالفعل والبوت جاهز. أرسل أي رسالة، أو استخدم /status لفحص الحالة و/new لبدء سياق جديد.', signal)
    if (chatLink) return sendText(token, chatId, 'هذه المحادثة مرتبطة لكنها معطلة من لوحة الموقع. فعّلها ثم أعد المحاولة.', signal)
    return sendText(token, chatId, 'مرحبًا! هذه المحادثة غير مرتبطة بعد. افتح رابط الربط الآمن من صفحة التكاملات، أو أرسل /connect ثم كود الربط.', signal)
  }
  if (command.command === 'help') return sendText(token, chatId, commandHelp(isLinked), signal)
  if (command.command === 'connect') {
    if (isLinked) return sendText(token, chatId, '✅ هذه المحادثة مرتبطة بالفعل وجاهزة. لا تحتاج إلى كود جديد.', signal)
    if (!command.args) return sendText(token, chatId, 'أرسل الأمر بهذا الشكل: /connect CODE\nأو افتح رابط الربط المباشر من صفحة التكاملات.', signal)
    const result = await consumeLinkCode(integration.id, command.args, message)
    return sendText(token, chatId, result === 'connected' ? '✅ تم ربط هذه المحادثة بنجاح. أرسل رسالتك الآن.' : result === 'already_connected' ? '✅ هذه المحادثة مرتبطة بالفعل.' : 'كود الربط غير صحيح أو منتهي أو مستخدم مسبقًا. أنشئ كودًا جديدًا من الموقع.', signal)
  }
  if (command.command === 'new') {
    const { data: link } = await getAdminClient().from('telegram_chat_links').select('id').eq('integration_id', integration.id).eq('telegram_chat_id', chatId).maybeSingle()
    if (!link) return sendText(token, chatId, 'اربط المحادثة أولًا باستخدام كود /connect أو من صفحة الربط المباشر.', signal)
    await getAdminClient().from('telegram_messages').delete().eq('integration_id', integration.id).eq('telegram_chat_id', chatId)
    return sendText(token, chatId, 'بدأت سياقًا جديدًا لهذه المحادثة.', signal)
  }
  if (command.command === 'status') {
    const { data: provider } = await getAdminClient().from('providers').select('name,type,status').eq('id', integration.provider_id).eq('user_id', integration.user_id).maybeSingle()
    return sendText(token, chatId, `المزود: ${provider?.name || provider?.type || 'غير معروف'}\nالنموذج: ${integration.model}\nالحالة: ${integration.status}`, signal)
  }
}

export async function saveReceivedTelegramUpdate(integrationId: string, update: TelegramUpdate) {
  const message = messageFromUpdate(update)
  const { data, error } = await getAdminClient().from('telegram_updates').upsert({ integration_id: integrationId, update_id: update.update_id, telegram_chat_id: chatIdFromMessage(message) || null, status: 'received' }, { onConflict: 'integration_id,update_id', ignoreDuplicates: true }).select('id').maybeSingle()
  if (error) throw new ApiError(500, 'تعذر تسجيل تحديث Telegram', 'telegram_update_record_failed')
  return Boolean(data)
}

export async function findIntegrationByWebhookSecret(secret: string) {
  const admin = getAdminClient()
  const secretHash = sha256Hex(secret)
  const { data, error } = await admin.from('telegram_integrations').select(INTEGRATION_COLUMNS).eq('webhook_secret_hash', secretHash).eq('is_enabled', true).maybeSingle()
  if (error) throw new ApiError(500, 'تعذر التحقق من تكامل Telegram', 'telegram_secret_lookup_failed')
  if (data) return data as TelegramIntegrationRow
  const { data: previous, error: previousError } = await admin.from('telegram_integrations').select(INTEGRATION_COLUMNS)
    .eq('previous_webhook_secret_hash', secretHash)
    .eq('is_enabled', true)
    .gt('previous_webhook_secret_expires_at', new Date().toISOString())
    .limit(1)
    .maybeSingle()
  if (previousError) throw new ApiError(500, 'تعذر التحقق من تكامل Telegram', 'telegram_secret_lookup_failed')
  return previous as TelegramIntegrationRow | null
}

export async function processTelegramUpdate(integrationId: string, updateId: number, update: TelegramUpdate) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), getTelegramRuntimeEnv().TELEGRAM_WEBHOOK_PROCESSING_TIMEOUT_MS)
  const admin = getAdminClient()
  let token: string | undefined
  try {
    const { data: integrationData, error: integrationError } = await admin.from('telegram_integrations').select(INTEGRATION_COLUMNS).eq('id', integrationId).eq('is_enabled', true).maybeSingle()
    if (integrationError || !integrationData) throw new ApiError(404, 'تكامل Telegram غير متاح', 'telegram_integration_not_found')
    const integration = integrationData as TelegramIntegrationRow
    token = decryptSecret(integration.encrypted_bot_token)
    await admin.from('telegram_updates').update({ status: 'processing' }).eq('integration_id', integrationId).eq('update_id', updateId)
    const message = messageFromUpdate(update)
    if (!message || message.from?.is_bot) {
      await admin.from('telegram_updates').update({ status: 'ignored', processed_at: new Date().toISOString() }).eq('integration_id', integrationId).eq('update_id', updateId)
      return
    }
    const chatId = String(message.chat.id)
    const command = message.text ? telegramCommand(message.text) : null
    if (command) {
      await sendCommand(token, integration, message, command, controller.signal)
      await admin.from('telegram_updates').update({ status: 'processed', processed_at: new Date().toISOString() }).eq('integration_id', integrationId).eq('update_id', updateId)
      return
    }
    if (!message.text?.trim()) {
      await sendText(token, chatId, 'أستطيع معالجة الرسائل النصية فقط حاليًا.', controller.signal)
      await admin.from('telegram_updates').update({ status: 'ignored', processed_at: new Date().toISOString() }).eq('integration_id', integrationId).eq('update_id', updateId)
      return
    }
    const { data: link } = await admin.from('telegram_chat_links').select('*').eq('integration_id', integrationId).eq('telegram_chat_id', chatId).maybeSingle()
    if (!link) {
      await sendText(token, chatId, 'هذه المحادثة غير مربوطة. استخدم كود /connect الذي أنشأته من الموقع.')
      await admin.from('telegram_updates').update({ status: 'ignored', processed_at: new Date().toISOString() }).eq('integration_id', integrationId).eq('update_id', updateId)
      return
    }
    if (!(link as TelegramChatLinkRow).is_allowed) {
      await sendText(token, chatId, 'تم تعطيل هذه المحادثة من لوحة الموقع.')
      await admin.from('telegram_updates').update({ status: 'ignored', processed_at: new Date().toISOString() }).eq('integration_id', integrationId).eq('update_id', updateId)
      return
    }
    await enforceRateLimitKey('telegram_generation_integration', 60, 60, [integrationId])
    await enforceRateLimitKey('telegram_generation_chat', 20, 60, [integrationId, chatId])
    await admin.from('telegram_messages').insert({ integration_id: integrationId, telegram_chat_id: chatId, telegram_message_id: message.message_id, role: 'user', content: message.text.trim() })
    await admin.from('telegram_chat_links').update({ last_message_at: new Date().toISOString() }).eq('id', (link as TelegramChatLinkRow).id)
    await sendChatAction(token, { chat_id: chatId, action: 'typing' }, controller.signal).catch(() => undefined)
    const resolved = await loadOwnedProviderCredentials(admin, integration.user_id, integration.provider_id, { requireEnabled: true, requireConnected: true })
    const contextLimit = getTelegramRuntimeEnv().TELEGRAM_MAX_CONTEXT_MESSAGES
    const { data: rows, error: contextError } = await admin.from('telegram_messages').select('role,content').eq('integration_id', integrationId).eq('telegram_chat_id', chatId).order('created_at', { ascending: false }).limit(contextLimit)
    if (contextError) throw new ApiError(500, 'تعذر قراءة سياق Telegram', 'telegram_context_failed')
    const context = providerMessagesFromTelegramRows(((rows || []) as Array<{ role: 'user' | 'assistant'; content: string }>).reverse())
    const result = await generateProviderText(resolved.provider, resolved.apiKey, integration.model, context, controller.signal)
    await admin.from('telegram_messages').insert({ integration_id: integrationId, telegram_chat_id: chatId, role: 'assistant', content: result.content, model: integration.model, tokens: result.usage.totalTokens })
    await sendText(token, chatId, result.content, controller.signal)
    await admin.from('telegram_integrations').update({ last_update_at: new Date().toISOString(), status: 'connected', updated_at: new Date().toISOString() }).eq('id', integrationId)
    await admin.from('telegram_updates').update({ status: 'processed', processed_at: new Date().toISOString() }).eq('integration_id', integrationId).eq('update_id', updateId)
    await recordAudit(integration.user_id, integration.user_id, 'telegram.message.processed', { integrationId, telegramChatId: chatId, model: integration.model, tokens: result.usage.totalTokens })
  } catch (error) {
    const message = errorDescription(error)
    await admin.from('telegram_updates').update({ status: 'failed', error_message: message, processed_at: new Date().toISOString() }).eq('integration_id', integrationId).eq('update_id', updateId)
    await admin.from('telegram_integrations').update({ last_error_message: message, status: 'error', updated_at: new Date().toISOString() }).eq('id', integrationId)
    await recordAudit(null, null, 'telegram.message.failed', { integrationId, updateId, error: message })
    const failedChatId = messageFromUpdate(update)?.chat.id
    if (token && failedChatId !== undefined) await sendText(token, String(failedChatId), 'تعذر معالجة الرسالة حاليًا. تحقق من حالة المزود أو أعد المحاولة.').catch(() => undefined)
    logTechnicalError('[telegram-update-failed]', error, { integrationId, updateId })
  } finally {
    clearTimeout(timer)
  }
}

export async function updateTelegramChat(userId: string, integrationId: string, chatId: string, isAllowed: boolean) {
  const { integration } = await getOwnedTelegramIntegration(userId, integrationId, false)
  const { data, error } = await getAdminClient().from('telegram_chat_links').update({ is_allowed: isAllowed }).eq('id', chatId).eq('integration_id', integration.id).select('*').maybeSingle()
  if (error || !data) throw new ApiError(404, 'محادثة Telegram غير موجودة', 'telegram_chat_not_found')
  await recordAudit(userId, userId, isAllowed ? 'telegram.chat.enabled' : 'telegram.chat.disabled', { integrationId, chatId })
  return publicChat(data as TelegramChatLinkRow)
}

export async function sendTelegramTestMessage(userId: string, integrationId: string, chatId: string) {
  const { integration } = await getOwnedTelegramIntegration(userId, integrationId, false)
  const { data: link } = await getAdminClient().from('telegram_chat_links').select('*').eq('id', chatId).eq('integration_id', integrationId).maybeSingle()
  if (!link) throw new ApiError(404, 'محادثة Telegram غير موجودة', 'telegram_chat_not_found')
  if (!(link as TelegramChatLinkRow).is_allowed) throw new ApiError(403, 'هذه المحادثة معطلة', 'telegram_chat_disabled')
  await sendText(decryptSecret(integration.encrypted_bot_token), (link as TelegramChatLinkRow).telegram_chat_id, 'رسالة اختبار من Moataz AI — التكامل يعمل فعليًا.')
  return { sent: true }
}

export async function updateTelegramIntegration(userId: string, integrationId: string, input: { name?: string; providerId?: string; model?: string; isEnabled?: boolean }) {
  const { integration } = await getOwnedTelegramIntegration(userId, integrationId, false)
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (input.name !== undefined) update.name = input.name.trim()
  if (input.providerId !== undefined || input.model !== undefined) {
    const providerId = input.providerId || integration.provider_id
    const model = input.model || integration.model
    await getTelegramProvider(userId, providerId, model)
    update.provider_id = providerId
    update.model = model
  }
  if (input.isEnabled !== undefined) {
    update.is_enabled = input.isEnabled
    update.status = input.isEnabled ? 'registering' : 'disabled'
  }
  const { data, error } = await getAdminClient().from('telegram_integrations').update(update).eq('id', integrationId).eq('user_id', userId).select(INTEGRATION_COLUMNS).single()
  if (error || !data) throw new ApiError(500, 'تعذر تحديث تكامل Telegram', 'telegram_integration_update_failed')
  await recordAudit(userId, userId, 'telegram.integration.updated', { integrationId, fields: Object.keys(update).filter((key) => key !== 'updated_at') })
  if (input.isEnabled === false) {
    try { await deleteWebhook(decryptSecret(integration.encrypted_bot_token), false) } catch (error) { logTechnicalError('[telegram-disable-webhook-failed]', error, { integrationId, userId }) }
  }
  if (input.isEnabled === true) {
    const token = decryptSecret(integration.encrypted_bot_token)
    try {
      const registered = await registerTelegramWebhook(data as TelegramIntegrationRow, token)
      return publicTelegramIntegration(registered, await listIntegrationChats(integrationId))
    } catch (error) {
      const message = errorDescription(error)
      await getAdminClient().from('telegram_integrations').update({ status: 'error', last_error_message: message, updated_at: new Date().toISOString() }).eq('id', integrationId).eq('user_id', userId)
      throw error instanceof ApiError ? error : new ApiError(502, message, 'telegram_webhook_registration_failed')
    }
  }
  return publicTelegramIntegration(data as TelegramIntegrationRow, await listIntegrationChats(integrationId))
}
