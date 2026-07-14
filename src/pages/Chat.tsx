import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Bot, ChevronDown, Eraser, Plus, Search, Send, Shield, Square, Trash2 } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { toast } from 'sonner'
import { useAuth } from '../contexts/AuthContext'
import type { Chat as ChatType, Message, Provider } from '../types'
import { createChat, deleteChat as deleteChatRecord, insertMessage, listChats, listMessages, updateChat } from '../lib/supabase'
import { apiJson, authHeaders } from '../lib/api'
import { formatDate, generateId } from '../lib/utils'
import { streamChat } from '../lib/chat-api'
import { clearSessionData, getSessionProvider, type SessionProviderCredential } from '../lib/session-provider'
import { createLocalChat, deleteLocalChat, getLocalChat, insertLocalMessage, listLocalChats, listLocalMessages, updateLocalChat } from '../lib/local-chat-store'
import { supabase } from '../lib/supabase'

type ActiveProvider = Provider | SessionProviderCredential

async function getAccessToken() {
  if (!supabase) throw new Error('إعدادات Supabase غير موجودة')
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session) throw new Error('انتهت جلسة الدخول')
  return data.session.access_token
}

async function loadSavedProviders(): Promise<Provider[]> {
  const body = await apiJson<{ providers: Provider[] }>('/api/providers', { headers: await authHeaders(false) })
  return body.providers || []
}

