import type { Chat, Message } from '../types'

const DATABASE_NAME = 'moataz-byok-local'
const DATABASE_VERSION = 1
const CHATS_STORE = 'chats'
const MESSAGES_STORE = 'messages'

function requireIndexedDb(): IDBFactory {
  if (typeof indexedDB === 'undefined') throw new Error('IndexedDB غير مدعوم في هذا المتصفح')
  return indexedDB
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = requireIndexedDb().open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(CHATS_STORE)) database.createObjectStore(CHATS_STORE, { keyPath: 'id' })
      if (!database.objectStoreNames.contains(MESSAGES_STORE)) {
        const messages = database.createObjectStore(MESSAGES_STORE, { keyPath: 'id' })
        messages.createIndex('chatId', 'chatId', { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('تعذر فتح IndexedDB'))
    request.onblocked = () => reject(new Error('قاعدة المحادثات المحلية محجوبة بواسطة تبويب آخر'))
  })
}

async function withStore<T>(storeName: string, mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode)
    const request = operation(transaction.objectStore(storeName))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('فشلت عملية IndexedDB'))
    transaction.oncomplete = () => database.close()
    transaction.onerror = () => { database.close(); reject(transaction.error || new Error('فشلت معاملة IndexedDB')) }
    transaction.onabort = () => { database.close(); reject(transaction.error || new Error('أُلغيت معاملة IndexedDB')) }
  })
}

export async function listLocalChats(): Promise<Chat[]> {
  const rows = await withStore<Chat[]>(CHATS_STORE, 'readonly', (store) => store.getAll())
  return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}

export async function getLocalChat(id: string): Promise<Chat | undefined> {
  return await withStore<Chat | undefined>(CHATS_STORE, 'readonly', (store) => store.get(id))
}

export async function createLocalChat(providerType: string, model: string, mode: 'chat' | 'agent' = 'chat'): Promise<Chat> {
  const now = new Date().toISOString()
  const chat: Chat = {
    id: crypto.randomUUID(),
    title: 'محادثة محلية جديدة',
    providerId: 'session',
    providerType,
    model,
    mode,
    credentialMode: 'session',
    createdAt: now,
    updatedAt: now,
    messageCount: 0,
  }
  await withStore<IDBValidKey>(CHATS_STORE, 'readwrite', (store) => store.add(chat))
  return chat
}

export async function updateLocalChat(id: string, patch: Partial<Pick<Chat, 'title' | 'model' | 'mode' | 'messageCount' | 'providerType'>>): Promise<Chat> {
  const current = await getLocalChat(id)
  if (!current) throw new Error('المحادثة المحلية غير موجودة')
  const updated: Chat = { ...current, ...patch, updatedAt: new Date().toISOString() }
  await withStore<IDBValidKey>(CHATS_STORE, 'readwrite', (store) => store.put(updated))
  return updated
}

export async function deleteLocalChat(id: string): Promise<void> {
  const database = await openDatabase()
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction([CHATS_STORE, MESSAGES_STORE], 'readwrite')
    transaction.objectStore(CHATS_STORE).delete(id)
    const index = transaction.objectStore(MESSAGES_STORE).index('chatId')
    const cursor = index.openCursor(IDBKeyRange.only(id))
    cursor.onsuccess = () => {
      const row = cursor.result
      if (row) { row.delete(); row.continue() }
    }
    transaction.oncomplete = () => { database.close(); resolve() }
    transaction.onerror = () => { database.close(); reject(transaction.error || new Error('تعذر حذف المحادثة المحلية')) }
  })
}

export async function listLocalMessages(chatId: string): Promise<Message[]> {
  const database = await openDatabase()
  return await new Promise((resolve, reject) => {
    const transaction = database.transaction(MESSAGES_STORE, 'readonly')
    const request = transaction.objectStore(MESSAGES_STORE).index('chatId').getAll(IDBKeyRange.only(chatId))
    request.onsuccess = () => resolve((request.result as Message[]).sort((a, b) => a.createdAt.localeCompare(b.createdAt)))
    request.onerror = () => reject(request.error || new Error('تعذر تحميل الرسائل المحلية'))
    transaction.oncomplete = () => database.close()
  })
}

export async function insertLocalMessage(message: Message): Promise<Message> {
  await withStore<IDBValidKey>(MESSAGES_STORE, 'readwrite', (store) => store.put(message))
  return message
}

export async function clearLocalChatData(): Promise<void> {
  if (typeof indexedDB === 'undefined') return
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error || new Error('تعذر مسح المحادثات المحلية'))
    request.onblocked = () => reject(new Error('أغلق التبويبات الأخرى ثم أعد مسح بيانات الجلسة'))
  })
}
