import type { Anime } from '../../types/anime'

// One shared in-memory + IndexedDB record per AniList id, written by EVERY
// path that fetches full display fields (page Media, series spine walk) and
// read before any network request. This is what makes the anime page cost
// ONE request cold (spine covers the page) and ZERO warm — instead of N
// independent caches each paying for the same Media object.
import { getCache, putCache } from '../../storage/db'

const mem = new Map<number, { anime: Anime; expiry: number }>()
const MEM_TTL = 1000 * 60 * 30
const MEM_MAX = 300

function key(id: number): string {
  return `anilist:media:${id}`
}

export function getCachedAnimeSync(id: number): Anime | null {
  const hit = mem.get(id)
  if (hit && hit.expiry > Date.now()) return hit.anime
  return null
}

export async function getCachedAnime(id: number): Promise<Anime | null> {
  const hit = getCachedAnimeSync(id)
  if (hit) return hit
  try {
    const cached = await getCache<{ anime: Anime; at: number }>(key(id))
    if (cached && Date.now() - cached.at < 1000 * 60 * 60 * 24) {
      mem.set(id, { anime: cached.anime, expiry: Date.now() + MEM_TTL })
      return cached.anime
    }
  } catch {}
  return null
}

export function putCachedAnime(id: number, anime: Anime): void {
  if (!Number.isFinite(id) || id <= 0) return
  mem.set(id, { anime, expiry: Date.now() + MEM_TTL })
  if (mem.size > MEM_MAX) {
    const oldest = mem.keys().next().value as number | undefined
    if (oldest !== undefined) mem.delete(oldest)
  }
  putCache(key(id), { anime, at: Date.now() }).catch(() => {})
}