export default function Chat() {
  const { chatId } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [savedChats, setSavedChats] = useState<ChatType[]>([])
  const [localChats, setLocalChats] = useState<ChatType[]>([])
  const [currentChat, setCurrentChat] = useState<ChatType | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [providers, setProviders] = useState<Provider[]>([])
  const [sessionProvider, setSessionProvider] = useState<SessionProviderCredential | null>(() => getSessionProvider())
  const [selectedProvider, setSelectedProvider] = useState<ActiveProvider | null>(null)
  const [selectedModel, setSelectedModel] = useState('')
  const [input, setInput] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [loading, setLoading] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const creatingRef = useRef(false)

  const allChats = useMemo(() => [...localChats, ...savedChats].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [localChats, savedChats])
  const availableProviders = useMemo<ActiveProvider[]>(() => [ ...(sessionProvider ? [sessionProvider] : []), ...providers.filter((provider) => provider.isEnabled) ], [sessionProvider, providers])

  useEffect(() => {
    let mounted = true
    const load = async () => {
      try {
        const [localRows, savedRows] = await Promise.all([listLocalChats().catch(() => []), user ? listChats(user.id) : Promise.resolve([])])
        const savedProviders = user ? await loadSavedProviders() : []
        if (!mounted) return
        setLocalChats(localRows); setSavedChats(savedRows); setProviders(savedProviders); setSessionProvider(getSessionProvider())
        const first = getSessionProvider() || savedProviders.find((provider) => provider.status === 'connected' && provider.isEnabled) || savedProviders[0] || null
        setSelectedProvider(first); setSelectedModel(first?.model || first?.models?.[0] || '')
      } catch (error) { if (mounted) toast.error(error instanceof Error ? error.message : 'تعذر تحميل بيانات الدردشة') }
      finally { if (mounted) setLoading(false) }
    }
    void load()
    const handler = () => { const next = getSessionProvider(); setSessionProvider(next); if (next && (!selectedProvider || selectedProvider.id === 'session')) { setSelectedProvider(next); setSelectedModel(next.model || next.models[0] || '') } }
    window.addEventListener('moataz:session-provider-changed', handler)
    return () => { mounted = false; window.removeEventListener('moataz:session-provider-changed', handler) }
  }, [user])

  useEffect(() => {
    if (loading || creatingRef.current) return
    if (!chatId) {
      if (!selectedProvider || !selectedModel) return
      creatingRef.current = true
      void createCurrentChat(selectedProvider, selectedModel).then((chat) => navigate(`/chat/${chat.id}`, { replace: true })).catch((error) => toast.error(error instanceof Error ? error.message : 'تعذر إنشاء المحادثة')).finally(() => { creatingRef.current = false })
      return
    }
    let cancelled = false
    const loadChat = async () => {
      let chat = allChats.find((item) => item.id === chatId)
      if (!chat) chat = await getLocalChat(chatId).catch(() => undefined)
      if (!chat || cancelled) return
      setCurrentChat(chat)
      const rows = chat.credentialMode === 'session' ? await listLocalMessages(chat.id).catch(() => []) : (user ? await listMessages(chat.id, user.id) : [])
      if (!cancelled) setMessages(rows)
      const provider = chat.credentialMode === 'session' ? sessionProvider : providers.find((item) => item.id === chat?.providerId)
      if (provider && !cancelled) { setSelectedProvider(provider); setSelectedModel(chat.model || provider.model || provider.models?.[0] || '') }
    }
    void loadChat().catch((error) => { if (!cancelled) toast.error(error instanceof Error ? error.message : 'تعذر تحميل المحادثة') })
    return () => { cancelled = true }
  }, [chatId, loading, allChats, providers, sessionProvider, user])

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, streamingContent])
  useEffect(() => { if (textareaRef.current) { textareaRef.current.style.height = 'auto'; textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px` } }, [input])

  async function createCurrentChat(provider: ActiveProvider, model: string) {
    if (provider.id === 'session') {
      const chat = await createLocalChat(provider.type, model)
      setLocalChats((current) => [chat, ...current]); return chat
    }
    if (!user) throw new Error('سجّل الدخول لاستخدام المزود المحفوظ')
    const chat = await createChat(user.id, provider.id, model, 'chat')
    setSavedChats((current) => [chat, ...current]); return chat
  }

  const selectProvider = async (provider: ActiveProvider) => {
    const model = provider.model || provider.models?.[0] || ''
    setSelectedProvider(provider); setSelectedModel(model)
    if (currentChat && (currentChat.credentialMode !== (provider.id === 'session' ? 'session' : 'saved') || currentChat.providerId !== provider.id)) {
      try { const chat = await createCurrentChat(provider, model); navigate(`/chat/${chat.id}`) } catch (error) { toast.error(error instanceof Error ? error.message : 'تعذر بدء محادثة بهذا المزود') }
    }
  }

  const createNewChat = async () => {
    if (!selectedProvider || !selectedModel) { toast.error('اختبر مزودًا واختر نموذجًا أولًا'); navigate('/providers'); return }
    try { const chat = await createCurrentChat(selectedProvider, selectedModel); navigate(`/chat/${chat.id}`) } catch (error) { toast.error(error instanceof Error ? error.message : 'تعذر إنشاء المحادثة') }
  }

  const removeChat = async (id: string) => {
    const target = allChats.find((chat) => chat.id === id)
    try {
      if (target?.credentialMode === 'session') { await deleteLocalChat(id); setLocalChats((current) => current.filter((chat) => chat.id !== id)) }
      else if (user) { await deleteChatRecord(id, user.id); setSavedChats((current) => current.filter((chat) => chat.id !== id)) }
      if (currentChat?.id === id) navigate('/chat')
      toast.success('تم حذف المحادثة')
    } catch (error) { toast.error(error instanceof Error ? error.message : 'تعذر حذف المحادثة') }
  }

  const sendMessage = async () => {
    if (!currentChat || !selectedProvider || !selectedModel || !input.trim() || isStreaming) {
      if (!selectedProvider) toast.error('أضف مزودًا واختبر الاتصال أولًا')
      else if (!selectedModel) toast.error('اختر نموذجًا للمزود')
      return
    }
    if (selectedProvider.id !== 'session' && !user) { toast.error('سجّل الدخول لاستخدام المزود المحفوظ'); return }
    const content = input.trim(); setInput(''); setIsStreaming(true); setStreamingContent('')
    const userMessage: Message = { id: generateId(), chatId: currentChat.id, role: 'user', content, createdAt: new Date().toISOString() }
    const nextMessages = [...messages, userMessage]; setMessages(nextMessages)
    const isSession = currentChat.credentialMode === 'session'
    try {
      if (isSession) await insertLocalMessage(userMessage); else if (user) await insertMessage(userMessage, user.id)
      let chat = currentChat
      if (messages.length === 0) {
        if (isSession) chat = await updateLocalChat(currentChat.id, { title: content.slice(0, 45), model: selectedModel })
        else if (user) chat = await updateChat(currentChat.id, user.id, { title: content.slice(0, 45), provider_id: selectedProvider.id, model: selectedModel }) || currentChat
        setCurrentChat(chat); if (isSession) setLocalChats((prev) => prev.map((item) => item.id === chat.id ? chat : item)); else setSavedChats((prev) => prev.map((item) => item.id === chat.id ? chat : item))
      }
      const controller = new AbortController(); abortRef.current = controller
      const accessToken = !isSession ? await getAccessToken() : undefined
      const result = await streamChat({ credentialMode: isSession ? 'session' : 'saved', providerId: isSession ? undefined : selectedProvider.id, sessionProvider: isSession ? sessionProvider || undefined : undefined, accessToken, model: selectedModel, messages: nextMessages.map((message) => ({ role: message.role === 'tool' ? 'assistant' : message.role, content: message.content })), signal: controller.signal, onContent: setStreamingContent })
      const assistant: Message = { id: generateId(), chatId: currentChat.id, role: 'assistant', content: result.content, createdAt: new Date().toISOString(), model: selectedModel, tokens: result.tokens }
      if (isSession) await insertLocalMessage(assistant); else if (user) await insertMessage(assistant, user.id)
      const all = [...nextMessages, assistant]; setMessages(all); setStreamingContent('')
      if (isSession) { chat = await updateLocalChat(currentChat.id, { messageCount: all.length }); setLocalChats((prev) => prev.map((item) => item.id === chat.id ? chat : item)) }
      else if (user) { chat = await updateChat(currentChat.id, user.id, { message_count: all.length }) || currentChat; setSavedChats((prev) => prev.map((item) => item.id === chat.id ? chat : item)) }
      setCurrentChat(chat)
    } catch (error) { if (!(error instanceof DOMException && error.name === 'AbortError')) toast.error(error instanceof Error ? error.message : 'فشل استدعاء النموذج') }
    finally { abortRef.current = null; setIsStreaming(false); setStreamingContent('') }
  }

  const stopGeneration = () => { abortRef.current?.abort(); setIsStreaming(false); setStreamingContent(''); toast.info('تم إيقاف التوليد') }
  const clearSession = async () => {
    try {
      await clearSessionData()
      setSessionProvider(null)
      setLocalChats([])
      if (currentChat?.credentialMode === 'session') navigate('/chat')
      toast.success('تم مسح المفتاح والمحادثات المحلية')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'تعذر مسح بيانات الجلسة')
    }
  }
  const filteredChats = allChats.filter((chat) => chat.title.toLowerCase().includes(searchTerm.toLowerCase()))

  return <div className="flex h-[calc(100vh-4rem)] overflow-hidden"><div className="w-72 border-l border-dark-700 bg-dark-900 flex-col hidden lg:flex"><div className="p-4 border-b border-dark-700 flex items-center justify-between"><div className="font-semibold">المحادثات</div><button onClick={() => void createNewChat()} className="btn btn-secondary px-3 py-1.5 text-xs"><Plus size={14} /> جديدة</button></div><div className="p-3"><div className="relative"><Search className="absolute right-3 top-3 text-dark-500" size={16} /><input className="input py-2 pr-9 text-sm" placeholder="ابحث..." value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} /></div></div><div className="flex-1 overflow-y-auto px-2 space-y-1">{filteredChats.map((chat) => <div key={chat.id} onClick={() => navigate(`/chat/${chat.id}`)} className={`group flex items-center justify-between px-4 py-3 rounded-2xl cursor-pointer text-sm ${currentChat?.id === chat.id ? 'bg-primary-600 text-white' : 'hover:bg-dark-800 text-dark-200'}`}><div className="flex-1 min-w-0 pr-2"><div className="font-medium truncate">{chat.title}</div><div className="text-[10px] opacity-60 mt-0.5">{chat.credentialMode === 'session' ? 'محلي' : 'حساب'} • {chat.model || 'بدون نموذج'} • {formatDate(chat.updatedAt, { month: 'short', day: 'numeric' })}</div></div><button onClick={(event) => { event.stopPropagation(); void removeChat(chat.id) }} className="opacity-0 group-hover:opacity-100 p-1.5"><Trash2 size={14} /></button></div>)}</div><div className="p-4 border-t border-dark-700 text-[10px] text-dark-500 text-center">{user ? `${savedChats.length} محفوظة في الحساب • ${localChats.length} محلية` : `${localChats.length} محلية على هذا الجهاز`}</div></div><div className="flex-1 flex flex-col min-w-0"><div className="h-14 border-b border-dark-700 px-5 flex items-center justify-between bg-dark-900 flex-shrink-0 gap-3"><div className="min-w-0"><div className="font-semibold text-lg truncate">{currentChat?.title || 'محادثة جديدة'}</div><div className="text-xs text-dark-500 truncate">{selectedProvider?.name || 'اختر مزودًا'} • {selectedModel || 'اختر نموذجًا'} • {selectedProvider?.protocol || '—'}</div></div><div className="flex items-center gap-2"><div className="flex items-center bg-dark-800 rounded-2xl p-1 text-xs"><button type="button" className="px-3 py-1.5 rounded-xl bg-white text-dark-950">دردشة</button><button type="button" disabled title="سيُفعّل بعد إضافة Agent Loop آمن" className="px-3 py-1.5 rounded-xl text-dark-600">وكيل قريبًا</button></div><div className="relative group"><button className="flex items-center gap-2 text-sm px-3 py-2 bg-dark-800 rounded-2xl border border-dark-700">{selectedProvider?.name || 'اختر مزود'}<ChevronDown size={14} /></button><div className="absolute left-0 mt-2 w-72 bg-dark-900 border border-dark-700 rounded-2xl shadow-2xl py-1 z-50 hidden group-hover:block">{availableProviders.map((provider) => <button key={provider.id} onClick={() => void selectProvider(provider)} className="w-full text-right px-4 py-2.5 hover:bg-dark-800 cursor-pointer text-sm flex justify-between"><span>{provider.name}</span><span className="text-[10px] text-emerald-400">{provider.id === 'session' ? 'جلسة' : provider.status}</span></button>)}{availableProviders.length === 0 && <div className="px-4 py-3 text-xs text-dark-500">أضف مزودًا من صفحة المزودات</div>}</div></div></div></div>{!user && <div className="px-5 py-2 bg-primary-500/10 border-b border-primary-500/20 text-xs text-primary-200 flex items-center gap-2"><Shield size={14} /> وضع الضيف: المحادثات المحلية فقط ولا تُرسل إلى Supabase.</div>}{user && selectedProvider?.id === 'session' && <div className="px-5 py-2 bg-amber-500/10 border-b border-amber-500/20 text-xs text-amber-200 flex items-center justify-between"><span>تستخدم مزود جلسة؛ لا يُحفظ المفتاح أو الرسائل في الحساب.</span><button onClick={() => void clearSession()} className="underline"><Eraser size={12} className="inline" /> مسح</button></div>}{!selectedProvider && <div className="px-5 py-2 bg-amber-500/10 border-b border-amber-500/20 text-xs text-amber-200 flex items-center justify-between"><span>لم يتم اختيار مزود بعد.</span><Link to="/providers" className="underline">إضافة واختبار مزود</Link></div>}<div className="flex-1 overflow-y-auto p-6 space-y-6 bg-dark-950">{messages.length === 0 && !isStreaming && <div className="h-full flex flex-col items-center justify-center text-center"><Bot className="text-primary-400 mb-4" size={40} /><h3 className="text-2xl font-semibold mb-2">كيف يمكنني مساعدتك اليوم؟</h3><p className="text-dark-400 mb-5">اختر مزودًا اختبرته فعليًا ثم ابدأ محادثة حقيقية.</p><Link to="/providers" className="btn btn-primary">إضافة واختبار مزود</Link></div>}{messages.map((message) => <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}><div className={`message-bubble ${message.role === 'user' ? 'user-message' : 'assistant-message'}`}>{message.role === 'assistant' && <div className="flex items-center gap-2 text-xs text-dark-400 mb-2"><Bot size={14} /> {message.model || selectedModel}</div>}<div className="prose prose-invert prose-sm max-w-none"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown></div>{message.tokens ? <div className="text-[10px] text-dark-500 mt-2">{message.tokens} رمز</div> : null}</div></div>)}{isStreaming && <div className="flex justify-start"><div className="message-bubble assistant-message"><div className="text-xs text-dark-400 mb-2"><Bot size={14} className="inline" /> {selectedModel} • يكتب...</div><div className="prose prose-invert prose-sm"><ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingContent || 'جارٍ التفكير...'}</ReactMarkdown></div></div></div>}<div ref={messagesEndRef} /></div><div className="border-t border-dark-700 p-4 bg-dark-900 flex-shrink-0"><div className="max-w-4xl mx-auto flex gap-3 items-end"><textarea ref={textareaRef} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendMessage() } }} placeholder="اكتب رسالتك... (Shift+Enter لسطر جديد)" className="textarea flex-1 py-4" disabled={isStreaming} rows={1} />{isStreaming ? <button onClick={stopGeneration} className="btn btn-danger h-12 w-12 p-0 flex items-center justify-center rounded-2xl"><Square size={18} /></button> : <button onClick={() => void sendMessage()} disabled={!input.trim() || !currentChat} className="btn btn-primary h-12 w-12 p-0 flex items-center justify-center rounded-2xl disabled:bg-dark-700"><Send size={18} /></button>}</div><div className="text-[10px] text-dark-500 mt-2 text-center">المفتاح يرسل إلى Vercel Function الحالية فقط • Enter للإرسال</div></div></div></div>
}
