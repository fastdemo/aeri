import type { Anime } from '../../types/anime'

// One shared in-memory + IndexedDB record per AniList id AND media type.
// The same numeric id under ANIME vs MANGA is a DIFFERENT entity (HxH anime
// vs HxH manga) — keys are `anilist:media:<type>:<id>` so anime and manga
// records can never collide or satisfy each other's reads.
import { getCache, putCache } from '../../storage/db'

const mem = new Map<string, { anime: Anime; expiry: number }>()
const MEM_TTL = 1000 * 60 * 30
const MEM_MAX = 300

export type MediaTypeKey = 'ANIME' | 'MANGA'

function key(id: number, type: MediaTypeKey = 'ANIME'): string {
  return `anilist:media:${type}:${id}`
}

/** Infer the record's own type from its format (manga formats ⇒ MANGA). */
export function mediaTypeOf(anime: Anime): MediaTypeKey {
  const f = (anime.format ?? '').toUpperCase()
  return f === 'MANGA' || f === 'NOVEL' || f === 'ONE_SHOT' ? 'MANGA' : 'ANIME'
}

export function getCachedAnimeSync(id: number, type: MediaTypeKey = 'ANIME'): Anime | null {
  const hit = mem.get(key(id, type))
  if (hit && hit.expiry > Date.now()) return hit.anime
  return null
}

export async function getCachedAnime(id: number, type: MediaTypeKey = 'ANIME'): Promise<Anime | null> {
  const hit = getCachedAnimeSync(id, type)
  if (hit) return hit
  try {
    const cached = await getCache<{ anime: Anime; at: number }>(key(id, type))
    if (cached && Date.now() - cached.at < 1000 * 60 * 60 * 24) {
      // Belt-and-braces: a record stored under the wrong type must never
      // satisfy this read (e.g. anime record answering a manga read after
      // a key migration). Verify the payload's own format agrees.
      if (mediaTypeOf(cached.anime) !== type) return null
      mem.set(key(id, type), { anime: cached.anime, expiry: Date.now() + MEM_TTL })
      return cached.anime
    }
  } catch {}
  return null
}

export function putCachedAnime(id: number, anime: Anime, type?: MediaTypeKey): void {
  if (!Number.isFinite(id) || id <= 0) return
  const t = type ?? mediaTypeOf(anime)
  // Never store a record whose own format disagrees with its key type.
  if (mediaTypeOf(anime) !== t) return
  mem.set(key(id, t), { anime, expiry: Date.now() + MEM_TTL })
  if (mem.size > MEM_MAX) {
    const oldest = mem.keys().next().value as string | undefined
    if (oldest !== undefined) mem.delete(oldest)
  }
  putCache(key(id, t), { anime, at: Date.now() }).catch(() => {})
}
