import type { Anime } from '../../types/anime'
import type { MangaChapter, MangaPage, MangaProvider, MangaProviderMatch, MangaSourceOptions } from './types'
import { getEffectiveVideoApiUrl, getPreferences } from '../../storage/preferences'

function getWorkerBase(): string | null {
  // Same-origin /api on Cloudflare (or custom URL in Settings, or baked
  // VITE_VIDEO_API_URL). Localhost preview has no Worker — callers must
  // handle null (provider returns [] → honest empty state, not a crash).
  try { return getEffectiveVideoApiUrl()?.replace(/\/$/, '') || null } catch { return null }
}

// In-memory cache, namespaced so manga entries can never collide with anime.
const mem = new Map<string, { at: number; data: any }>()

function memGet<T>(key: string, ttlMs: number): T | null {
  const hit = mem.get(key)
  if (!hit || Date.now() - hit.at > ttlMs) {
    if (hit) mem.delete(key)
    return null
  }
  return hit.data as T
}

function memSet(key: string, data: any) {
  mem.set(key, { at: Date.now(), data })
  if (mem.size > 200) {
    const oldest = mem.keys().next().value as string | undefined
    if (oldest !== undefined) mem.delete(oldest)
  }
}

async function workerJson(path: string, signal?: AbortSignal): Promise<any> {
  // Localhost preview has no Worker: fall back to the production Worker so
  // the manga flow is testable locally (same pattern as video providers via
  // customVideoApiUrl). Production uses same-origin.
  let base = getWorkerBase()
  if (!base && typeof window !== 'undefined') {
    const host = window.location.hostname
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
      base = 'https://aeri.fastdemo.workers.dev'
    }
  }
  if (!base) throw new Error('no worker')
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 20000)
  const onAbort = () => ctrl.abort()
  if (signal) {
    if (signal.aborted) { clearTimeout(t); throw signal.reason ?? new DOMException('Aborted', 'AbortError') }
    signal.addEventListener('abort', onAbort, { once: true })
  }
  try {
    const res = await fetch(`${base}${path}`, { signal: ctrl.signal })
    if (!res.ok) {
      let msg = `worker ${res.status}`
      try {
        const j = await res.json()
        if (j?.error) msg = String(j.error)
      } catch {}
      const err = new Error(msg) as any
      err.status = res.status
      throw err
    }
    return await res.json()
  } finally {
    clearTimeout(t)
    signal?.removeEventListener?.('abort', onAbort)
  }
}

/**
 * MangaDex manga provider. All MangaDex access runs through the Worker
 * (`/api/manga/mdx-*`), never browser-direct: the API needs no key but the
 * Worker centralizes rate-limiting (≤4 req/s), caching, and fail-closed
 * matching via attributes.links.al (AniList id).
 *
 * Units are opaque provider units with the provider's own label preserved
 * ("Chapter 386", "Oneshot: ..."). External (off-site licensed) chapters
 * never enter the reader — surfaced separately as external links.
 */
class MangaDexProvider implements MangaProvider {
  id = 'mangadex'
  name = 'MangaDex'
  kind = 'manga' as const
  // Verified 2026-09-20: 425 readable units + 94 at-home pages (Berserk),
  // external-link surfacing for licensed titles (Solo Leveling 16).
  status = 'verified' as const
  enabledByDefault = true
  blurb = 'Primary — high-quality scanlations, direct CDN'

  private hintsOf(manga: Anime, options?: MangaSourceOptions) {
    const p = new URLSearchParams()
    const t = options?.mangaTitle ?? manga.title.romaji
    if (t) p.set('title', t)
    const e = options?.mangaEnglish ?? manga.title.english
    if (e) p.set('english', e)
    const n = options?.mangaNative ?? manga.title.native
    if (n) p.set('native', n)
    const c = options?.mangaChapters ?? manga.chapters
    if (typeof c === 'number') p.set('chapters', String(c))
    const v = options?.mangaVolumes ?? manga.volumes
    if (typeof v === 'number') p.set('volumes', String(v))
    const q = p.toString()
    return q ? `?${q}` : ''
  }

