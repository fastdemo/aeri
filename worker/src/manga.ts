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
  /** Provider's own unit type: 'volume' for Volume/Vol labels, else 'chapter'. Never renamed. */
  unitType?: 'volume' | 'chapter'
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

/**
 * Sanity-check a WeebCentral match against AniList published totals.
 * Generic rules only — no title-specific exceptions:
 * - candidate title is shaped like a single-unit oneshot but AniList
 *   expects a long series (50+ chapters) → reject at match time.
 * - full verification happens in wcVerifyMatch (chapter-list size vs
 *   expected totals) after the top candidate is chosen.
 */
function wcTitleSanityOk(candidateTitle: string, hint: ProviderHint | undefined): boolean {
  const expectedCh = hint?.expectedChapters
  if (typeof expectedCh !== 'number' || expectedCh < 50) return true
  const t = `${candidateTitle}`.toLowerCase()
  if (/\boneshot\b|\bone-shot\b/.test(t)) return false
  return true
}

/**
 * Post-match verification: fetch the candidate's chapter list and compare
 * against AniList published totals. Rejects long-series mismatches (e.g. a
 * 2-chapter side story matched for a 400-ch series) WITHOUT knowing any
 * titles: pure count-vs-count arithmetic.
 * - expected ≥ 50 chapters but candidate has < 10% of expected AND < 10
 *   units absolute → reject ('series-length mismatch').
 * - Otherwise accept (short series, oneshots, and licensed gaps pass).
 */
export async function wcVerifyMatch(
  providerMangaId: string,
  hint: ProviderHint | undefined,
  signal?: AbortSignal,
): Promise<{ ok: boolean; reason?: string; units?: number }> {
  const expectedCh = hint?.expectedChapters
  if (typeof expectedCh !== 'number' || expectedCh < 50) return { ok: true }
  let list: WcChapter[]
  try {
    list = await wcGetChapters(providerMangaId, signal)
  } catch (e) {
    // Can't verify (network) — don't block on verification failure alone.
    return { ok: true }
  }
  const units = list.length
  if (units < 10 && units < expectedCh * 0.1) {
    return { ok: false, reason: `series-length mismatch (${units} units vs ${expectedCh} published)`, units }
  }
  return { ok: true, units }
}

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
  const queries = [english, romaji, native].filter(Boolean) as string[]
  let candidates: WcCandidate[] = []
  // Replica of the browser htmx quick-search request (verified 2026-09-19:
  // the page fires POST /search/simple?location=main with HX-Request/HX-*
  // headers; without them the endpoint returns "No results found" for every
  // query). All queries are attempted and their candidates pooled — the best
  // title score across every query wins, not just the first query with hits.
  const htmxHeaders = {
    'Content-Type': 'application/x-www-form-urlencoded',
    'HX-Request': 'true',
    'HX-Trigger': 'quick-search-input',
    'HX-Trigger-Name': 'text',
    'HX-Target': 'quick-search-result',
    'HX-Current-URL': `${WC_BASE}/`,
  }
  const pooled = new Map<string, WcCandidate>()
  for (const q of queries.slice(0, 3)) {
    try {
      const res = await wcFetch('/search/simple?location=main', {
        method: 'POST',
        headers: htmxHeaders,
        body: `text=${encodeURIComponent(q)}`,
      }, 12000, signal)
      if (!res.ok) continue
      const html = await res.text()
      for (const c of parseSearchResults(html)) {
        if (!pooled.has(c.id)) pooled.set(c.id, c)
      }
    } catch { /* try next query */ }
  }
  candidates = [...pooled.values()]
  if (!candidates.length) throw new Error('no search results')
  // Rank ALL candidates by title score, then walk down the ranking: the
  // first candidate that passes BOTH the confidence threshold AND the
  // generic sanity checks wins. This fixes the "wrong series with a
  // slightly better title score" class (e.g. a side-story matching a long
  // series' name better than the series itself): the better-scoring but
  // length-mismatched candidate is skipped in favor of the true series.
  const ranked = candidates
    .map((c) => ({ c, s: candidateTitleScore(c, variants) }))
    .sort((a, b) => b.s - a.s)
  for (const cand of ranked) {
    if (cand.s < WC_MATCH_THRESHOLD) break
    // Exact ties (two different series, same top score) fail closed.
    const tied = ranked.filter((r) => r.s === cand.s && r.c.id !== cand.c.id)
    if (tied.length) throw new Error('ambiguous match')
    if (!wcTitleSanityOk(cand.c.title, hint)) continue
    const verified = await wcVerifyMatch(cand.c.id, hint, signal)
    if (!verified.ok) continue
    // Do NOT cache here — the route caches per-AniList-id AFTER this
    // returns, keyed by the real anilistId. (Caching inside the matcher,
    // which never sees the id, would poison unrelated entries.)
    return { providerMangaId: cand.c.id, providerTitle: cand.c.title }
  }
  throw new Error('no confident match')
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
    // Provider units are opaque readable units — chapters, missions,
    // prologues, epilogues, oneshots, OR volumes. Never rename a volume to
    // a chapter: kind captures the provider's own prefix, unitType drives
    // display wording ("Volume 3" vs "Chapter 12" vs "Mission 140").
    const lm = /(Chapter\s+\d+(?:\.\d+)?|Mission\s+\d+(?:\.\d+)?|Misson\s+\d+(?:\.\d+)?|Prologue\s+\d+(?:\.\d+)?|Epilogue\s+\d+(?:\.\d+)?|Volume\s+\d+(?:\.\d+)?|Vol\.?\s+\d+(?:\.\d+)?|Oneshot|One-shot|One shot|#\s*\d+(?:\.\d+)?)/i.exec(raw)
    const label = lm ? lm[1].replace(/\s+/g, ' ').trim() : raw.slice(0, 40)
    const numM = /(\d+(?:\.\d+)?)\s*$/.exec(label)
    const kindM = /^(Chapter|Mission|Misson|Prologue|Epilogue|Volume|Vol\.?|Oneshot|One-?shot|One shot|#)/i.exec(label)
    const kind = kindM ? kindM[1] : undefined
    const kk = (kind ?? '').toLowerCase().replace(/\.$/, '')
    const unitType: 'volume' | 'chapter' = (kk === 'volume' || kk === 'vol') ? 'volume' : 'chapter'
    const tm = /datetime="([^"]+)"/.exec(inner)
    seen.add(id)
    out.push({
      providerChapterId: id,
      label,
      number: numM ? Number(numM[1]) : null,
      kind,
      unitType,
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
  // Page-image hosts rotate: planeptune (hot/scans-hot) AND lowee
  // (official.lowee.us — observed 2026-09-20 on Uzumaki/Eri units).
  // Accept any same-shape https image URL, then gate by suffix allowlist
  // at the relay (never an open proxy).
  const urls = [...new Set(
    [...html.matchAll(/https:\/\/(?:hot|scans-hot|official)\.(?:planeptune|lowee)\.us\/[^"<>\s]+/g)].map((m) => m[0]),
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
