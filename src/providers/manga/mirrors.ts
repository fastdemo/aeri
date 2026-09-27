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

function hintsOf(manga: Anime, options?: MangaSourceOptions): string {
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

function toUnits(providerId: string, manga: Anime, list: any[]): MangaChapter[] {
  return list.map((c: any) => ({
    id: `${providerId}-${String(c.providerChapterId).replace(/[^A-Za-z0-9-:]/g, '_')}`,
    mangaId: manga.identity.internalId,
    providerChapterId: String(c.providerChapterId),
    label: String(c.label ?? 'Chapter'),
    number: typeof c.number === 'number' ? c.number : null,
    kind: c.kind,
    unitType: c.unitType === 'volume' ? 'volume' : 'chapter',
    publishedAt: c.publishedAt,
  }))
}

function makeMirrorProvider(cfg: {
  id: string
  name: string
  blurb: string
  matchPath: (anilistId: number, hints: string) => string
  chaptersPath: (providerMangaId: string) => string
  pagesPath: (providerChapterId: string) => string
  splitPagesId?: (providerChapterId: string) => [string, string] | null
}): MangaProvider {
  return {
    id: cfg.id,
    name: cfg.name,
    kind: 'manga' as const,
    // Verified 2026-09-27 via live probes (search→chapters→pages→200 bytes).
    status: 'verified' as const,
    enabledByDefault: true,
    blurb: cfg.blurb,
    async resolveManga(manga: Anime, options?: MangaSourceOptions): Promise<MangaProviderMatch | null> {
      const anilistId = manga.identity.anilistId
      if (!anilistId) return null
      const key = `manga:${cfg.id}:match:v2:${anilistId}`
      const hit = memGet<MangaProviderMatch>(key, 60 * 60 * 1000)
      if (hit && (hit as any).verified) {
        const curCh = options?.mangaChapters ?? manga.chapters
        const hitCh = (hit as any).expectedChapters
        if (typeof curCh === 'number' && typeof hitCh === 'number' && curCh !== hitCh) {
          // Different manga — do not reuse.
        } else return hit
      }
      try {
        const j = await workerJson(cfg.matchPath(anilistId, hintsOf(manga, options)), options?.signal)
        if (!j?.providerMangaId) return null
        const m: MangaProviderMatch = { providerId: cfg.id, providerMangaId: j.providerMangaId, title: j.providerTitle ?? undefined, verified: (j as any).verified === true, expectedChapters: options?.mangaChapters ?? manga.chapters ?? undefined }
        memSet(key, m)
        return m
      } catch { return null }
    },
    async getChapters(manga: Anime, options?: MangaSourceOptions): Promise<MangaChapter[]> {
      const m = await (this as MangaProvider).resolveManga!(manga, options)
      if (!m) return []
      const key = `manga:${cfg.id}:chapters:${m.providerMangaId}`
      const hit = memGet<MangaChapter[]>(key, 10 * 60 * 1000)
      if (hit) return hit
      try {
        const j = await workerJson(cfg.chaptersPath(m.providerMangaId), options?.signal)
        const list = Array.isArray(j?.chapters) ? j.chapters : []
        const out = toUnits(cfg.id, manga, list)
        memSet(key, out)
        return out
      } catch { return [] }
    },
    async getChapterPages(chapter: MangaChapter, options?: MangaSourceOptions): Promise<MangaPage[]> {
      const key = `manga:${cfg.id}:pages:${chapter.providerChapterId.replace(/[^A-Za-z0-9-:]/g, '_')}`
      const hit = memGet<MangaPage[]>(key, 10 * 60 * 1000)
      if (hit) return hit
      try {
        const j = await workerJson(cfg.pagesPath(chapter.providerChapterId), options?.signal)
        const list = Array.isArray(j?.pages) ? j.pages : []
        const out: MangaPage[] = list.map((u: any, i: number) => ({ index: i, url: String(typeof u === 'string' ? u : u.url) }))
        memSet(key, out)
        return out
      } catch { return [] }
    },
  }
}

export const mangaHereProvider = makeMirrorProvider({
  id: 'mangahere',
  name: 'MangaHere',
  blurb: 'Large catalog, packed-page decoding, signed relay',
  matchPath: (anilistId, hints) => `/api/manga/mh-match/${anilistId}${hints}`,
  chaptersPath: (mid) => `/api/manga/mh-chapters/${encodeURIComponent(mid)}`,
  pagesPath: (pcid) => {
    const [slug, cid] = pcid.split('::')
    return `/api/manga/mh-pages/${encodeURIComponent(slug)}/${encodeURIComponent(cid)}`
  },
})

export const bato1Provider = makeMirrorProvider({
  id: 'bato1',
  name: 'Bato1',
  blurb: 'Working Bato mirror (bato1.com), WEBP pages',
  matchPath: (anilistId, hints) => `/api/manga/bt-match/${anilistId}${hints}`,
  chaptersPath: (mid) => `/api/manga/bt-chapters/${encodeURIComponent(mid)}`,
  pagesPath: (pcid) => {
    const [slug, num] = pcid.split('::')
    return `/api/manga/bt-pages/${encodeURIComponent(slug)}/${encodeURIComponent(num)}`
  },
})

export const kakalotFunProvider = makeMirrorProvider({
  id: 'kakalot',
  name: 'MangaKakalot.fun',
  blurb: 'Working Kakalot mirror (.fun), direct PNG pages',
  matchPath: (anilistId, hints) => `/api/manga/kk-match/${anilistId}${hints}`,
  chaptersPath: (mid) => `/api/manga/kk-chapters/${encodeURIComponent(mid)}`,
  pagesPath: (pcid) => {
    const [slug, num] = pcid.split('::')
    return `/api/manga/kk-pages/${encodeURIComponent(slug)}/${encodeURIComponent(num)}`
  },
})

export const mangaReadProvider = makeMirrorProvider({
  id: 'mangaread',
  name: 'MangaRead',
  blurb: 'WP-Manga family (MangaBuddy replacement), direct JPEGs',
  matchPath: (anilistId, hints) => `/api/manga/mr-match/${anilistId}${hints}`,
  chaptersPath: (mid) => `/api/manga/mr-chapters/${encodeURIComponent(mid)}`,
  pagesPath: (pcid) => {
    const [slug, num] = pcid.split('::')
    return `/api/manga/mr-pages/${encodeURIComponent(slug)}/${encodeURIComponent(num)}`
  },
})
