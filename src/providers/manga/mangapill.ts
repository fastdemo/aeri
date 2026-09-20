import type { Anime } from '../../types/anime'
import type { MangaChapter, MangaPage, MangaProvider, MangaProviderMatch, MangaSourceOptions } from './types'
import { getEffectiveVideoApiUrl } from '../../storage/preferences'

function getWorkerBase(): string | null {
  try { return getEffectiveVideoApiUrl()?.replace(/\/$/, '') || null } catch { return null }
}

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
 * MangaPill manga provider. Server-rendered HTML (no JS, no auth, no
 * CAPTCHA): GET /search?q= → /manga/<id>/<slug> → /chapters/<mid>-<pid>/…
 * Page images are CDN JPEGs via the signed `/api/manga/img` relay (the CDN
 * requires a mangapill.com Referer — the relay sends the per-host referer).
 *
 * Identity: numeric manga id is stable; chapter key = <mangaId>-<pageId>.
 * Labels are the provider's own ("Chapter N[.M]") preserved verbatim.
 */
class MangaPillProvider implements MangaProvider {
  id = 'mangapill'
  name = 'MangaPill'
  kind = 'manga' as const
  // Verified 2026-09-20: 405 units + 24 relayed pages (Berserk), SxF/HxH/
  // Uzumaki matches + rendered JPEG bytes. Third fallback after MangaDex
  // (quality scans) and WeebCentral (licensed coverage).
  status = 'verified' as const
  enabledByDefault = false
  blurb = 'Large library fallback, server-rendered, signed relay'

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
    const key = `manga:mangapill:match:v2:${anilistId}`
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
      const j = await workerJson(`/api/manga/mp-match/${anilistId}${this.hintsOf(manga, options)}`, options?.signal)
      if (!j?.providerMangaId) return null
      const m: MangaProviderMatch = { providerId: 'mangapill', providerMangaId: j.providerMangaId, title: j.providerTitle ?? undefined, verified: (j as any).verified === true, expectedChapters: options?.mangaChapters ?? manga.chapters ?? undefined }
      memSet(key, m)
      return m
    } catch { return null }
  }

  async getChapters(manga: Anime, options?: MangaSourceOptions): Promise<MangaChapter[]> {
    const m = await this.resolveManga(manga, options)
    if (!m) return []
    const key = `manga:mangapill:chapters:${m.providerMangaId}`
    const hit = memGet<MangaChapter[]>(key, 10 * 60 * 1000)
    if (hit) return hit
    try {
      const j = await workerJson(`/api/manga/mp-chapters/${m.providerMangaId}`, options?.signal)
      const list = Array.isArray(j?.chapters) ? j.chapters : []
      const out: MangaChapter[] = list.map((c: any) => ({
        id: `mangapill-${String(c.providerChapterId).replace(/[^A-Za-z0-9-]/g, '_')}`,
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
    const key = `manga:mangapill:pages:${chapter.providerChapterId.replace(/[^A-Za-z0-9-]/g, '_')}`
    const hit = memGet<MangaPage[]>(key, 10 * 60 * 1000)
    if (hit) return hit
    try {
      // providerChapterId = <mangaId>-<pageId> → /mp-pages/<mangaId>/<pageId>
      const [mid, pid] = chapter.providerChapterId.split('-')
      const j = await workerJson(`/api/manga/mp-pages/${mid}/${pid}`, options?.signal)
      const list = Array.isArray(j?.pages) ? j.pages : []
      const out: MangaPage[] = list.map((u: any, i: number) => ({ index: i, url: String(typeof u === 'string' ? u : u.url) }))
      memSet(key, out)
      return out
    } catch { return [] }
  }
}

export const mangaPillProvider = new MangaPillProvider()
