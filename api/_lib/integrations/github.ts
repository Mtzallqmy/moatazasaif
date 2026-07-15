import { ApiError } from '../http.js'
import { integrationSignal, readIntegrationJson, upstreamMessage } from './http.js'

const GITHUB_API = 'https://api.github.com'
const TOKEN_PATTERN = /^[\x21-\x7e]{20,8192}$/

export interface GitHubAccount {
  id: string
  login: string
  name?: string
  avatarUrl?: string
  scopes: string[]
  rateLimitRemaining?: number
}

export interface GitHubRepository {
  id: string
  fullName: string
  private: boolean
  url: string
  defaultBranch: string
}

export function normalizeGitHubToken(value: unknown) {
  if (typeof value !== 'string') throw new ApiError(400, 'GitHub token مطلوب', 'github_token_invalid')
  const token = value.trim()
  if (!TOKEN_PATTERN.test(token)) throw new ApiError(400, 'صيغة GitHub token غير صالحة', 'github_token_invalid')
  return token
}

async function githubRequest(path: string, token: string, fetcher: typeof fetch, signal?: AbortSignal) {
  let response: Response
  try {
    response = await fetcher(`${GITHUB_API}${path}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'Moataz-AI-Platform',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: integrationSignal(signal),
      redirect: 'error',
    })
  } catch {
    throw new ApiError(503, 'تعذر الاتصال بـ GitHub', 'github_unreachable')
  }
  const payload = await readIntegrationJson(response)
  if (!response.ok) {
    if (response.status === 401) throw new ApiError(401, 'GitHub token غير صالح أو منتهي', 'github_token_rejected')
    if (response.status === 403) throw new ApiError(403, 'GitHub رفض الطلب بسبب الصلاحيات أو حد الاستخدام', 'github_forbidden')
    throw new ApiError(502, upstreamMessage(payload, 'فشل استدعاء GitHub'), 'github_api_failed', { status: response.status })
  }
  return { payload, response }
}

export async function testGitHubToken(value: unknown, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<GitHubAccount> {
  const token = normalizeGitHubToken(value)
  const { payload, response } = await githubRequest('/user', token, fetcher, signal)
  const user = payload as { id?: number | string; login?: string; name?: string | null; avatar_url?: string }
  if (!user.id || !user.login) throw new ApiError(502, 'استجابة حساب GitHub ناقصة', 'github_account_invalid')
  const scopes = (response.headers.get('x-oauth-scopes') || '').split(',').map((scope) => scope.trim()).filter(Boolean)
  const remaining = Number(response.headers.get('x-ratelimit-remaining'))
  return { id: String(user.id), login: user.login, name: user.name || undefined, avatarUrl: user.avatar_url, scopes, rateLimitRemaining: Number.isFinite(remaining) ? remaining : undefined }
}

export async function listGitHubRepositories(value: unknown, fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<GitHubRepository[]> {
  const token = normalizeGitHubToken(value)
  const { payload } = await githubRequest('/user/repos?per_page=50&sort=updated&affiliation=owner,collaborator,organization_member', token, fetcher, signal)
  if (!Array.isArray(payload)) throw new ApiError(502, 'استجابة مستودعات GitHub غير صالحة', 'github_repositories_invalid')
  return payload.flatMap((item: any) => item?.id && item?.full_name && item?.html_url ? [{ id: String(item.id), fullName: String(item.full_name), private: Boolean(item.private), url: String(item.html_url), defaultBranch: String(item.default_branch || 'main') }] : [])
}
