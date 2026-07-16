import { useEffect, useState } from 'react'
import { Megaphone } from 'lucide-react'
import { listAnnouncements } from '../lib/content-api'
import type { Announcement } from '../types'
import { usePreferences } from '../contexts/PreferencesContext'

export default function AnnouncementBar({ placement = 'top' }: { placement?: 'top' | 'dashboard' }) {
  const [items, setItems] = useState<Announcement[]>([])
  const { language } = usePreferences()

  useEffect(() => { void listAnnouncements({ placement }).then(setItems).catch(() => setItems([])) }, [placement])
  if (!items.length) return null

  const content = items.map((item) => ({ ...item, text: language === 'en' && item.textEn ? item.textEn : item.textAr }))
  return <aside className="announcement-bar" aria-label={language === 'ar' ? 'الإعلانات' : 'Announcements'}>
    <Megaphone size={15} className="shrink-0" />
    <div className="overflow-hidden flex-1"><div className={content.length > 1 ? 'announcement-track' : 'text-center'}>{content.map((item) => item.href ? <a key={item.id} href={item.href} className="hover:underline mx-8">{item.text}</a> : <span key={item.id} className="mx-8">{item.text}</span>)}</div></div>
  </aside>
}