  async resolveManga(manga: Anime, options?: MangaSourceOptions): Promise<MangaProviderMatch | null> {
    const anilistId = manga.identity.anilistId
    if (!anilistId) return null
    const key = `manga:mangadex:match:v2:${anilistId}`
    const hit = memGet<MangaProviderMatch>(key, 60 * 60 * 1000)
    // Trust boundary: a cached match is reusable ONLY if it was verified
    // AND the current query carries the same chapter-count expectation.
    // A stale entry from a title-only query (no chapters hint, no verified
    // flag semantics for THIS manga's length) must be re-resolved — never
    // serve another manga's series from cache.
    if (hit && (hit as any).verified) {
      const curCh = options?.mangaChapters ?? manga.chapters
      const hitCh = (hit as any).expectedChapters
      if (typeof curCh === 'number' && typeof hitCh === 'number' && curCh !== hitCh) {
        // Different manga — do not reuse.
      } else return hit
    }
    try {
      const j = await workerJson(`/api/manga/mdx-match/${anilistId}${this.hintsOf(manga, options)}`, options?.signal)
      if (!j?.providerMangaId) return null
      const m: MangaProviderMatch = { providerId: 'mangadex', providerMangaId: j.providerMangaId, title: j.providerTitle ?? undefined, verified: (j as any).verified === true, expectedChapters: options?.mangaChapters ?? manga.chapters ?? undefined }
      memSet(key, m)
      return m
    } catch { return null }
  }

  async getChapters(manga: Anime, options?: MangaSourceOptions): Promise<MangaChapter[]> {
    const m = await this.resolveManga(manga, options)
    if (!m) return []
    const key = `manga:mangadex:chapters:${m.providerMangaId}`
    const hit = memGet<MangaChapter[]>(key, 10 * 60 * 1000)
    if (hit) return hit
    try {
      const j = await workerJson(`/api/manga/mdx-chapters/${m.providerMangaId}`, options?.signal)
      const list = Array.isArray(j?.chapters) ? j.chapters : []
      const out: MangaChapter[] = list.map((c: any) => ({
        id: `mangadex-${String(c.providerChapterId)}`,
        mangaId: manga.identity.internalId,
        providerChapterId: String(c.providerChapterId),
        label: String(c.label ?? 'Chapter'),
        number: typeof c.number === 'number' ? c.number : null,
        kind: c.kind,
        unitType: c.unitType === 'volume' ? 'volume' : 'chapter',
        publishedAt: c.publishedAt,
      }))
      memSet(key, out)
      return out
    } catch { return [] }
  }

  async getChapterPages(chapter: MangaChapter, options?: MangaSourceOptions): Promise<MangaPage[]> {
    const key = `manga:mangadex:pages:${chapter.providerChapterId}`
    const hit = memGet<MangaPage[]>(key, 10 * 60 * 1000)
    if (hit) return hit
    try {
      const j = await workerJson(`/api/manga/mdx-pages/${chapter.providerChapterId}`, options?.signal)
      const list = Array.isArray(j?.pages) ? j.pages : []
      const out: MangaPage[] = list.map((u: any, i: number) => ({ index: i, url: String(typeof u === 'string' ? u : u.url) }))
      memSet(key, out)
      return out
    } catch { return [] }
  }

  /**
   * External (off-site licensed) units for a manga — never reader content.
   * Match succeeds even when all chapters are external (the series itself
   * matched fine), so re-resolve is cheap (cached) and one chapters call
   * serves the external list.
   */
  async getExternalUnits(manga: Anime, options?: MangaSourceOptions): Promise<{ label: string; url: string }[]> {
    const m = await this.resolveManga(manga, options)
    if (!m) return []
    try {
      const j = await workerJson(`/api/manga/mdx-chapters/${m.providerMangaId}`, options?.signal)
      const ext = Array.isArray(j?.external) ? j.external : []
      return ext
        .filter((c: any) => c?.externalUrl)
        .map((c: any) => ({ label: String(c.label ?? 'Chapter'), url: String(c.externalUrl) }))
    } catch { return [] }
  }
}

import { weebCentralProvider } from './weebcentral'
import { mangaPillProvider } from './mangapill'
import { mangaHereProvider, bato1Provider, kakalotFunProvider, mangaReadProvider } from './mirrors'

export const mangaDexProvider = new MangaDexProvider()

// FINAL MANGA PRIORITY (verified reliability first — 2026-09-27 live pass):
// 1. MangaDex (Tier 1: official API, primary)
// 2. WeebCentral (Tier 1: /images fragment, PNGs)
// 3. MangaPill (Tier 1: server-rendered, JPEGs)
// 4. MangaHere (Tier 2: packed-JS decode, JPEGs)
// 5. Bato1 (Tier 2: working bato1.com mirror, WEBPs)
// 6. MangaKakalot.fun (Tier 2: working .fun mirror, PNGs)
// 7. MangaRead (Tier 2: MangaBuddy replacement, JPEGs)
// Dead/broken (canonical mangabuddy/mangakakalot/bato.to, mangapark,
// comick pages) are NOT in this array — zero requests, zero timeout spent.
export const mangaProviders: MangaProvider[] = [mangaDexProvider, weebCentralProvider, mangaPillProvider, mangaHereProvider, bato1Provider, kakalotFunProvider, mangaReadProvider]

