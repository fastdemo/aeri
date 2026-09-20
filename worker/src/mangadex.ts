/**
 * MangaDex manga resolution + chapter/page extraction (Worker-side).
 *
 * Verified 2026-09-19 (direct + Worker-egress probes):
 * - Search: GET /manga?title=<q>&limit=10&includes[]=cover_art → data[] with
 *   id (UUID), attributes.title{en,...}, attributes.links{al,mal,...},
 *   relationships[] (cover_art → attributes.fileName).
 * - AniList mapping: attributes.links.al = AniList numeric id as STRING
 *   ("30002" for Berserk). Absent when unmapped.
 * - Feed: GET /manga/<uuid>/feed?limit=500&translatedLanguage[]=en
 *   &contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica
 *   &order[chapter]=asc → data[] with attributes.chapter (STRING|null),
 *   volume (string|null), title, pages, externalUrl. Max limit 500; `total`
 *   gives the full count (paginate with offset when total > fetched).
 * - External chapters (externalUrl set, pages=0) host NO images on MangaDex
 *   (licensed/DMCA'd, e.g. all of Solo Leveling EN) — filtered out of the
 *   readable list, surfaced separately as external links.
 * - At-home: GET /at-home/server/<chapterUuid> →
 *   { baseUrl, chapter: { hash, data[], dataSaver[] } }. Page URL:
 *   <baseUrl>/data-saver/<hash>/<file> (default; ~38% smaller) or
 *   <baseUrl>/data/<hash>/<file> (full). Filenames are opaque — never derive.
 * - Covers: https://uploads.mangadex.org/covers/<mangaUuid>/<fileName>
 *   (.512.jpg thumbnail variant).
 * - No auth. Documented limit 5 req/s — worker serializes per-request with a
 *   small gap; 429 → single backoff retry, else honest error.
 * - Fail closed: no confident match → throw (never a random series); no
 *   readable pages → empty with reason (never fabricated).
 */

const MDX_API = 'https://api.mangadex.org'
const MDX_UA = 'Aeri/1.0 (+https://aeri.fastdemo.workers.dev)'
const MDX_COVER = 'https://uploads.mangadex.org/covers'

export interface MdxChapter {
  providerChapterId: string
  label: string
  number: number | null
  kind?: string
  unitType?: 'volume' | 'chapter'
  volume?: string | null
  title?: string
  pages?: number
  externalUrl?: string
  language?: string
  publishedAt?: string
}

export interface MdxMatch {
  providerMangaId: string
  providerTitle: string
  coverUrl?: string
}

// Serialize MangaDex requests (≤4 req/s) + one backoff retry on 429.
let lastMdxAt = 0
async function mdxFetch(path: string, signal?: AbortSignal, timeoutMs = 12000): Promise<Response> {
  const gap = Date.now() - lastMdxAt
  if (gap < 250) await new Promise(r => setTimeout(r, 250 - gap))
  const doFetch = async (): Promise<Response> => {
    lastMdxAt = Date.now()
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), timeoutMs)
    if (signal) {
      if (signal.aborted) ctrl.abort((signal as any).reason)
      else signal.addEventListener('abort', () => ctrl.abort((signal as any).reason), { once: true })
    }
    try {
      return await fetch(`${MDX_API}${path}`, {
        headers: { 'User-Agent': MDX_UA, Accept: 'application/json' },
        signal: ctrl.signal,
      })
    } finally {
      clearTimeout(t)
    }
  }
  let res = await doFetch()
  if (res.status === 429) {
    await new Promise(r => setTimeout(r, 1500))
    res = await doFetch()
  }
  return res
}

