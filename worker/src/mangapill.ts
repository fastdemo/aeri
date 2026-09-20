/**
 * MangaPill manga resolution + chapter/page extraction (Worker-side).
 *
 * Verified 2026-09-20 (direct + Worker-egress probes):
 * - Search: GET /search?q=<query> (plain HTML, no JS needed), series links
 *   `<a href="/manga/<id>/<slug>">`. Numeric id is the stable identity.
 * - Series page: /manga/<id>/<slug>, chapter list is server-rendered:
 *   `<a href="/chapters/<mangaid>-<pageid>/<slug>-chapter-<N[.M]>">` +
 *   text "Chapter N[.M]". Full list, oldest→newest in DOM (we sort anyway).
 * - Chapter pages: GET /chapters/... returns HTML with static
 *   https://cdn.readdetectiveconan.com/file/mangap/...jpeg image URLs
 *   (verified real JPEG bytes, 200, no referer required).
 * - No auth, no CAPTCHA, no DRM — plain GET of public pages. No rate limit
 *   observed (6 rapid sequential requests all 200), but the Worker keeps a
 *   small gap anyway (shared mangaFetch gate).
 *
 * Security: public HTML only. Images go through the existing signed
 * `/api/manga/img` relay (suffix allowlist extended with the CDN host).
 */

import type { ProviderHint } from './providers'

const MP_BASE = 'https://mangapill.com'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export interface MpChapter {
  providerChapterId: string
  label: string
  number: number | null
  kind?: string
  unitType?: 'volume' | 'chapter'
  publishedAt?: string
}

export interface MpMatch {
  providerMangaId: string
  providerTitle: string
}

async function mpFetch(path: string, init: RequestInit = {}, timeoutMs = 12000, signal?: AbortSignal): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  if (signal) {
    if (signal.aborted) ctrl.abort((signal as any).reason)
    else signal.addEventListener('abort', () => ctrl.abort((signal as any).reason), { once: true })
  }
  try {
    return await fetch(`${MP_BASE}${path}`, {
      ...init,
      headers: { 'User-Agent': UA, Accept: 'text/html,*/*', Referer: `${MP_BASE}/`, ...(init.headers || {}) },
      signal: ctrl.signal,
    })
  } finally {
    clearTimeout(t)
  }
}

function normalizeTitle(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenJaccard(a: string, b: string): number {
  const ta = new Set(a.split(' ').filter(Boolean))
  const tb = new Set(b.split(' ').filter(Boolean))
  if (!ta.size || !tb.size) return 0
  let inter = 0
  for (const t of ta) if (tb.has(t)) inter++
  return inter / (ta.size + tb.size - inter)
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
    best = Math.max(best, Math.round(tokenJaccard(n, v) * 50))
  }
  return best
}

const MP_MATCH_THRESHOLD = 40

interface MpCandidate { id: string; slug: string; title: string }

/** Series title from the anchor: prefer inner text, else slug words. */
function parseSearchResults(html: string): MpCandidate[] {
  const out: MpCandidate[] = []
  const seen = new Set<string>()
  const re = /<a[^>]*href="\/manga\/(\d+)\/([^"]+)"[^>]*>([\s\S]{0,800}?)<\/a\s*>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null && out.length < 20) {
    const id = m[1]
    if (seen.has(id)) continue
    seen.add(id)
    const inner = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    const title = inner || m[2].replace(/-/g, ' ')
    out.push({ id, slug: m[2], title })
    if (out.length >= 20) break
  }
  return out
}

export async function mpSearchAndMatch(hint: ProviderHint | undefined, signal?: AbortSignal): Promise<MpMatch> {
  const romaji = (hint?.title || '').trim()
  const english = (hint?.english || '').trim()
  const native = (hint?.native || '').trim()
  const variants = [romaji, english, native].filter(Boolean) as string[]
  if (!variants.length) throw new Error('no title hints for manga match')
  const pooled = new Map<string, MpCandidate>()
  for (const q of [english, romaji, native].filter(Boolean).slice(0, 3) as string[]) {
    try {
      const res = await mpFetch(`/search?q=${encodeURIComponent(q)}`, {}, 12000, signal)
      if (!res.ok) continue
      const html = await res.text()
      for (const c of parseSearchResults(html)) {
        if (!pooled.has(c.id)) pooled.set(c.id, c)
      }
    } catch { /* next query */ }
  }
  if (!pooled.size) throw new Error('no search results')
  const ranked = [...pooled.values()]
    .map((c) => ({
      c,
      s: Math.max(titleScore(c.title, variants), titleScore(c.slug.replace(/-/g, ' '), variants)),
    }))
    .sort((a, b) => b.s - a.s)
  const best = ranked[0]
  if (!best || best.s < MP_MATCH_THRESHOLD) throw new Error('no confident match')
  const tied = ranked.filter((r) => r.s === best.s && r.c.id !== best.c.id)
  if (tied.length) throw new Error('ambiguous match')
  return { providerMangaId: `${best.c.id}/${best.c.slug}`, providerTitle: best.c.title }
}

