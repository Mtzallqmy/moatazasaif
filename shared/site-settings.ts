export const SITE_FONT_STYLES = ['modern', 'humanist', 'editorial'] as const
export type SiteFontStyle = (typeof SITE_FONT_STYLES)[number]

export interface SiteSettings {
  siteNameAr: string
  siteNameEn: string
  taglineAr: string
  taglineEn: string
  footerTextAr: string
  footerTextEn: string
  primaryColor: string
  accentColor: string
  fontStyle: SiteFontStyle
  allowRegistration: boolean
  blogEnabled: boolean
  publicStatusEnabled: boolean
  maintenanceMode: boolean
  maintenanceMessageAr?: string
  maintenanceMessageEn?: string
  updatedAt?: string
}

export interface SiteNavigationItem {
  id: string
  location: 'header' | 'footer'
  labelAr: string
  labelEn: string
  href: string
  isExternal: boolean
  isActive: boolean
  sortOrder: number
}

export interface PublicSiteConfiguration {
  settings: SiteSettings
  navigation: SiteNavigationItem[]
}

export const DEFAULT_SITE_SETTINGS: SiteSettings = {
  siteNameAr: 'معتز AI',
  siteNameEn: 'Moataz AI',
  taglineAr: 'مساحة ذكية للدردشة والمحتوى والتكاملات',
  taglineEn: 'An intelligent workspace for chat, content, and integrations',
  footerTextAr: 'جميع الحقوق محفوظة لدى معتز العلقمي.',
  footerTextEn: 'All rights reserved to Moataz Alalqami.',
  primaryColor: '#526d82',
  accentColor: '#6b8f8a',
  fontStyle: 'modern',
  allowRegistration: true,
  blogEnabled: true,
  publicStatusEnabled: false,
  maintenanceMode: false,
}

export function hexToRgb(value: string) {
  const match = /^#([0-9a-f]{6})$/i.exec(value)
  if (!match) return undefined
  const numeric = Number.parseInt(match[1], 16)
  return `${(numeric >> 16) & 255} ${(numeric >> 8) & 255} ${numeric & 255}`
}