function mdxTitle(attrs: any): string {
  const t = attrs?.title ?? {}
  return String(t.en ?? t['en-US'] ?? t['ja-ro'] ?? Object.values(t)[0] ?? '')
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

const MDX_MATCH_THRESHOLD = 40

function coverOf(m: any): string | undefined {
  const rel = (m.relationships ?? []).find((r: any) => r.type === 'cover_art')
  const fn = rel?.attributes?.fileName
  if (!fn) return undefined
  return `${MDX_COVER}/${m.id}/${fn}.512.jpg`
}

function altTitlesOf(attrs: any): string[] {
  const out: string[] = []
  for (const d of attrs?.altTitles ?? []) {
    for (const v of Object.values(d)) if (v) out.push(String(v))
  }
  return out
}

function pickBest(cands: { m: any; s: number; alBonus: boolean }[]): { m: any; s: number; alBonus: boolean } | null {
  if (!cands.length) return null
  const ranked = [...cands].sort((a, b) => b.s - a.s)
  const best = ranked[0]
  if (!best || best.s < MDX_MATCH_THRESHOLD) return null
  const tied = ranked.filter(r => r.s === best.s && r.m.id !== best.m.id)
  if (tied.length) {
    // Exact tie: prefer the AniList-linked candidate (verified mapping beats
    // title text). Otherwise fail closed — never a random series.
    const alLinked = [best, ...tied].filter(r => r.alBonus)
    if (alLinked.length === 1) return alLinked[0]
    throw new Error('ambiguous match')
  }
  return best
}

/**
 * Match an AniList manga to MangaDex. Strategy:
 * 1. Direct: search MangaDex, prefer candidate whose links.al == anilistId
 *    (verified mapping, not title guessing).
 * 2. Fallback: best title score ≥ threshold (ties fail closed).
 */
export async function mdxSearchAndMatch(
  anilistId: number,
  hint: { title?: string; english?: string; native?: string } | undefined,
  signal?: AbortSignal,
): Promise<MdxMatch> {
  const variants = [hint?.english, hint?.title, hint?.native].filter(Boolean) as string[]
  if (!variants.length) throw new Error('no title hints for manga match')
  const seen = new Map<string, any>()
  for (const q of variants.slice(0, 3)) {
    try {
      const res = await mdxFetch(`/manga?title=${encodeURIComponent(q)}&limit=10&includes[]=cover_art`, signal)
      if (!res.ok) continue
      const j: any = await res.json()
      for (const m of j?.data ?? []) {
        if (m?.id && !seen.has(m.id)) seen.set(m.id, m)
      }
    } catch { /* next query */ }
  }
  if (!seen.size) throw new Error('no search results')
  const alId = String(anilistId)
  const scored = [...seen.values()].map(m => {
    const attrs = m.attributes ?? {}
    const alBonus = String(attrs?.links?.al ?? '') === alId
    // AniList-linked candidate: verified mapping — score floor 100.
    const s = alBonus ? 100 : Math.max(
      titleScore(mdxTitle(attrs), variants),
      ...altTitlesOf(attrs).map(a => titleScore(a, variants)),
    )
    return { m, s, alBonus }
  })
  const best = pickBest(scored)
  if (!best) throw new Error('no confident match')
  return { providerMangaId: best.m.id, providerTitle: mdxTitle(best.m.attributes), coverUrl: coverOf(best.m) }
}

function chapterLabel(attrs: any): { label: string; kind?: string; unitType: 'volume' | 'chapter' } {
  const rawNum: string | null = attrs?.chapter ?? null
  const vol: string | null = attrs?.volume ?? null
  const title: string = String(attrs?.title ?? '').trim()
  if (rawNum == null || rawNum === '') {
    // Oneshot / single-unit work: label by title or Oneshot.
    return { label: title ? `Oneshot: ${title.slice(0, 40)}` : 'Oneshot', kind: 'Oneshot', unitType: 'chapter' }
  }
  const label = `Chapter ${rawNum}${title ? `: ${title.slice(0, 40)}` : ''}`
  void vol
  return { label, kind: 'Chapter', unitType: 'chapter' }
}

/**
 * Aggregate chapter structure (ungated by content-rating/feed quirks).
 * Returns chapter UUIDs with their chapter numbers + volume, and resolves
 * each to its external URL (one batched lookup). Used ONLY when the EN feed
 * is empty, to distinguish licensed/external-only titles (surface external
 * links) from genuinely-no-content (honest empty state).
 */
async function mdxAggregate(
  providerMangaId: string,
  signal?: AbortSignal,
): Promise<{ count: number; external: MdxChapter[] } | null> {
  try {
    const res = await mdxFetch(`/manga/${providerMangaId}/aggregate?translatedLanguage[]=en`, signal)
    if (!res.ok) return null
    const j: any = await res.json()
    const vols = j?.volumes ?? {}
    const ids: { id: string; chapter: string; volume: string }[] = []
    for (const [vol, vv] of Object.entries<any>(vols)) {
      for (const [cn, cc] of Object.entries<any>((vv as any)?.chapters ?? {})) {
        if (cc?.id) ids.push({ id: String(cc.id), chapter: String(cn), volume: String(vol) })
      }
    }
    if (!ids.length) return { count: 0, external: [] }
    // Resolve external URLs in batches of 50 (chapter list endpoint).
    const external: MdxChapter[] = []
    for (let i = 0; i < ids.length; i += 50) {
      const batch = ids.slice(i, i + 50)
      const qs = batch.map(b => `ids[]=${b.id}`).join('&')
      try {
        const r = await mdxFetch(`/chapter?${qs}&limit=50&includes[]=scanlation_group`, signal)
        if (!r.ok) continue
        const jj: any = await r.json()
        const byId = new Map((jj?.data ?? []).map((c: any) => [c.id, c?.attributes ?? {}]))
        for (const b of batch) {
          const a = byId.get(b.id) as any
          if (!a) continue
          const num = b.chapter !== '' ? Number(b.chapter) : null
          external.push({
            providerChapterId: b.id,
            label: `Chapter ${b.chapter}`,
            number: typeof num === 'number' && Number.isFinite(num) ? num : null,
            kind: 'Chapter',
            unitType: 'chapter',
            volume: b.volume === 'none' ? null : b.volume,
            externalUrl: a.externalUrl ?? undefined,
            language: a.translatedLanguage ?? undefined,
            publishedAt: a.publishAt ?? undefined,
          })
        }
      } catch { /* next batch */ }
    }
    return { count: ids.length, external: external.filter(e => e.externalUrl) }
  } catch {
    return null
  }
}
/**
 * Full readable chapter list for a MangaDex manga UUID (EN, safe ratings).
 * Returns { readable, external }: readable units have hosted pages;
 * external units link off-site (licensed) and must NOT enter the reader.
 * Ordered oldest→newest by chapter number (server-side asc).
 */
export async function mdxGetChapters(
  providerMangaId: string,
  signal?: AbortSignal,
): Promise<{ readable: MdxChapter[]; external: MdxChapter[] }> {
  const params = (limit: number, offset: number) =>
    `/manga/${providerMangaId}/feed?limit=${limit}&offset=${offset}` +
    `&translatedLanguage[]=en` +
    `&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica` +
    `&order[chapter]=asc&includeEmptyPages=0`
  const first = await mdxFetch(params(500, 0), signal)
  if (!first.ok) throw new Error(`chapter list ${first.status}`)
  const fj: any = await first.json()
  const total: number = fj?.total ?? (fj?.data ?? []).length
  let rows: any[] = fj?.data ?? []
  // Paginate when the title has >500 EN chapters. Cap at 2000 rows: beyond
  // that the title is a pagination outlier, and unbounded fetching would
  // become a request storm (One Piece-scale feeds). The cap is internal —
  // the UI renders whatever arrived, oldest-first.
  const ROW_CAP = 2000
  for (let off = rows.length; off < total && rows.length < ROW_CAP; off += 500) {
    const r = await mdxFetch(params(500, off), signal)
    if (!r.ok) break
    const j: any = await r.json()
    rows = rows.concat(j?.data ?? [])
    if (!(j?.data ?? []).length) break
  }
  rows = rows.slice(0, ROW_CAP)
  if (!rows.length) {
    // Empty EN feed is ambiguous: licensed titles (all chapters external)
    // return total=0, but so does a transient/rate-limit response. Consult
    // /aggregate (ungated chapter structure) to distinguish: aggregate with
    // chapters + empty feed = licensed/external-only (surface external
    // links); aggregate empty too = genuinely no EN content.
    const agg = await mdxAggregate(providerMangaId, signal).catch(() => null)
    if (agg && agg.count > 0) {
      return { readable: [], external: agg.external }
    }
    throw new Error('no english chapters')
  }
  const readable: MdxChapter[] = []
  const external: MdxChapter[] = []
  for (const c of rows) {
    const a = c?.attributes ?? {}
    const num = a.chapter != null && a.chapter !== '' ? Number(a.chapter) : null
    const { label, kind, unitType } = chapterLabel(a)
    const unit: MdxChapter = {
      providerChapterId: String(c.id),
      label,
      number: typeof num === 'number' && Number.isFinite(num) ? num : null,
      kind,
      unitType,
      volume: a.volume ?? null,
      title: a.title ?? undefined,
      pages: typeof a.pages === 'number' ? a.pages : undefined,
      externalUrl: a.externalUrl ?? undefined,
      language: a.translatedLanguage ?? undefined,
      publishedAt: a.publishAt ?? a.createdAt ?? undefined,
    }
    // External with hosted pages (edge: mirrored oneshots) → readable.
    // External-only (licensed/off-site, pages=0) → link out, never reader.
    if (a.externalUrl && !(a.pages > 0)) { external.push(unit); continue }
    if (!(a.pages > 0)) { external.push(unit); continue }
    readable.push(unit)
  }
  if (!readable.length && !external.length) throw new Error('empty chapter list')
  return { readable, external }
}

/**
 * Page image URLs for a MangaDex chapter UUID. quality='saver' (default,
 * ~38% smaller) or 'data' (full). URLs are per-chapter (rotating host) —
 * resolved fresh, never cached across chapters.
 */
export async function mdxGetPages(
  providerChapterId: string,
  quality: 'saver' | 'data' = 'saver',
  signal?: AbortSignal,
): Promise<string[]> {
  const res = await mdxFetch(`/at-home/server/${providerChapterId}`, signal)
  if (!res.ok) throw new Error(`pages ${res.status}`)
  const j: any = await res.json()
  const base: string | undefined = j?.baseUrl
  const hash: string | undefined = j?.chapter?.hash
  const files: string[] = quality === 'data'
    ? (j?.chapter?.data ?? [])
    : (j?.chapter?.dataSaver?.length ? j.chapter.dataSaver : j?.chapter?.data ?? [])
  if (!base || !hash || !files.length) throw new Error('empty page list')
  return files.map(f => `${base}/${quality === 'data' ? 'data' : 'data-saver'}/${hash}/${f}`)
}

const mdxMatchCache = new Map<string, { at: number; m: MdxMatch }>()
const mdxChaptersCache = new Map<string, { at: number; v: { readable: MdxChapter[]; external: MdxChapter[] } }>()

export function mdxMatchCached(key: string): MdxMatch | null {
  const hit = mdxMatchCache.get(key)
  if (hit && Date.now() - hit.at < 60 * 60 * 1000) return hit.m
  return null
}

export function mdxMatchStore(key: string, m: MdxMatch) {
  mdxMatchCache.set(key, { at: Date.now(), m })
  if (mdxMatchCache.size > 500) {
    const oldest = mdxMatchCache.keys().next().value as string | undefined
    if (oldest !== undefined) mdxMatchCache.delete(oldest)
  }
}

export async function mdxChaptersCached(key: string): Promise<{ readable: MdxChapter[]; external: MdxChapter[] } | null> {
  const hit = mdxChaptersCache.get(key)
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.v
  return null
}

export function mdxChaptersStore(key: string, v: { readable: MdxChapter[]; external: MdxChapter[] }) {
  mdxChaptersCache.set(key, { at: Date.now(), v })
  if (mdxChaptersCache.size > 200) {
    const oldest = mdxChaptersCache.keys().next().value as string | undefined
    if (oldest !== undefined) mdxChaptersCache.delete(oldest)
  }
}
