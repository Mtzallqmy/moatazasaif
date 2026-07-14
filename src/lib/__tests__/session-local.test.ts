import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { clearSessionData, getSessionProvider, saveSessionProvider, SESSION_PROVIDER_STORAGE_KEY } from '../session-provider'
import { clearLocalChatData, createLocalChat, insertLocalMessage, listLocalChats, listLocalMessages } from '../local-chat-store'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, String(value)) }
}

afterEach(async () => { await clearLocalChatData(); new MemoryStorage().clear() })

describe('ephemeral session storage and local conversations', () => {
  it('keeps the credential in sessionStorage and never in the local chat record', async () => {
    const storage = new MemoryStorage()
    const provider = saveSessionProvider({ name: 'Test', type: 'dahl', protocol: 'openai-compatible', baseUrl: 'https://inference.dahl.global/v1', apiKey: 'temporary-secret', model: 'model-a', models: ['model-a'], status: 'connected' }, storage)
    expect(getSessionProvider(storage)?.apiKey).toBe('temporary-secret')
    const chat = await createLocalChat(provider.type, provider.model || '')
    const serialized = JSON.stringify(await listLocalChats())
    expect(serialized).not.toContain('temporary-secret')
    expect(chat.credentialMode).toBe('session')
    expect(storage.getItem(SESSION_PROVIDER_STORAGE_KEY)).toContain('temporary-secret')
  })

  it('stores guest messages in IndexedDB and clears both stores', async () => {
    const chat = await createLocalChat('openai-compatible', 'model-a')
    await insertLocalMessage({ id: 'message-1', chatId: chat.id, role: 'user', content: 'hello', createdAt: new Date().toISOString() })
    expect((await listLocalMessages(chat.id)).map((message) => message.content)).toEqual(['hello'])
    expect((await listLocalChats()).some((item) => item.id === chat.id)).toBe(true)
    await clearSessionData(new MemoryStorage())
    expect(await listLocalChats()).toEqual([])
  })
})
