/**
 * Mirror-site manga providers (Worker-side): Bato1, MangaKakalot.fun,
 * MangaRead. Each mirror was independently verified 2026-09-27 as the
 * WORKING host for a dead canonical domain — implement the working host,
 * never pretend the dead canonical works.
 *
 * - Bato1 (bato1.com): /filter?keyword= search, /manga/<slug> series
 *   (ChapterUrl embedded), /read/<slug>/chapter-N pages
 *   (cdn1.love4awalk.xyz WEBPs, verified 200).
 * - MangaKakalot.fun: /search/story/<q>, /manga/<slug> chapters,
 *   /chapter/<slug>/chapter-N server-rendered <img> (imgx.mghcdn.com
 *   PNGs, verified 200). Canonical mangakakalot.com is CLOSED.
 * - MangaRead (mangaread.org, WP-Manga family, MangaBuddy replacement):
 *   /?s= search, /manga/<slug>/ chapters, /manga/<slug>/chapter-N/ pages
 *   (wp-manga-chapter-img, verified 200).
 *
 * Security: public HTML only. No auth/CAPTCHA/DRM bypass.
 */

import type { ProviderHint } from './providers'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export interface MirrorChapter {
  providerChapterId: string
  label: string
  number: number | null
  kind?: string
  unitType?: 'volume' | 'chapter'
}

export interface MirrorMatch {
  providerMangaId: string
  providerTitle: string
}

async function siteFetch(base: string, path: string, timeoutMs = 12000, signal?: AbortSignal): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  if (signal) {
    if (signal.aborted) ctrl.abort((signal as any).reason)
    else signal.addEventListener('abort', () => ctrl.abort((signal as any).reason), { once: true })
  }
  try {
    return await fetch(`${base}${path}`, {
      headers: { 'User-Agent': UA, Accept: 'text/html,*/*', Referer: `${base}/` },
      signal: ctrl.signal,
    })
  } finally {
    clearTimeout(t)
  }
}

function normalizeTitle(s: string): string {
  return String(s || '').toLowerCase().normalize('NFKD')
    .replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ').trim()
}

function titleScore(name: string, variants: string[]): number {
  const n = normalizeTitle(name)
  if (!n) return 0
  let best = 0
  for (const raw of variants) {
    const v = normalizeTitle(raw)
    if (!v) continue
    if (v === n) return 100
    if (v.startsWith(n) || n.startsWith(v)) best = Math.max(best, 60)
    else if (v.includes(n) || n.includes(v)) best = Math.max(best, 40)
  }
  return best
}

const THRESHOLD = 40

// ---------------- Bato1 ----------------
const BATO_BASE = 'https://bato1.com'

function parseBatoSearch(html: string): { slug: string; title: string }[] {
  const out: { slug: string; title: string }[] = []
  const seen = new Set<string>()
  const re = /<a[^>]*href="\/manga\/([a-z0-9-]+)"[^>]*>([\s\S]{0,300}?)<\/a\s*>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null && out.length < 20) {
    const slug = m[1]
    if (seen.has(slug)) continue
    seen.add(slug)
    out.push({ slug, title: m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || slug })
  }
  return out
}

export async function batoSearchAndMatch(hint: ProviderHint | undefined, signal?: AbortSignal): Promise<MirrorMatch> {
  const variants = [hint?.english, hint?.title, hint?.native].map(s => (s || '').trim()).filter(Boolean) as string[]
  if (!variants.length) throw new Error('no title hints for manga match')
  const pooled = new Map<string, { slug: string; title: string }>()
  for (const q of variants.slice(0, 3)) {
    try {
      const res = await siteFetch(BATO_BASE, `/filter?keyword=${encodeURIComponent(q)}`, 12000, signal)
      if (!res.ok) continue
      for (const c of parseBatoSearch(await res.text())) {
        if (!pooled.has(c.slug)) pooled.set(c.slug, c)
      }
    } catch { /* next */ }
  }
  if (!pooled.size) throw new Error('no search results')
  const ranked = [...pooled.values()]
    .map(c => ({ c, s: Math.max(titleScore(c.title, variants), titleScore(c.slug.replace(/-/g, ' '), variants)) }))
    .sort((a, b) => b.s - a.s)
  const top = ranked[0]
  if (!top || top.s < THRESHOLD) throw new Error('no confident match')
  if (ranked.filter(r => r.s === top.s && r.c.slug !== top.c.slug).length) throw new Error('ambiguous match')
  return { providerMangaId: top.c.slug, providerTitle: top.c.title }
}

