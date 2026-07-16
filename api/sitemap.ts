import type { VercelRequest, VercelResponse } from './_lib/vercel.js'
import { getAdminClient } from './_lib/supabase.js'
import { methodNotAllowed } from './_lib/http.js'

const ORIGIN = 'https://moatazalalqami.online'
const escapeXml = (value: string) => value.replace(/[<>&'\"]/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[character]!)

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
  const { data } = await getAdminClient().from('articles').select('slug,updated_at').eq('status', 'published').lte('published_at', new Date().toISOString()).order('published_at', { ascending: false }).limit(5_000)
  const staticPaths = ['/', '/blog', '/privacy', '/terms']
  const urls = [
    ...staticPaths.map((path) => `<url><loc>${ORIGIN}${path}</loc></url>`),
    ...(data || []).map((article) => `<url><loc>${ORIGIN}/blog/${escapeXml(article.slug)}</loc><lastmod>${new Date(article.updated_at).toISOString()}</lastmod></url>`),
  ]
  res.setHeader('Content-Type', 'application/xml; charset=utf-8')
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400')
  return res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`)
}
