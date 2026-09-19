import type { Anime } from '../../types/anime'
import type { MangaChapter, MangaPage, MangaProvider, MangaProviderMatch, MangaSourceOptions } from './types'
import { getEffectiveVideoApiUrl } from '../../storage/preferences'

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
  const t = setTimeout(() => ctrl.abort(), 15000)
  const onAbort = () => ctrl.abort()
  if (signal) {
    if (signal.aborted) { clearTimeout(t); throw signal.reason ?? new DOMException('Aborted', 'AbortError') }
    signal.addEventListener('abort', onAbort, { once: true })
  }
  try {
    const res = await fetch(`${base}${path}`, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`worker ${res.status}`)
    return await res.json()
  } finally {
    clearTimeout(t)
    signal?.removeEventListener?.('abort', onAbort)
  }
}

/**
 * WeebCentral manga provider. All WeebCentral access runs through the Worker
 * (`/api/manga/*`), never browser-direct: the site is an htmx app whose HTML
 * the Worker parses into structured chapter/page data.
 */
class WeebCentralProvider implements MangaProvider {
  id = 'weebcentral'
  name = 'Weeb Central'

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
    const y = options?.mangaYear ?? manga.year
    if (typeof y === 'number') p.set('year', String(y))
    const q = p.toString()
    return q ? `?${q}` : ''
  }

  async resolveManga(manga: Anime, options?: MangaSourceOptions): Promise<MangaProviderMatch | null> {
    const anilistId = manga.identity.anilistId
    if (!anilistId) return null
    const key = `manga:weebcentral:match:${anilistId}`
    const hit = memGet<MangaProviderMatch>(key, 10 * 60 * 1000)
    if (hit) return hit
    try {
      const j = await workerJson(`/api/manga/match/${anilistId}${this.hintsOf(manga, options)}`, options?.signal)
      if (!j?.providerMangaId) return null
      const m: MangaProviderMatch = { providerId: 'weebcentral', providerMangaId: j.providerMangaId, title: j.providerTitle ?? undefined }
      memSet(key, m)
      return m
    } catch { return null }
  }

  async getChapters(manga: Anime, options?: MangaSourceOptions): Promise<MangaChapter[]> {
    const m = await this.resolveManga(manga, options)
    if (!m) return []
    const key = `manga:weebcentral:chapters:${m.providerMangaId}`
    const hit = memGet<MangaChapter[]>(key, 5 * 60 * 1000)
    if (hit) return hit
    try {
      const j = await workerJson(`/api/manga/chapters/${m.providerMangaId}`, options?.signal)
      const list = Array.isArray(j?.chapters) ? j.chapters : []
      const out: MangaChapter[] = list.map((c: any) => ({
        id: `weebcentral-${String(c.providerChapterId ?? c.id)}`,
        mangaId: manga.identity.internalId,
        providerChapterId: String(c.providerChapterId ?? c.id),
        label: String(c.label ?? c.title ?? 'Chapter'),
        number: typeof c.number === 'number' ? c.number : null,
        kind: c.kind,
        publishedAt: c.publishedAt,
      }))
      memSet(key, out)
      return out
    } catch { return [] }
  }

  async getChapterPages(chapter: MangaChapter, options?: MangaSourceOptions): Promise<MangaPage[]> {
    const key = `manga:weebcentral:pages:${chapter.providerChapterId}`
    const hit = memGet<MangaPage[]>(key, 5 * 60 * 1000)
    if (hit) return hit
    try {
      const j = await workerJson(`/api/manga/pages/${chapter.providerChapterId}`, options?.signal)
      const list = Array.isArray(j?.pages) ? j.pages : []
      const out: MangaPage[] = list.map((u: any, i: number) => ({ index: i, url: String(typeof u === 'string' ? u : u.url) }))
      memSet(key, out)
      return out
    } catch { return [] }
  }
}

export const weebCentralProvider = new WeebCentralProvider()

export const mangaProviders: MangaProvider[] = [weebCentralProvider]

export async function resolveChaptersWithFallback(manga: Anime, signal?: AbortSignal, options?: MangaSourceOptions): Promise<{ chapters: MangaChapter[]; providerId: string | null }> {
  if (signal?.aborted) return { chapters: [], providerId: null }
  const opts = { ...options, signal }
  for (const p of mangaProviders) {
    try {
      const chapters = await p.getChapters(manga, opts)
      if (chapters.length) return { chapters, providerId: p.id }
    } catch { /* next provider */ }
    if (signal?.aborted) break
  }
  return { chapters: [], providerId: null }
}
