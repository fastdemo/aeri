/**
 * WeebCentral manga resolution + chapter/page extraction (Worker-side).
 *
 * Verified behavior (2026-09-18, direct + Worker-egress probes):
 * - Search: POST /search/simple?location=main, form field `text=<query>`,
 *   returns HTML fragment with <a href="/series/<ULID>/<slug>"> + title text.
 * - Series page: /series/<ULID>/<slug>, chapter list at
 *   GET /series/<ULID>/full-chapter-list (HTML, <a href="/chapters/<ULID>">
 *   + <span>Chapter N</span> / "Prologue N" labels + <time datetime>).
 * - Chapter pages: GET /chapters/<ULID>/images?is_prev=False&
 *   reading_style=long_strip&current_page=1 returns HTML with static
 *   https://hot.planeptune.us/manga/...png|jpg image URLs (verified real
 *   JPEG bytes, 200, no referer required).
 *
 * Security: no CAPTCHA/DRM/auth bypass — plain GET/POST of the site's public
 * htmx endpoints. Images are browser-direct (no referer needed, CORS
 * irrelevant for <img>); no proxy needed.
 */

import type { ProviderHint } from './providers'

const WC_BASE = 'https://weebcentral.com'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export interface WcChapter {
  providerChapterId: string
  label: string
  number: number | null
  kind?: string
  publishedAt?: string
}

export interface WcMatch {
  providerMangaId: string
  providerTitle: string
}

async function wcFetch(path: string, init: RequestInit = {}, timeoutMs = 10000, signal?: AbortSignal): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  const ext = init.signal
  if (ext) {
    if (ext.aborted) ctrl.abort((ext as any).reason)
    else ext.addEventListener('abort', () => ctrl.abort((ext as any).reason), { once: true })
  }
  if (signal) {
    if (signal.aborted) ctrl.abort((signal as any).reason)
    else signal.addEventListener('abort', () => ctrl.abort((signal as any).reason), { once: true })
  }
  try {
    return await fetch(`${WC_BASE}${path}`, {
      ...init,
      headers: { 'User-Agent': UA, Accept: 'text/html,*/*', Referer: `${WC_BASE}/`, ...(init.headers || {}) },
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
    .replace(/[\u0300-\u036f]/g, '')
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

const WC_MATCH_THRESHOLD = 40

interface WcCandidate { id: string; slug: string; title: string }

function parseSearchResults(html: string): WcCandidate[] {
  const out: WcCandidate[] = []
  const seen = new Set<string>()
  const re = /<a[^>]*href="https?:\/\/weebcentral\.com\/series\/([A-Z0-9]{20,40})\/([^"]*)"[^>]*>([\s\S]{0,2000}?)<\/a\s*>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null && out.length < 20) {
    const id = m[1]
    if (seen.has(id)) continue
    seen.add(id)
    const inner = m[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    // Title is the trailing text node (after cover alt text); take last 120 chars chunk
    const title = inner.slice(-160).trim() || inner.slice(0, 120)
    out.push({ id, slug: m[2], title })
    if (out.length >= 20) break
  }
  // Fallback: relative hrefs
  if (!out.length) {
    const re2 = /<a[^>]*href="\/series\/([A-Z0-9]{20,40})\/([^"]*)"[^>]*>([\s\S]{0,2000}?)<\/a\s*>/gi
    let m2: RegExpExecArray | null
    while ((m2 = re2.exec(html)) !== null && out.length < 20) {
      const id = m2[1]
      if (seen.has(id)) continue
      seen.add(id)
      const inner = m2[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      out.push({ id, slug: m2[2], title: inner.slice(-160).trim() || inner.slice(0, 120) })
    }
  }
  return out
}

function candidateTitleScore(c: WcCandidate, variants: string[]): number {
  // Slug is a reliable normalized title: "the-berserkers-second-playthrough"
  const slugTitle = c.slug.replace(/-/g, ' ')
  return Math.max(titleScore(c.title, variants), titleScore(slugTitle, variants))
}

export async function wcSearchAndMatch(hint: ProviderHint | undefined, signal?: AbortSignal): Promise<WcMatch> {
  const romaji = (hint?.title || '').trim()
  const english = (hint?.english || '').trim()
  const native = (hint?.native || '').trim()
  const variants = [romaji, english, native].filter(Boolean) as string[]
  if (!variants.length) throw new Error('no title hints for manga match')
  const queries = [english, romaji].filter(Boolean) as string[]
  let candidates: WcCandidate[] = []
  for (const q of queries.slice(0, 2)) {
    try {
      const res = await wcFetch('/search/simple?location=main', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `text=${encodeURIComponent(q)}`,
      }, 10000, signal)
      if (!res.ok) continue
      const html = await res.text()
      candidates = parseSearchResults(html)
      if (candidates.length) break
    } catch { /* try next query */ }
  }
  if (!candidates.length) throw new Error('no search results')
  const ranked = candidates
    .map((c) => ({ c, s: candidateTitleScore(c, variants) }))
    .sort((a, b) => b.s - a.s)
  const best = ranked[0]
  if (!best || best.s < WC_MATCH_THRESHOLD) throw new Error('no confident match')
  // Exact ties (two different series, same top score) fail closed.
  const tied = ranked.filter((r) => r.s === best.s && r.c.id !== best.c.id)
  if (tied.length) throw new Error('ambiguous match')
  return { providerMangaId: best.c.id, providerTitle: best.c.title }
}

