import type { Anime } from '../../types/anime'
import { getCache, putCache } from '../../storage/db'

/**
 * Kitsu is a NARROW fallback for episode names and thumbnails ONLY.
 *
 * AniList always owns episode metadata. Kitsu is
 * consulted only when the AniList record has absolutely no usable episode
 * title or thumbnail for the whole entry (for example Monster, Berserk
 * 1997, Evangelion TV). It never supplies identity, totals, tracking,
 * status, scores, descriptions, artwork, or anything else. When Kitsu has
 * nothing either, the UI keeps its own placeholder (the show's artwork +
 * "Episode N").
 *
 * Mapping is conservative and id-based:
 *   1. Kitsu's `anilist/anime` mapping for `identity.anilistId` (preferred)
 *   2. Kitsu's `myanimelist/anime` mapping for `identity.malId`
 *   3. otherwise unavailable — never a title search, so a sequel can never
 *      borrow another season's episode list.
 *
 * The Kitsu API is CORS-open (`access-control-allow-origin: *`, verified
 * 2026-10-23). Requests are capped (20 rows/page, 500 episodes) and cached
 * in memory + IndexedDB; a negative result is cached for 24h, a positive
 * one for 7 days.
 */

const KITSU_API = 'https://kitsu.io/api/edge'
const PAGE_SIZE = 20 // Kitsu rejects page[limit] > 20 with HTTP 400
const MAX_EPISODES = 500
const REQUEST_TIMEOUT_MS = 10_000
const MEM_TTL = 1000 * 60 * 30
const MEM_MAX = 120
const CACHE_TTL_OK = 1000 * 60 * 60 * 24 * 7
const CACHE_TTL_EMPTY = 1000 * 60 * 60 * 24

export interface KitsuEpisodeMetadata {
  number: number
  title?: string
  thumbnail?: string
}

export type KitsuEpisodeResult =
  | { status: 'ok'; episodes: KitsuEpisodeMetadata[]; resolvedBy: 'anilist' | 'mal' }
  | { status: 'unavailable'; episodes: []; resolvedBy: null }
  | { status: 'error'; episodes: []; resolvedBy: null }

interface CacheEntry {
  result: Exclude<KitsuEpisodeResult, { status: 'error' }>
}
interface MemoryEntry extends CacheEntry {
  expiry: number
}

const memory = new Map<string, MemoryEntry>()
const inflight = new Map<string, Promise<KitsuEpisodeResult>>()

function identityKey(anime: Anime): string | null {
  const anilistId = anime.identity.anilistId
  if (typeof anilistId === 'number' && Number.isFinite(anilistId) && anilistId > 0) {
    return `kitsu:episodes:v1:anilist:${anilistId}`
  }
  const malId = anime.identity.malId
  if (typeof malId === 'number' && Number.isFinite(malId) && malId > 0) {
    return `kitsu:episodes:v1:mal:${malId}`
  }
  return null
}

function isMangaKind(anime: Anime): boolean {
  const format = (anime.format ?? '').toUpperCase()
  return format === 'MANGA' || format === 'NOVEL' || format === 'ONE_SHOT'
}

function unavailable(): KitsuEpisodeResult {
  return { status: 'unavailable', episodes: [], resolvedBy: null }
}