function parseChapterList(html: string): MpChapter[] {
  const out: MpChapter[] = []
  const seen = new Set<string>()
  const re = /<a[^>]*href="(\/chapters\/(\d+)-(\d+)\/[^"]+)"[^>]*>([\s\S]{0,500}?)<\/a\s*>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const href = m[1]
    const key = `${m[2]}-${m[3]}`
    if (seen.has(key)) continue
    const raw = m[4].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
    // MangaPill labels are "Chapter N[.M]" (Spy x Family uses Chapter N for
    // its Missions — provider's own label preserved verbatim).
    const lm = /(Chapter\s+\d+(?:\.\d+)?|Mission\s+\d+(?:\.\d+)?|Prologue\s+\d+(?:\.\d+)?|Epilogue\s+\d+(?:\.\d+)?|Volume\s+\d+(?:\.\d+)?|Oneshot|One-shot)/i.exec(raw)
    const label = lm ? lm[1].replace(/\s+/g, ' ').trim() : raw.slice(0, 40)
    const numM = /(\d+(?:\.\d+)?)\s*$/.exec(label)
    seen.add(key)
    out.push({
      providerChapterId: key,
      label,
      number: numM ? Number(numM[1]) : null,
      kind: /^Mission/i.test(label) ? 'Mission' : /^Chapter/i.test(label) ? 'Chapter' : undefined,
      unitType: 'chapter',
    })
  }
  return out
}

const mpMatchCache = new Map<string, { at: number; m: MpMatch }>()
const mpChaptersCache = new Map<string, { at: number; list: MpChapter[] }>()

export async function mpGetChapters(providerMangaId: string, signal?: AbortSignal): Promise<MpChapter[]> {
  const key = `mp-ch:${providerMangaId}`
  const hit = mpChaptersCache.get(key)
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.list
  const res = await mpFetch(`/manga/${providerMangaId}`, {}, 15000, signal)
  if (!res.ok) throw new Error(`chapter list ${res.status}`)
  const html = await res.text()
  const list = parseChapterList(html)
  if (!list.length) throw new Error('empty chapter list')
  mpChaptersCache.set(key, { at: Date.now(), list })
  if (mpChaptersCache.size > 200) {
    const oldest = mpChaptersCache.keys().next().value as string | undefined
    if (oldest !== undefined) mpChaptersCache.delete(oldest)
  }
  return list
}

export async function mpGetPages(providerChapterId: string, signal?: AbortSignal): Promise<string[]> {
  const [mangaId, pageId] = providerChapterId.split('-')
  if (!mangaId || !pageId) throw new Error('bad chapter id')
  // Chapter slug is needed for the URL but the id pair resolves it: fetch
  // the series page once (cached) to map pageId → full href.
  const seriesKey = `mp-href:${mangaId}`
  let hrefMap = mpHrefCache.get(seriesKey)
  if (!hrefMap || Date.now() - hrefMap.at > 10 * 60 * 1000) {
    hrefMap = { at: Date.now(), map: new Map() }
    mpHrefCache.set(seriesKey, hrefMap)
  }
  let href = hrefMap.map.get(pageId)
  if (!href) {
    // Rebuild from series page (also refreshes chapter list cache).
    const series = await mpGetChaptersByMangaId(Number(mangaId), signal)
    href = series.hrefs.get(pageId) ?? null
    for (const [k, v] of series.hrefs) hrefMap.map.set(k, v)
    if (!href) throw new Error('unknown chapter')
  }
  const res = await mpFetch(href, {}, 15000, signal)
  if (!res.ok) throw new Error(`pages ${res.status}`)
  const html = await res.text()
  const urls = [...new Set(
    [...html.matchAll(/(?:data-src|src)="(https?:\/\/cdn\.[^"<>\s]+)"/g)].map((m) => m[1]),
  )].filter((u) => /\.(png|jpe?g|webp)(\?|$)/i.test(u) || /\/\d+\.(jpeg|jpg|png)/i.test(u))
  if (!urls.length) throw new Error('empty page list')
  return urls
}

const mpHrefCache = new Map<string, { at: number; map: Map<string, string> }>()

async function mpGetChaptersByMangaId(mangaId: number, signal?: AbortSignal): Promise<{ list: MpChapter[]; hrefs: Map<string, string> }> {
  // Find providerMangaId via cache scan (match stores it); fallback: direct id.
  let slug: string | null = null
  for (const { m } of mpMatchCache.values()) {
    if (m.providerMangaId.startsWith(`${mangaId}/`)) { slug = m.providerMangaId; break }
  }
  const pid = slug ?? String(mangaId)
  const res = await mpFetch(`/manga/${pid}`, {}, 15000, signal)
  if (!res.ok) throw new Error(`chapter list ${res.status}`)
  const html = await res.text()
  const hrefs = new Map<string, string>()
  const re = /<a[^>]*href="(\/chapters\/(\d+)-(\d+)\/[^"]+)"[^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    if (m[2] === String(mangaId) && !hrefs.has(m[3])) hrefs.set(m[3], m[1])
  }
  return { list: parseChapterList(html), hrefs }
}

export function mpMatchCached(key: string): MpMatch | null {
  const hit = mpMatchCache.get(key)
  if (hit && Date.now() - hit.at < 60 * 60 * 1000) return hit.m
  return null
}

export function mpMatchStore(key: string, m: MpMatch) {
  mpMatchCache.set(key, { at: Date.now(), m })
  if (mpMatchCache.size > 500) {
    const oldest = mpMatchCache.keys().next().value as string | undefined
    if (oldest !== undefined) mpMatchCache.delete(oldest)
  }
}
