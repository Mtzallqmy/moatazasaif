import { useEffect, useMemo, useState } from 'react'
import { Bot, CheckCircle, Clipboard, Github, Link2, Loader2, Plug, RefreshCw, Send, Shield, Trash2, Unplug, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '../contexts/AuthContext'
import type { Provider } from '../types'
import { apiJson, authHeaders } from '../lib/api'

type TelegramChat = {
  id: string
  telegramChatId: string
  telegramUserId?: string
  chatType?: string
  username?: string
  firstName?: string
  lastName?: string
  title?: string
  isAllowed: boolean
  linkedAt: string
  lastMessageAt?: string
}

type TelegramIntegration = {
  id: string
  name: string
  botId: string
  botUsername?: string
  botFirstName?: string
  providerId: string
  model: string
  status: 'registering' | 'connected' | 'error' | 'disabled'
  isEnabled: boolean
  webhookUrl?: string
  pendingUpdateCount?: number
  lastErrorMessage?: string
  lastWebhookCheckedAt?: string
  lastUpdateAt?: string
  chats: TelegramChat[]
}

const statusLabels: Record<TelegramIntegration['status'], string> = {
  registering: 'جارٍ التسجيل', connected: 'متصل', error: 'فشل', disabled: 'معطل',
}

export default function Integrations() {
  const { user } = useAuth()
  const [providers, setProviders] = useState<Provider[]>([])
  const [integrations, setIntegrations] = useState<TelegramIntegration[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', botToken: '', telegramChatId: '', providerId: '', model: '' })
  const [testedBot, setTestedBot] = useState<{ botId: string; botUsername?: string; botFirstName?: string; chat?: { id: string; type: string; username?: string; firstName?: string; lastName?: string; title?: string } } | null>(null)
  const [linkCode, setLinkCode] = useState<{ integrationId: string; code: string; command: string; expiresAt: string } | null>(null)

  const connectedProviders = useMemo(() => providers.filter((provider) => provider.isEnabled && provider.status === 'connected'), [providers])
  const selectedProvider = connectedProviders.find((provider) => provider.id === form.providerId)

  const load = async () => {
    if (!user) return
    setLoading(true)
    try {
      const [providerBody, telegramBody] = await Promise.all([
        apiJson<{ providers: Provider[] }>('/api/providers', { headers: await authHeaders(false) }),
        apiJson<{ integrations: TelegramIntegration[] }>('/api/integrations/telegram', { headers: await authHeaders(false) }),
      ])
      const nextProviders = providerBody.providers || []
      setProviders(nextProviders)
      setIntegrations(telegramBody.integrations || [])
      const first = nextProviders.find((provider) => provider.isEnabled && provider.status === 'connected')
      if (first && !form.providerId) setForm((current) => ({ ...current, providerId: first.id, model: first.model || first.models?.[0] || '' }))
    } catch (error) { toast.error(error instanceof Error ? error.message : 'تعذر تحميل تكامل Telegram') }
    finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [user])

  const testToken = async () => {
    if (!form.botToken.trim()) { toast.error('أدخل Bot Token أولًا'); return }
    setBusy('test-token')
    try {
      const result = await apiJson<{ botId: string; botUsername?: string; botFirstName?: string; chat?: { id: string; type: string; username?: string; firstName?: string; lastName?: string; title?: string }; message: string }>('/api/integrations/telegram/test', {
        method: 'POST', headers: await authHeaders(), body: JSON.stringify({ botToken: form.botToken, telegramChatId: form.telegramChatId.trim() || undefined }),
      })
      setTestedBot(result); toast.success(result.message)
    } catch (error) { setTestedBot(null); toast.error(error instanceof Error ? error.message : 'فشل اختبار Bot Token') }
    finally { setBusy(null) }
  }

  const addIntegration = async () => {
    if (!form.name.trim() || !form.botToken.trim() || !form.providerId || !form.model.trim()) { toast.error('الاسم والتوكن والمزود والنموذج مطلوبة'); return }
    if (!testedBot) { toast.error('اختبر Bot Token فعليًا قبل التسجيل'); return }
    setBusy('create')
    try {
      const result = await apiJson<{ integration: TelegramIntegration }>('/api/integrations/telegram', {
        method: 'POST', headers: await authHeaders(), body: JSON.stringify(form),
      })
      setIntegrations((current) => [result.integration, ...current]); setForm((current) => ({ ...current, name: '', botToken: '', telegramChatId: '', model: '' })); setTestedBot(null)
      toast.success(form.telegramChatId.trim() ? 'تم تسجيل Webhook وربط حساب Telegram مباشرةً' : 'تم تسجيل Webhook والتحقق منه عبر Telegram فعليًا')
    } catch (error) { toast.error(error instanceof Error ? error.message : 'تعذر إنشاء التكامل') }
    finally { setBusy(null) }
  }

  const action = async (integrationId: string, actionName: string, extra: Record<string, unknown> = {}) => {
    setBusy(`${actionName}:${integrationId}`)
    try {
      const result = await apiJson<{ integration?: TelegramIntegration; sent?: boolean; chat?: TelegramChat }>(`/api/integrations/telegram`, {
        method: 'PATCH', headers: await authHeaders(), body: JSON.stringify({ action: actionName, integrationId, ...extra }),
      })
      if (result.integration) setIntegrations((current) => current.map((item) => item.id === integrationId ? result.integration! : item))
      if (result.chat) setIntegrations((current) => current.map((item) => item.id === integrationId ? { ...item, chats: item.chats.map((chat) => chat.id === result.chat!.id ? result.chat! : chat) } : item))
      if (result.sent) toast.success('تم إرسال رسالة الاختبار إلى Telegram')
      else if (actionName === 'check-webhook') toast.success('تم فحص Webhook فعليًا')
      else if (actionName === 'register-webhook') toast.success('تم تدوير السر وإعادة تسجيل Webhook')
    } catch (error) { toast.error(error instanceof Error ? error.message : 'فشل تنفيذ العملية') }
    finally { setBusy(null) }
  }

  const generateCode = async (integrationId: string) => {
    setBusy(`code:${integrationId}`)
    try {
      const result = await apiJson<{ code: string; command: string; expiresAt: string }>('/api/integrations/telegram/link-code', {
        method: 'POST', headers: await authHeaders(), body: JSON.stringify({ integrationId }),
      })
      setLinkCode({ integrationId, ...result }); toast.success('تم إنشاء كود ربط صالح لعشر دقائق')
    } catch (error) { toast.error(error instanceof Error ? error.message : 'تعذر إنشاء كود الربط') }
    finally { setBusy(null) }
  }

  const deleteIntegration = async (integration: TelegramIntegration) => {
    if (!confirm(`حذف تكامل ${integration.name}؟ سيتم حذف الروابط وسجل Telegram المرتبط به.`)) return
    setBusy(`delete:${integration.id}`)
    try {
      await apiJson('/api/integrations/telegram', { method: 'DELETE', headers: await authHeaders(), body: JSON.stringify({ id: integration.id }) })
      setIntegrations((current) => current.filter((item) => item.id !== integration.id)); setLinkCode(null); toast.success('تم حذف التكامل')
    } catch (error) { toast.error(error instanceof Error ? error.message : 'تعذر حذف التكامل') }
    finally { setBusy(null) }
  }

  const providerModelOptions = selectedProvider?.models?.length ? selectedProvider.models : selectedProvider?.model ? [selectedProvider.model] : []

  return <div className="p-6 max-w-6xl mx-auto">
    <div className="mb-8"><h1 className="text-3xl font-semibold tracking-tight">التكاملات</h1><p className="text-dark-400 mt-1">Telegram يعمل من الخادم حتى عند إغلاق المتصفح، ويستخدم نفس Runtime والمزود المحفوظ في دردشة الموقع. أدخل معرّف حسابك الاختياري للربط المباشر دون كود.</p></div>
    <div className="card p-6 border-primary-500/30 bg-primary-500/5 mb-8"><div className="flex gap-3"><Shield className="text-primary-400 shrink-0" /><div><h2 className="font-semibold">أمان التكامل</h2><p className="text-sm text-dark-400 mt-1 leading-7">يُختبر التوكن عبر Telegram getMe، ثم يُشفّر داخل Supabase. لا يعاد Bot Token أو Webhook Secret إلى المتصفح، ولا تحفظه هذه الواجهة في localStorage أو sessionStorage.</p></div></div></div>

    <section className="card p-6 mb-8"><div className="flex items-center gap-3 mb-5"><Send className="text-sky-400" /><div><h2 className="text-xl font-semibold">إضافة Telegram Bot</h2><p className="text-xs text-dark-500">أنشئ البوت أولًا من @BotFather ثم الصق التوكن هنا. اضغط Start داخل البوت قبل اختبار معرّف الحساب.</p></div></div><div className="grid md:grid-cols-2 gap-4"><div><label className="text-sm text-dark-300 block mb-1.5">اسم التكامل</label><input className="input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="بوت Moataz AI" /></div><div><label className="text-sm text-dark-300 block mb-1.5">Bot Token</label><input type="password" autoComplete="new-password" dir="ltr" className="input font-mono" value={form.botToken} onChange={(event) => { setForm({ ...form, botToken: event.target.value }); setTestedBot(null) }} placeholder="123456:AA..." /></div><div><label className="text-sm text-dark-300 block mb-1.5">معرّف حساب/محادثة Telegram (اختياري)</label><input inputMode="numeric" dir="ltr" className="input font-mono" value={form.telegramChatId} onChange={(event) => { setForm({ ...form, telegramChatId: event.target.value }); setTestedBot(null) }} placeholder="مثال: 123456789" /><p className="text-xs text-dark-500 mt-1">يُستخدم للربط المباشر. إذا تركته فارغًا استخدم كود /connect لاحقًا.</p></div><div><label className="text-sm text-dark-300 block mb-1.5">المزود المحفوظ والمختبر</label><select className="input" value={form.providerId} onChange={(event) => { const provider = connectedProviders.find((item) => item.id === event.target.value); setForm({ ...form, providerId: event.target.value, model: provider?.model || provider?.models?.[0] || '' }) }}><option value="">اختر مزودًا</option>{connectedProviders.map((provider) => <option key={provider.id} value={provider.id}>{provider.name} — {provider.protocol}</option>)}</select>{connectedProviders.length === 0 && <p className="text-xs text-amber-400 mt-1">لا يوجد مزود محفوظ ومختبر. اذهب إلى صفحة المزودات أولًا.</p>}</div><div><label className="text-sm text-dark-300 block mb-1.5">النموذج</label><select className="input" value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })}><option value="">اختر نموذجًا</option>{providerModelOptions.map((model) => <option key={model} value={model}>{model}</option>)}</select></div></div>{testedBot && <div className="mt-4 rounded-xl bg-emerald-500/10 border border-emerald-600/30 p-3 text-sm text-emerald-300">تم التحقق: {testedBot.botFirstName || 'Bot'} {testedBot.botUsername ? `@${testedBot.botUsername}` : ''} — ID {testedBot.botId}{testedBot.chat ? <><br />المحادثة: {testedBot.chat.title || testedBot.chat.username || testedBot.chat.firstName || testedBot.chat.id} ({testedBot.chat.type})</> : null}</div>}<div className="flex flex-wrap gap-3 mt-5"><button onClick={() => void testToken()} disabled={busy === 'test-token' || !form.botToken} className="btn btn-secondary">{busy === 'test-token' ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle size={16} />} {form.telegramChatId.trim() ? 'اختبار التوكن والمعرّف' : 'اختبار التوكن فعليًا'}</button><button onClick={() => void addIntegration()} disabled={busy === 'create' || !testedBot || connectedProviders.length === 0} className="btn btn-primary">{busy === 'create' ? <Loader2 className="animate-spin" size={16} /> : <Link2 size={16} />} {form.telegramChatId.trim() ? 'ربط مباشر وتسجيل Webhook' : 'تسجيل Webhook وحفظ مشفّر'}</button></div></section>

    {loading ? <div className="card p-12 text-center text-dark-400"><Loader2 className="animate-spin mx-auto mb-3" />جارٍ تحميل التكاملات...</div> : integrations.length === 0 ? <div className="card p-10 text-center text-dark-400">لا توجد تكاملات Telegram محفوظة.</div> : <div className="space-y-5">{integrations.map((integration) => <TelegramCard key={integration.id} integration={integration} busy={busy} linkCode={linkCode?.integrationId === integration.id ? linkCode : null} onAction={action} onGenerateCode={generateCode} onDelete={deleteIntegration} />)}</div>}

    <div className="grid md:grid-cols-2 gap-5 mt-8"><DisabledCard icon={Github} name="GitHub" /><DisabledCard icon={Plug} name="MCP Servers" /></div>
  </div>
}

function TelegramCard({ integration, busy, linkCode, onAction, onGenerateCode, onDelete }: { integration: TelegramIntegration; busy: string | null; linkCode: { code: string; command: string; expiresAt: string } | null; onAction: (id: string, action: string, extra?: Record<string, unknown>) => void; onGenerateCode: (id: string) => void; onDelete: (integration: TelegramIntegration) => void }) {
  const statusClass = integration.status === 'connected' ? 'text-emerald-400 border-emerald-700' : integration.status === 'error' ? 'text-red-400 border-red-700' : 'text-amber-400 border-amber-700'
  return <div className="card overflow-hidden"><div className="p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex items-center gap-3"><Bot className="text-sky-400" /><h2 className="text-xl font-semibold">{integration.name}</h2><span className={`provider-badge ${statusClass}`}>{integration.status === 'connected' ? <CheckCircle size={12} className="inline ml-1" /> : integration.status === 'error' ? <XCircle size={12} className="inline ml-1" /> : null}{statusLabels[integration.status]}</span></div><p className="text-sm text-dark-400 mt-2">{integration.botFirstName || 'Telegram Bot'} {integration.botUsername ? `@${integration.botUsername}` : ''} • ID <span dir="ltr">{integration.botId}</span></p></div><div className="text-left text-xs text-dark-500"><div>الموديل: <span className="text-dark-300" dir="ltr">{integration.model}</span></div><div>Pending: {integration.pendingUpdateCount ?? 0}</div></div></div><div className="grid md:grid-cols-2 gap-3 mt-5 text-xs"><div className="bg-dark-900 rounded-xl p-3"><div className="text-dark-500 mb-1">Webhook URL</div><div dir="ltr" className="truncate text-dark-300">{integration.webhookUrl || 'غير مسجل'}</div></div><div className="bg-dark-900 rounded-xl p-3"><div className="text-dark-500 mb-1">آخر خطأ</div><div className="text-red-300">{integration.lastErrorMessage || 'لا يوجد'}</div></div></div><div className="flex flex-wrap gap-2 mt-5"><button className="btn btn-secondary text-xs" disabled={busy === `check-webhook:${integration.id}`} onClick={() => onAction(integration.id, 'check-webhook')}><RefreshCw size={14} className={busy === `check-webhook:${integration.id}` ? 'animate-spin' : ''} /> فحص Webhook</button><button className="btn btn-secondary text-xs" disabled={busy === `register-webhook:${integration.id}`} onClick={() => onAction(integration.id, 'register-webhook')}><Link2 size={14} /> إعادة التسجيل</button><button className="btn btn-secondary text-xs" disabled={busy === `code:${integration.id}`} onClick={() => onGenerateCode(integration.id)}><Clipboard size={14} /> توليد كود ربط</button><button className="btn btn-ghost text-red-400 text-xs" disabled={busy === `delete:${integration.id}`} onClick={() => onDelete(integration)}><Trash2 size={14} /> حذف</button></div>{linkCode && <div className="mt-4 p-4 rounded-xl bg-primary-500/10 border border-primary-500/30"><div className="text-sm font-medium mb-2">أرسل إلى البوت خلال 10 دقائق:</div><div className="flex items-center gap-3"><code dir="ltr" className="text-lg tracking-widest text-primary-200">{linkCode.command}</code><button className="btn btn-ghost p-1" onClick={() => void navigator.clipboard?.writeText(linkCode.command)}><Clipboard size={14} /></button></div><div className="text-xs text-dark-500 mt-2">لا يظهر الكود مرة أخرى بعد انتهاء هذه الجلسة.</div></div>}</div><div className="border-t border-dark-700"><div className="px-5 py-3 text-sm font-medium">المحادثات المرتبطة ({integration.chats.length})</div>{integration.chats.length === 0 ? <div className="px-5 pb-5 text-sm text-dark-500">لم يتم ربط أي Chat بعد.</div> : <div className="divide-y divide-dark-800">{integration.chats.map((chat) => <div key={chat.id} className="px-5 py-4 flex flex-wrap items-center justify-between gap-3"><div><div className="font-medium">{chat.title || chat.username || chat.firstName || chat.telegramChatId}</div><div className="text-xs text-dark-500" dir="ltr">{chat.telegramChatId} • {chat.chatType || 'chat'}</div></div><div className="flex gap-2"><button className="btn btn-secondary text-xs" onClick={() => onAction(integration.id, 'test-message', { chatId: chat.id })}>إرسال اختبار</button><button className={`btn text-xs ${chat.isAllowed ? 'btn-secondary' : 'btn-primary'}`} onClick={() => onAction(integration.id, 'chat-allowed', { chatId: chat.id, isAllowed: !chat.isAllowed })}>{chat.isAllowed ? <><Unplug size={14} /> تعطيل</> : <><CheckCircle size={14} /> تفعيل</>}</button></div></div>)}</div>}</div></div>
}

function DisabledCard({ icon: Icon, name }: { icon: typeof Github; name: string }) {
  return <div className="card p-6 opacity-75"><div className="flex items-center gap-3 mb-3"><Icon size={22} /><div className="font-semibold">{name}</div><span className="text-xs text-amber-400">غير مفعّل</span></div><p className="text-sm text-dark-400">هذا التكامل خارج هذه المرحلة؛ لا نعرض حالة اتصال وهمية.</p></div>
}