function parseChapterList(html: string): WcChapter[] {
  const out: WcChapter[] = []
  const seen = new Set<string>()
  const re = /<a[^>]*href="\/chapters\/([A-Z0-9]{20,40})"[^>]*>([\s\S]{0,3000}?)<\/a\s*>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const id = m[1]
    if (seen.has(id)) continue
    const inner = m[2]
    // Chapter label lives in its OWN <span class=""> ("Chapter 386",
    // "Prologue 2", "# 95"); sibling spans hold Last Read / new badges.
    // Never use the whole anchor text — it mixes badges + timestamps.
    const spanTexts = [...inner.matchAll(/<span class="">([^<]{1,60})<\/span>/g)]
      .map((s) => s[1].replace(/\s+/g, ' ').trim())
      .filter(Boolean)
    const raw = spanTexts[0] ?? inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
    const lm = /(Chapter\s+\d+(?:\.\d+)?|Prologue\s+\d+(?:\.\d+)?|Epilogue\s+\d+(?:\.\d+)?|Volume\s+\d+|Oneshot|One-shot|#\s*\d+(?:\.\d+)?)/i.exec(raw)
    const label = lm ? lm[1].replace(/\s+/g, ' ').trim() : raw.slice(0, 40)
    const numM = /(\d+(?:\.\d+)?)\s*$/.exec(label)
    const kindM = /^(Chapter|Prologue|Epilogue|Volume|Oneshot|One-?shot|#)/i.exec(label)
    const tm = /datetime="([^"]+)"/.exec(inner)
    seen.add(id)
    out.push({
      providerChapterId: id,
      label,
      number: numM ? Number(numM[1]) : null,
      kind: kindM ? kindM[1] : undefined,
      publishedAt: tm ? tm[1] : undefined,
    })
  }
  return out
}

const wcMatchCache = new Map<string, { at: number; m: WcMatch }>()
const wcChaptersCache = new Map<string, { at: number; list: WcChapter[] }>()
const wcPagesCache = new Map<string, { at: number; pages: string[] }>()

export async function wcGetChapters(providerMangaId: string, signal?: AbortSignal): Promise<WcChapter[]> {
  const key = `ch:${providerMangaId}`
  const hit = wcChaptersCache.get(key)
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.list
  const res = await wcFetch(`/series/${providerMangaId}/full-chapter-list`, {}, 12000, signal)
  if (!res.ok) throw new Error(`chapter list ${res.status}`)
  const html = await res.text()
  const list = parseChapterList(html)
  if (!list.length) throw new Error('empty chapter list')
  wcChaptersCache.set(key, { at: Date.now(), list })
  if (wcChaptersCache.size > 200) {
    const oldest = wcChaptersCache.keys().next().value as string | undefined
    if (oldest !== undefined) wcChaptersCache.delete(oldest)
  }
  return list
}

export async function wcGetPages(providerChapterId: string, signal?: AbortSignal): Promise<string[]> {
  const key = `pg:${providerChapterId}`
  const hit = wcPagesCache.get(key)
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.pages
  const res = await wcFetch(
    `/chapters/${providerChapterId}/images?is_prev=False&reading_style=long_strip&current_page=1`,
    {},
    12000,
    signal,
  )
  if (!res.ok) throw new Error(`pages ${res.status}`)
  const html = await res.text()
  const urls = [...new Set(
    [...html.matchAll(/https:\/\/(?:hot|scans-hot)\.planeptune\.us\/[^"<>\s]+/g)].map((m) => m[0]),
  )].filter((u) => /\.(png|jpe?g|webp)(\?|$)/i.test(u))
  if (!urls.length) throw new Error('empty page list')
  wcPagesCache.set(key, { at: Date.now(), pages: urls })
  if (wcPagesCache.size > 200) {
    const oldest = wcPagesCache.keys().next().value as string | undefined
    if (oldest !== undefined) wcPagesCache.delete(oldest)
  }
  return urls
}

export function wcMatchCached(key: string): WcMatch | null {
  const hit = wcMatchCache.get(key)
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.m
  return null
}

export function wcMatchStore(key: string, m: WcMatch) {
  wcMatchCache.set(key, { at: Date.now(), m })
  if (wcMatchCache.size > 500) {
    const oldest = wcMatchCache.keys().next().value as string | undefined
    if (oldest !== undefined) wcMatchCache.delete(oldest)
  }
}
