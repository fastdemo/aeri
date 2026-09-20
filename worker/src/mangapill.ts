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
  // Ranked walk with second-chance rule: the top scorer is tried first;
  // if it fails sanity/verification AND a LATER candidate matches the
  // query substantially better on token overlap (its score is within 25 of
  // the top AND it contains rare query tokens the top lacks), try it before
  // failing closed. This handles side-story queries ("Kurapika Tsuioku-hen")
  // where the parent series outscores the true entry on prefix rules, while
  // never letting a weak candidate steal a strong top match.
  const ranked = [...pooled.values()]
    .map((c) => ({
      c,
      s: Math.max(titleScore(c.title, variants), titleScore(c.slug.replace(/-/g, ' '), variants)),
    }))
    .sort((a, b) => b.s - a.s)
  const top = ranked[0]
  // A top scorer that fails sanity/verification gets ONE generic second
  // chance (rare-token rule below) before failing closed. Exact ties at
  // the top fail closed immediately — never guess between equals.
  if (top && top.s >= MP_MATCH_THRESHOLD) {
    const tied = ranked.filter((r) => r.s === top.s && r.c.id !== top.c.id)
    if (tied.length) {
      // Tie-break BEFORE failing: if exactly one of the tied candidates
      // carries strictly more rare query tokens, it is the evident winner
      // (e.g. "kurapika"+"tsuioku" vs the parent series matching on the
      // shared prefix alone). Otherwise fail closed.
      const w = mpTieBreak([top, ...tied], variants)
      if (!w) throw new Error('ambiguous match')
      if (mpTitleSanityOk(w.c.title, hint)) {
        const vw = await mpVerifyMatch(w.c.id, w.c.slug, hint, signal)
        if (vw.ok) {
          return { providerMangaId: `${w.c.id}/${w.c.slug}`, providerTitle: w.c.title }
        }
      }
      throw new Error('no confident match')
    }
    if (mpTitleSanityOk(top.c.title, hint)) {
      const verified = await mpVerifyMatch(top.c.id, top.c.slug, hint, signal)
      if (verified.ok) {
        return { providerMangaId: `${top.c.id}/${top.c.slug}`, providerTitle: top.c.title }
      }
      // Second chance: a later candidate with strong token evidence.
      const second = mpSecondChance(ranked, top, variants, hint)
      if (second) {
        const v2 = await mpVerifyMatch(second.c.id, second.c.slug, hint, signal)
        if (v2.ok && mpTitleSanityOk(second.c.title, hint)) {
          return { providerMangaId: `${second.c.id}/${second.c.slug}`, providerTitle: second.c.title }
        }
      }
    }
    throw new Error('no confident match')
  }
  throw new Error('no confident match')
}

/**
 * Tie-break for exact top-score ties (generic, no titles): the tied
 * candidate with strictly more rare query tokens wins. Rare = query tokens
 * (len>2) appearing in ≤2 candidates' titles/slugs. Returns null when no
 * candidate strictly dominates (genuine ambiguity → fail closed).
 */
function mpTieBreak(
  tied: { c: MpCandidate; s: number }[],
  variants: string[],
): { c: MpCandidate; s: number } | null {
  const qtokens = new Set(variants.flatMap(v => normalizeTitle(v).split(' ').filter(t => t.length > 2)))
  if (!qtokens.size) return null
  const freq = new Map<string, number>()
  for (const { c } of tied) {
    const ct = new Set(normalizeTitle(`${c.title} ${c.slug.replace(/-/g, ' ')}`).split(' ').filter(Boolean))
    for (const t of qtokens) if (ct.has(t)) freq.set(t, (freq.get(t) ?? 0) + 1)
  }
  const rareHit = (c: MpCandidate): number => {
    const ct = new Set(normalizeTitle(`${c.title} ${c.slug.replace(/-/g, ' ')}`).split(' ').filter(Boolean))
    let n = 0
    for (const t of qtokens) if (ct.has(t) && (freq.get(t) ?? 99) <= 2) n++
    return n
  }
  let best: { c: MpCandidate; s: number } | null = null
  let bestN = -1
  let ambiguous = false
  for (const cand of tied) {
    const n = rareHit(cand.c)
    if (n > bestN) { bestN = n; best = cand; ambiguous = false }
    else if (n === bestN) ambiguous = true
  }
  if (!best || ambiguous) return null
  return best
}

/**
 * Second-chance rule (generic, no titles): when the top scorer fails
 * verification, look for a later candidate that (a) is within 25 points,
 * (b) shares MORE rare query tokens with the query than the top does.
 * Rare = tokens appearing in ≤2 candidates. Prevents parent-series
 * absorption of side-story queries without weakening the top-wins rule.
 */
function mpSecondChance(
  ranked: { c: MpCandidate; s: number }[],
  top: { c: MpCandidate; s: number },
  variants: string[],
  hint: ProviderHint | undefined,
): { c: MpCandidate; s: number } | null {
  void hint
  const qtokens = new Set(variants.flatMap(v => normalizeTitle(v).split(' ').filter(t => t.length > 2)))
  if (!qtokens.size) return null
  const freq = new Map<string, number>()
  for (const { c } of ranked) {
    const ct = new Set(normalizeTitle(`${c.title} ${c.slug.replace(/-/g, ' ')}`).split(' ').filter(Boolean))
    for (const t of qtokens) if (ct.has(t)) freq.set(t, (freq.get(t) ?? 0) + 1)
  }
  const rareHit = (c: MpCandidate): number => {
    const ct = new Set(normalizeTitle(`${c.title} ${c.slug.replace(/-/g, ' ')}`).split(' ').filter(Boolean))
    let n = 0
    for (const t of qtokens) if (ct.has(t) && (freq.get(t) ?? 99) <= 2) n++
    return n
  }
  const topRare = rareHit(top.c)
  let best: { c: MpCandidate; s: number } | null = null
  for (const cand of ranked.slice(1)) {
    if (top.s - cand.s > 25) break
    if (cand.s < MP_MATCH_THRESHOLD) break
    if (rareHit(cand.c) > topRare) { best = cand; break }
  }
  return best
}

/**
 * Generic sanity + verification for MangaPill matches (no title rules):
 * oneshot-shaped titles rejected for 50+ chapter series; chapter-list size
 * must not be a thin slice (<10 units AND <10% of expected) of a long run;
 * mirror-image (420-unit series for a 2-ch work) rejected when expected ≤ 10.
 */
function mpTitleSanityOk(candidateTitle: string, hint: ProviderHint | undefined): boolean {
  const expectedCh = hint?.expectedChapters
  if (typeof expectedCh !== 'number' || expectedCh < 50) return true
  return !/\boneshot\b|\bone-shot\b/i.test(`${candidateTitle}`)
}

async function mpVerifyMatch(
  mangaId: string,
  slug: string,
  hint: ProviderHint | undefined,
  signal?: AbortSignal,
): Promise<{ ok: boolean }> {
  const expectedCh = hint?.expectedChapters
  let list: MpChapter[]
  try {
    list = await mpGetChapters(`${mangaId}/${slug}`, signal)
  } catch {
    return { ok: true }
  }
  if (typeof expectedCh === 'number' && expectedCh >= 50) {
    if (list.length < 10 && list.length < expectedCh * 0.1) return { ok: false }
  }
  if (typeof expectedCh === 'number' && expectedCh > 0 && expectedCh <= 10) {
    if (list.length > expectedCh * 10) return { ok: false }
  }
  return { ok: true }
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
