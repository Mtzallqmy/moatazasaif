import { describe, expect, it, vi } from 'vitest'
import { listGitHubRepositories, testGitHubToken } from '../github.js'
import { readIntegrationJson } from '../http.js'
import { sendWhatsAppText, testWhatsAppCredentials } from '../whatsapp.js'

const githubToken = `github_pat_${'a'.repeat(30)}`
const whatsappToken = `EA${'b'.repeat(30)}`

describe('external integration clients', () => {
  it('validates a GitHub account without exposing its token', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => new Response(JSON.stringify({ id: 42, login: 'moataz', name: 'Moataz' }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'x-oauth-scopes': 'repo, read:user', 'x-ratelimit-remaining': '4999' },
    })) as unknown as typeof fetch

    await expect(testGitHubToken(githubToken, fetcher)).resolves.toMatchObject({ id: '42', login: 'moataz', scopes: ['repo', 'read:user'] })
    expect(fetcher).toHaveBeenCalledWith('https://api.github.com/user', expect.objectContaining({ headers: expect.objectContaining({ Authorization: `Bearer ${githubToken}` }), redirect: 'error' }))
    expect(JSON.stringify(await testGitHubToken(githubToken, fetcher))).not.toContain(githubToken)
  })

  it('maps GitHub repositories to a bounded public shape', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify([{ id: 9, full_name: 'moataz/app', private: true, html_url: 'https://github.com/moataz/app', default_branch: 'main', secret: githubToken }]), { status: 200 })) as unknown as typeof fetch
    await expect(listGitHubRepositories(githubToken, fetcher)).resolves.toEqual([{ id: '9', fullName: 'moataz/app', private: true, url: 'https://github.com/moataz/app', defaultBranch: 'main' }])
  })

  it('validates a WhatsApp phone and sends text using the fixed Graph host', async () => {
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const value = String(url)
      if (value.includes('/messages')) return new Response(JSON.stringify({ messages: [{ id: 'wamid.123' }] }), { status: 200 })
      return new Response(JSON.stringify({ id: '123456789', display_phone_number: '+967700000000', verified_name: 'Moataz AI', quality_rating: 'GREEN' }), { status: 200 })
    }) as unknown as typeof fetch

    await expect(testWhatsAppCredentials(whatsappToken, '123456789', 'v25.0', fetcher)).resolves.toMatchObject({ id: '123456789', verifiedName: 'Moataz AI' })
    await expect(sendWhatsAppText(whatsappToken, '123456789', 'v25.0', '+967700000000', 'اختبار', fetcher)).resolves.toEqual({ sent: true, messageId: 'wamid.123' })
    expect(fetcher).toHaveBeenLastCalledWith('https://graph.facebook.com/v25.0/123456789/messages', expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: `Bearer ${whatsappToken}` }) }))
  })

  it('does not reflect a rejected credential in errors', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 })) as unknown as typeof fetch
    await expect(testGitHubToken(githubToken, fetcher)).rejects.not.toThrow(githubToken)
  })

  it('redacts credentials even when an upstream error echoes them', async () => {
    const githubFetcher = vi.fn(async () => new Response(JSON.stringify({ message: `gateway echoed ${githubToken}` }), { status: 500 })) as unknown as typeof fetch
    await expect(testGitHubToken(githubToken, githubFetcher)).rejects.not.toThrow(githubToken)

    const whatsappFetcher = vi.fn(async () => new Response(JSON.stringify({ error: { message: `gateway echoed ${whatsappToken}` } }), { status: 400 })) as unknown as typeof fetch
    await expect(testWhatsAppCredentials(whatsappToken, '123456789', 'v25.0', whatsappFetcher)).rejects.not.toThrow(whatsappToken)
  })

  it('stops reading an oversized integration response stream', async () => {
    const oversized = new Uint8Array(1_000_001)
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(oversized)
        controller.close()
      },
    }), { status: 200 })
    await expect(readIntegrationJson(response)).rejects.toMatchObject({ code: 'integration_response_too_large' })
  })
})