export async function batoGetChapters(slug: string, signal?: AbortSignal): Promise<MirrorChapter[]> {
  const res = await siteFetch(BATO_BASE, `/manga/${slug}`, 15000, signal)
  if (!res.ok) throw new Error(`chapter list ${res.status}`)
  const html = await res.text()
  const out: MirrorChapter[] = []
  const seen = new Set<string>()
  // Primary: plain chapter hrefs (/read/<slug>/chapter-N). ChapterUrl
  // attributes are NOT present in the served HTML (verified 2026-09-27).
  const re = /\/read\/([a-z0-9-]+)\/chapter-([\d.]+)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const num = Number(m[2])
    if (!Number.isFinite(num) || seen.has(`${m[1]}:${num}`)) continue
    seen.add(`${m[1]}:${num}`)
    out.push({ providerChapterId: `${m[1]}::${num}`, label: `Chapter ${m[2]}`, number: num, kind: 'Chapter', unitType: 'chapter' })
  }
  // Fallback: chapter link hrefs
  if (!out.length) {
    const re2 = /<a[^>]*href="(\/read\/[a-z0-9-]+\/chapter-([\d.]+)[^"]*)"[^>]*>/gi
    let m2: RegExpExecArray | null
    while ((m2 = re.exec(html)) !== null) {
      void m2
      break
    }
    const re3 = /\/read\/([a-z0-9-]+)\/chapter-([\d.]+)/gi
    let m3: RegExpExecArray | null
    while ((m3 = re3.exec(html)) !== null) {
      const num = Number(m3[2])
      if (!Number.isFinite(num) || seen.has(`${m3[1]}:${num}`)) continue
      seen.add(`${m3[1]}:${num}`)
      out.push({ providerChapterId: `${m3[1]}::${num}`, label: `Chapter ${m3[2]}`, number: num, kind: 'Chapter', unitType: 'chapter' })
    }
  }
  if (!out.length) throw new Error('empty chapter list')
  return out.sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
}

