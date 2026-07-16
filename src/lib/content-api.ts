import type { Announcement, Article, ArticleStatus, ContentSection } from '../types'
import { apiJson, authHeaders } from './api'

type Row = Record<string, any>

const mapSection = (row: Row): ContentSection => ({ id: row.id, slug: row.slug, nameAr: row.name_ar, nameEn: row.name_en || undefined, descriptionAr: row.description_ar || undefined, descriptionEn: row.description_en || undefined, sortOrder: row.sort_order || 0, isVisible: row.is_visible !== false, createdAt: row.created_at, updatedAt: row.updated_at })
const mapArticle = (row: Row): Article => ({ id: row.id, sectionId: row.section_id || undefined, section: row.content_sections ? { slug: row.content_sections.slug, nameAr: row.content_sections.name_ar, nameEn: row.content_sections.name_en || undefined } : undefined, slug: row.slug, titleAr: row.title_ar, titleEn: row.title_en || undefined, excerptAr: row.excerpt_ar || undefined, excerptEn: row.excerpt_en || undefined, contentAr: row.content_ar, contentEn: row.content_en || undefined, coverUrl: row.cover_url || undefined, status: row.status, publishedAt: row.published_at || undefined, createdAt: row.created_at, updatedAt: row.updated_at })
const mapAnnouncement = (row: Row): Announcement => ({ id: row.id, textAr: row.text_ar, textEn: row.text_en || undefined, href: row.href || undefined, placement: row.placement, isActive: row.is_active !== false, startsAt: row.starts_at || undefined, endsAt: row.ends_at || undefined, sortOrder: row.sort_order || 0, createdAt: row.created_at })

export async function listSections(manage = false) {
  const body = await apiJson<{ data: Row[] }>(`/api/v1/sections${manage ? '?manage=true' : ''}`, manage ? { headers: await authHeaders(false) } : {})
  return body.data.map(mapSection)
}

export async function saveSection(input: Partial<ContentSection> & { nameAr: string; slug: string }) {
  const body = await apiJson<{ data: Row }>('/api/v1/sections', { method: input.id ? 'PATCH' : 'POST', headers: await authHeaders(), body: JSON.stringify(input) })
  return mapSection(body.data)
}

export async function listArticles(options: { manage?: boolean; status?: ArticleStatus; slug?: string; section?: string; page?: number } = {}) {
  const params = new URLSearchParams()
  if (options.manage) params.set('manage', 'true')
  if (options.status) params.set('status', options.status)
  if (options.slug) params.set('slug', options.slug)
  if (options.section) params.set('section', options.section)
  if (options.page) params.set('page', String(options.page))
  const body = await apiJson<{ data: Row[]; pagination: { page: number; pages: number; total: number } }>(`/api/v1/articles?${params}`, options.manage ? { headers: await authHeaders(false) } : {})
  return { articles: body.data.map(mapArticle), pagination: body.pagination }
}

export async function saveArticle(input: Partial<Article> & { titleAr: string; contentAr: string; slug: string }) {
  const body = await apiJson<{ data: Row }>('/api/v1/articles', { method: input.id ? 'PATCH' : 'POST', headers: await authHeaders(), body: JSON.stringify(input) })
  return mapArticle(body.data)
}

export async function archiveArticle(id: string) {
  await apiJson('/api/v1/articles', { method: 'DELETE', headers: await authHeaders(), body: JSON.stringify({ id }) })
}

export async function listAnnouncements(options: { manage?: boolean; placement?: 'top' | 'dashboard' } = {}) {
  const params = new URLSearchParams()
  if (options.manage) params.set('manage', 'true')
  if (options.placement) params.set('placement', options.placement)
  const body = await apiJson<{ data: Row[] }>(`/api/v1/announcements?${params}`, options.manage ? { headers: await authHeaders(false) } : {})
  return body.data.map(mapAnnouncement)
}

export async function saveAnnouncement(input: Partial<Announcement> & { textAr: string }) {
  const body = await apiJson<{ data: Row }>('/api/v1/announcements', { method: input.id ? 'PATCH' : 'POST', headers: await authHeaders(), body: JSON.stringify(input) })
  return mapAnnouncement(body.data)
}