/**
 * Registry of ALL manga provider instances (verified or not). Settings
 * derives its Manga section from this via verifiedMangaProviders() —
 * never a hardcoded list. Resolution priority follows the user's
 * Settings → Providers order (`mangaProviderOrder` pref) when set,
 * else the default priority: MangaDex → WeebCentral → MangaPill →
 * MangaHere → Bato1 → MangaKakalot.fun → MangaRead.
 */
export function allMangaProviders(): MangaProvider[] {
  return [...mangaProviders]
}

/** Default resolution priority (verified reliability first — 2026-09-27). */
export const DEFAULT_MANGA_ORDER = ['mangadex', 'weebcentral', 'mangapill', 'mangahere', 'bato1', 'kakalot', 'mangaread']

/** Effective resolution order: user order first (valid ids only), then the rest in default priority. */
export function orderedMangaProviders(): MangaProvider[] {
  const byId = new Map(allMangaProviders().map(p => [p.id, p]))
  const out: MangaProvider[] = []
  try {
    const pref = getPreferences().mangaProviderOrder
    if (Array.isArray(pref)) {
      for (const id of pref) {
        const p = byId.get(id)
        if (p && !out.includes(p)) { out.push(p); byId.delete(id) }
      }
    }
  } catch {}
  for (const id of DEFAULT_MANGA_ORDER) {
    const p = byId.get(id)
    if (p) { out.push(p); byId.delete(id) }
  }
  for (const p of byId.values()) out.push(p)
  return out
}

/** Only verified providers — the sole source for the Settings UI list. */
export function verifiedMangaProviders(): MangaProvider[] {
  return allMangaProviders().filter(p => p.status === 'verified')
}

function mangaEnabled(id: string): boolean {
  try {
    const v = getPreferences().enabledMangaProviders?.[id]
    // Default: provider's own enabledByDefault (both ship true).
    if (v !== undefined) return v !== false
    return allMangaProviders().find(p => p.id === id)?.enabledByDefault !== false
  } catch { return true }
}

export function getMangaProviderById(id: string): MangaProvider | undefined {
  return allMangaProviders().find(p => p.id === id)
}

export interface ChapterResolveResult {
  chapters: MangaChapter[]
  providerId: string | null
  error?: string
  /**
   * Per-provider attempt ledger (verified+enabled providers only, in the
   * order attempted; STOPS at the first provider that returned units —
   * single-source rule, no later requests). Lets callers distinguish
   * "all providers failed" from "a provider matched but hosts nothing"
   * and surface honest per-provider states. Never includes disabled
   * providers.
   */
  attempts?: { providerId: string; units: number; error?: string }[]
}

export async function resolveChaptersWithFallback(manga: Anime, signal?: AbortSignal, options?: MangaSourceOptions): Promise<ChapterResolveResult> {
  if (signal?.aborted) return { chapters: [], providerId: null }
  // FAIL CLOSED on media type: a manga route must never resolve through an
  // anime record (HxH collision). The caller passes Manga surfaces; if the
  // record's own format says otherwise, reject before any provider request.
  const fmt = (manga.format ?? '').toUpperCase()
  const looksManga = fmt === '' || fmt === 'MANGA' || fmt === 'NOVEL' || fmt === 'ONE_SHOT'
  if (!looksManga) {
    return { chapters: [], providerId: null, error: 'Not a manga entry.' }
  }
  const opts = { ...options, signal }
  let lastError: string | undefined
  // Single-source rule (OWNER 2026-10-18): ONE source per manga — the
  // highest-priority ENABLED provider wins outright. The next enabled
  // provider is attempted only when the first hosts NOTHING (no match,
  // zero units, or a request error). No cross-provider merging: every row
  // in the list belongs to the winner, so the provenance is one source the
  // user can reason about. Disabled providers are never requested — zero
  // requests, no fallback through them.
  const enabled = orderedMangaProviders().filter(p => p.status === 'verified' && mangaEnabled(p.id))
  const attempts: { providerId: string; units: number; error?: string }[] = []
  for (const p of enabled) {
    try {
      const chapters = await p.getChapters(manga, opts)
      attempts.push({ providerId: p.id, units: chapters.length })
      if (chapters.length) {
        // First enabled provider holding units ends resolution — later
        // providers stay untouched (this is a feature: resolution cost is
        // the winner's cost alone).
        return { chapters, providerId: p.id, attempts }
      }
      lastError = `no readable units via ${p.id}`
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      attempts.push({ providerId: p.id, units: 0, error: msg })
      lastError = msg
    }
    if (signal?.aborted) break
  }
  return { chapters: [], providerId: null, error: enabled.length ? lastError : 'No Manga providers are enabled.', attempts }
}