export async function batoGetPages(providerChapterId: string, signal?: AbortSignal): Promise<string[]> {
  const [slug, num] = providerChapterId.split('::')
  if (!slug || !num) throw new Error('bad chapter id')
  const res = await siteFetch(BATO_BASE, `/read/${slug}/chapter-${num}`, 15000, signal)
  if (!res.ok) throw new Error(`pages ${res.status}`)
  const html = await res.text()
  // Bato1 embeds page URLs as BARE hostnames (no scheme, no <img src>):
  // preload links + meta cdn-thumb-domain carry
  // cdn1.love4awalk.xyz/berserk/386/N.webp. Match bare-host paths, not
  // just <img src="https://..."> (verified 2026-09-27).
  const urls = [...new Set(
    [...html.matchAll(/(?:https?:)?\/\/(cdn1\.love4awalk\.xyz\/[^\s"'<>]+\.(?:webp|jpe?g|png))/gi)]
      .map(m => m[1].startsWith('http') ? m[1] : `https://${m[1]}`),
  )]
  if (!urls.length) throw new Error('empty page list')
  return urls
}

// ---------------- MangaKakalot.fun ----------------
const KK_BASE = 'https://mangakakalot.fun'

function parseKkSearch(html: string): { slug: string; title: string }[] {
  const out: { slug: string; title: string }[] = []
  const seen = new Set<string>()
  const re = /<a[^>]*href="\/manga\/([a-z0-9-]+)"[^>]*>([\s\S]{0,300}?)<\/a\s*>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null && out.length < 20) {
    if (seen.has(m[1])) continue
    seen.add(m[1])
    out.push({ slug: m[1], title: m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || m[1] })
  }
  return out
}

export async function kkSearchAndMatch(hint: ProviderHint | undefined, signal?: AbortSignal): Promise<MirrorMatch> {
  const variants = [hint?.english, hint?.title, hint?.native].map(s => (s || '').trim()).filter(Boolean) as string[]
  if (!variants.length) throw new Error('no title hints for manga match')
  const pooled = new Map<string, { slug: string; title: string }>()
  for (const q of variants.slice(0, 3)) {
    try {
      const res = await siteFetch(KK_BASE, `/search/story/${encodeURIComponent(q.replace(/\s+/g, '_'))}`, 12000, signal)
      if (!res.ok) continue
      for (const c of parseKkSearch(await res.text())) {
        if (!pooled.has(c.slug)) pooled.set(c.slug, c)
      }
    } catch { /* next */ }
  }
  // Direct-slug probe: normalized romaji often IS the slug (berserk).
  for (const v of variants.slice(0, 2)) {
    const slug = v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    if (!slug || pooled.has(slug)) continue
    try {
      const res = await siteFetch(KK_BASE, `/manga/${slug}`, 12000, signal)
      if (res.ok) {
        const html = await res.text()
        const t = /<h1[^>]*>([^<]{1,80})<\/h1>/i.exec(html)?.[1]?.trim() ?? slug
        pooled.set(slug, { slug, title: t })
      }
    } catch { /* next */ }
  }
  if (!pooled.size) throw new Error('no search results')
  const ranked = [...pooled.values()]
    .map(c => ({ c, s: Math.max(titleScore(c.title, variants), titleScore(c.slug.replace(/-/g, ' '), variants)) }))
    .sort((a, b) => b.s - a.s)
  const top = ranked[0]
  if (!top || top.s < THRESHOLD) throw new Error('no confident match')
  if (ranked.filter(r => r.s === top.s && r.c.slug !== top.c.slug).length) throw new Error('ambiguous match')
  return { providerMangaId: top.c.slug, providerTitle: top.c.title }
}

export async function kkGetChapters(slug: string, signal?: AbortSignal): Promise<MirrorChapter[]> {
  const res = await siteFetch(KK_BASE, `/manga/${slug}`, 15000, signal)
  if (!res.ok) throw new Error(`chapter list ${res.status}`)
  const html = await res.text()
  const out: MirrorChapter[] = []
  const seen = new Set<string>()
  // Absolute hrefs (https://mangakakalot.fun/chapter/<slug>/chapter-N) —
  // the served HTML uses absolute URLs, not root-relative (verified 2026-09-27).
  const re = /<a[^>]*href="(?:https?:\/\/[^/]+)?\/chapter\/[a-z0-9-]+\/chapter-([\d.]+)"[^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const num = Number(m[1])
    if (!Number.isFinite(num) || seen.has(m[1])) continue
    seen.add(m[1])
    out.push({ providerChapterId: `${slug}::${m[1]}`, label: `Chapter ${m[1]}`, number: num, kind: 'Chapter', unitType: 'chapter' })
  }
  if (!out.length) throw new Error('empty chapter list')
  return out.sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
}

export async function kkGetPages(providerChapterId: string, signal?: AbortSignal): Promise<string[]> {
  const [slug, num] = providerChapterId.split('::')
  if (!slug || !num) throw new Error('bad chapter id')
  const res = await siteFetch(KK_BASE, `/chapter/${slug}/chapter-${num}`, 15000, signal)
  if (!res.ok) throw new Error(`pages ${res.status}`)
  const html = await res.text()
  const urls = [...new Set(
    [...html.matchAll(/<img[^>]+src="(https?:\/\/(?:imgx\.mghcdn\.com|[^"]+?)\/[^"]+?\.(?:png|jpe?g|webp))[^"]*"/gi)].map(m => m[1]),
  )]
  if (!urls.length) throw new Error('empty page list')
  return urls
}

// ---------------- MangaRead (WP-Manga) ----------------
const MR_BASE = 'https://www.mangaread.org'

function parseMrSearch(html: string): { slug: string; title: string }[] {
  const out: { slug: string; title: string }[] = []
  const seen = new Set<string>()
  const re = /<a[^>]*href="https?:\/\/(?:www\.)?mangaread\.org\/manga\/([a-z0-9-]+)\/"[^>]*>([\s\S]{0,300}?)<\/a\s*>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null && out.length < 20) {
    if (seen.has(m[1])) continue
    seen.add(m[1])
    out.push({ slug: m[1], title: m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || m[1] })
  }
  return out
}

export async function mrSearchAndMatch(hint: ProviderHint | undefined, signal?: AbortSignal): Promise<MirrorMatch> {
  const variants = [hint?.english, hint?.title, hint?.native].map(s => (s || '').trim()).filter(Boolean) as string[]
  if (!variants.length) throw new Error('no title hints for manga match')
  const pooled = new Map<string, { slug: string; title: string }>()
  for (const q of variants.slice(0, 3)) {
    try {
      const res = await siteFetch(MR_BASE, `/?s=${encodeURIComponent(q)}&post_type=wp-manga`, 12000, signal)
      if (!res.ok) continue
      for (const c of parseMrSearch(await res.text())) {
        if (!pooled.has(c.slug)) pooled.set(c.slug, c)
      }
    } catch { /* next */ }
  }
  // Direct-slug probe (WP slugs are usually normalized romaji).
  for (const v of variants.slice(0, 2)) {
    const slug = v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    if (!slug || pooled.has(slug)) continue
    try {
      const res = await siteFetch(MR_BASE, `/manga/${slug}/`, 12000, signal)
      if (res.ok) pooled.set(slug, { slug, title: v })
    } catch { /* next */ }
  }
  if (!pooled.size) throw new Error('no search results')
  const ranked = [...pooled.values()]
    .map(c => ({ c, s: Math.max(titleScore(c.title, variants), titleScore(c.slug.replace(/-/g, ' '), variants)) }))
    .sort((a, b) => b.s - a.s)
  const top = ranked[0]
  if (!top || top.s < THRESHOLD) throw new Error('no confident match')
  if (ranked.filter(r => r.s === top.s && r.c.slug !== top.c.slug).length) throw new Error('ambiguous match')
  return { providerMangaId: top.c.slug, providerTitle: top.c.title }
}

export async function mrGetChapters(slug: string, signal?: AbortSignal): Promise<MirrorChapter[]> {
  const res = await siteFetch(MR_BASE, `/manga/${slug}/`, 15000, signal)
  if (!res.ok) throw new Error(`chapter list ${res.status}`)
  const html = await res.text()
  const out: MirrorChapter[] = []
  const seen = new Set<string>()
  // Absolute hrefs (https://www.mangaread.org/manga/<slug>/chapter-N/) —
  // the served HTML uses absolute URLs, not root-relative (verified 2026-09-27).
  const re = /<a[^>]*href="(?:https?:\/\/[^/]+)?\/manga\/[a-z0-9-]+\/chapter-([\d.]+)\/?"[^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const num = Number(m[1])
    if (!Number.isFinite(num) || seen.has(m[1])) continue
    seen.add(m[1])
    out.push({ providerChapterId: `${slug}::${m[1]}`, label: `Chapter ${m[1]}`, number: num, kind: 'Chapter', unitType: 'chapter' })
  }
  if (!out.length) throw new Error('empty chapter list')
  return out.sort((a, b) => (a.number ?? 0) - (b.number ?? 0))
}

export async function mrGetPages(providerChapterId: string, signal?: AbortSignal): Promise<string[]> {
  const [slug, num] = providerChapterId.split('::')
  if (!slug || !num) throw new Error('bad chapter id')
  const res = await siteFetch(MR_BASE, `/manga/${slug}/chapter-${num}/`, 15000, signal)
  if (!res.ok) throw new Error(`pages ${res.status}`)
  const html = await res.text()
  // src attributes contain literal whitespace/newlines around the URL
  // (verified 2026-09-27) — \s-tolerant match, then trim.
  const urls = [...new Set(
    [...html.matchAll(/<img[^>]+src="\s*(https?:\/\/[^\s"<>]+?\.(?:jpe?g|png|webp))[^\S"<>]*"[^>]*>/gi)]
      .filter(m => /wp-manga-chapter-img|uploads\/WP-manga/i.test(m[0]))
      .map(m => m[1].trim()),
  )]
  if (!urls.length) throw new Error('empty page list')
  return urls
}