function remember(key: string, entry: CacheEntry, ttlMs: number): void {
  memory.set(key, { ...entry, expiry: Date.now() + ttlMs })
  if (memory.size > MEM_MAX) {
    const oldest = memory.keys().next().value as string | undefined
    if (oldest !== undefined) memory.delete(oldest)
  }
  void putCache(key, entry, ttlMs)
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) {
    return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

interface KitsuPage {
  rows: KitsuEpisodeMetadata[]
  count: number | null
  /** Raw JSON:API rows in this page (before number/title filtering). */
  rawCount: number
}

function asPositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

function episodeTitle(attributes: any): string | undefined {
  const candidates = [
    attributes?.canonicalTitle,
    attributes?.titles?.en,
    attributes?.titles?.en_jp,
    attributes?.titles?.ja_jp,
  ]
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function episodeThumbnail(attributes: any): string | undefined {
  const thumb = attributes?.thumbnail
  if (typeof thumb === 'string' && thumb.trim()) return thumb.trim()
  if (thumb && typeof thumb === 'object') {
    for (const key of ['original', 'large', 'medium'] as const) {
      const value = (thumb as Record<string, unknown>)[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
    }
  }
  return undefined
}

function parsePage(json: any): KitsuPage {
  const rows: KitsuEpisodeMetadata[] = []
  const data = Array.isArray(json?.data) ? json.data : []
  for (const item of data) {
    const attributes = item?.attributes ?? {}
    const number = asPositiveNumber(attributes.number) ?? asPositiveNumber(attributes.relativeNumber)
    if (number === null) continue
    const title = episodeTitle(attributes)
    const thumbnail = episodeThumbnail(attributes)
    if (!title && !thumbnail) continue
    rows.push({ number, ...(title ? { title } : {}), ...(thumbnail ? { thumbnail } : {}) })
  }
  const countRaw = json?.meta?.count
  const count = typeof countRaw === 'number' && Number.isFinite(countRaw) && countRaw >= 0 ? countRaw : null
  return { rows, count, rawCount: data.length }
}

async function kitsuJson(path: string): Promise<any> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(`${KITSU_API}${path}`, {
      headers: { Accept: 'application/vnd.api+json' },
      signal: controller.signal,
    })
    if (!res.ok) {
      const error = new Error(`Kitsu HTTP ${res.status}`) as Error & { status?: number }
      error.status = res.status
      throw error
    }
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

async function findKitsuAnimeId(
  externalSite: 'anilist/anime' | 'myanimelist/anime',
  externalId: number,
): Promise<string | null> {
  const params = new URLSearchParams({
    'filter[externalSite]': externalSite,
    'filter[externalId]': String(externalId),
    include: 'item',
  })
  const json = await kitsuJson(`/mappings?${params.toString()}`)
  const mappings = Array.isArray(json?.data) ? json.data : []
  for (const mapping of mappings) {
    const item = mapping?.relationships?.item?.data
    if (item?.type === 'anime' && (typeof item.id === 'string' || typeof item.id === 'number')) {
      return String(item.id)
    }
  }
  return null
}

async function resolveKitsuAnimeId(anime: Anime): Promise<{ id: string; via: 'anilist' | 'mal' } | null> {
  const anilistId = anime.identity.anilistId
  if (typeof anilistId === 'number' && Number.isFinite(anilistId) && anilistId > 0) {
    const id = await findKitsuAnimeId('anilist/anime', anilistId)
    if (id) return { id, via: 'anilist' }
  }
  const malId = anime.identity.malId
  if (typeof malId === 'number' && Number.isFinite(malId) && malId > 0) {
    const id = await findKitsuAnimeId('myanimelist/anime', malId)
    if (id) return { id, via: 'mal' }
  }
  return null
}

async function fetchEpisodesPage(kitsuId: string, offset: number): Promise<KitsuPage> {
  const params = new URLSearchParams({
    'page[limit]': String(PAGE_SIZE),
    'page[offset]': String(offset),
  })
  const json = await kitsuJson(`/anime/${encodeURIComponent(kitsuId)}/episodes?${params.toString()}`)
  return parsePage(json)
}

async function fetchKitsuEpisodesNetwork(anime: Anime): Promise<KitsuEpisodeResult> {
  const mapped = await resolveKitsuAnimeId(anime)
  if (!mapped) return unavailable()

  const byNumber = new Map<number, KitsuEpisodeMetadata>()
  let offset = 0
  let total: number | null = null

  while (offset < MAX_EPISODES) {
    const page = await fetchEpisodesPage(mapped.id, offset)
    if (page.count !== null && total === null) total = page.count
    for (const row of page.rows) {
      if (row.number > MAX_EPISODES) continue
      const existing = byNumber.get(row.number)
      if (!existing) {
        byNumber.set(row.number, row)
      } else {
        // A later duplicate may carry the missing field; never overwrite.
        if (!existing.title && row.title) existing.title = row.title
        if (!existing.thumbnail && row.thumbnail) existing.thumbnail = row.thumbnail
      }
    }
    offset += PAGE_SIZE
    if (page.rawCount < PAGE_SIZE) break
    if (total !== null && offset >= Math.min(total, MAX_EPISODES)) break
  }

  if (byNumber.size === 0) return unavailable()
  const episodes = [...byNumber.values()].sort((a, b) => a.number - b.number)
  return { status: 'ok', episodes, resolvedBy: mapped.via }
}

/**
 * Resolve Kitsu episode names/thumbnails for an anime. Returns a cached
 * result when possible; never throws for ordinary upstream absence.
 *
 * `error` is reserved for network/HTTP failures. A request that was
 * aborted by the caller rejects with an AbortError instead.
 */
export async function getKitsuEpisodes(anime: Anime, signal?: AbortSignal): Promise<KitsuEpisodeResult> {
  if (isMangaKind(anime)) return unavailable()
  const key = identityKey(anime)
  if (!key) return unavailable()

  const mem = memory.get(key)
  if (mem && mem.expiry > Date.now()) return mem.result

  try {
    const cached = await getCache<CacheEntry>(key)
    if (cached?.result) {
      memory.set(key, { ...cached, expiry: Date.now() + MEM_TTL })
      return cached.result
    }
  } catch {
    // IndexedDB unavailable — fall through to the network.
  }

  let shared = inflight.get(key)
  if (!shared) {
    shared = fetchKitsuEpisodesNetwork(anime)
      .then((result) => {
        if (result.status !== 'error') {
          remember(key, { result }, result.status === 'ok' ? CACHE_TTL_OK : CACHE_TTL_EMPTY)
        }
        return result
      })
      .catch((error) => {
        if (error?.name === 'AbortError') throw error
        return { status: 'error', episodes: [], resolvedBy: null } as KitsuEpisodeResult
      })
      .finally(() => {
        inflight.delete(key)
      })
    inflight.set(key, shared)
  }

  return abortable(shared, signal)
}
