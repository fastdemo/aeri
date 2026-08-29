import type { Anime } from '../types/anime'
import type { VideoEpisode } from '../providers/video/types'

/**
 * Authoritative normalized episode.
 * - title/thumbnail only when legitimate (not invented, not picsum, not poster, not another season)
 * - streamingUrl from AniList when present
 * - source provenance for debugging
 */
export interface AnimeEpisode {
  number: number
  title?: string
  thumbnail?: string
  duration?: number
  streamingUrl?: string
  source: 'anilist' | 'provider' | 'none'
  providerId?: string
}

function isGenericTitle(t: string): boolean {
  const s = t.trim()
  if (!s) return true
  if (/^Episode\s+\d+$/i.test(s)) return true
  if (/^Ep\.?\s*\d+$/i.test(s)) return true
  if (/^\d+$/.test(s)) return true
  // Miruro/mock sometimes returns "Episode 1" as placeholder — treat as not legitimate
  return false
}

function isValidHttpUrl(url: string): boolean {
  const t = url.trim()
  if (!t) return false
  if (t.startsWith('data:')) return false
  // Disallow picsum fallback explicitly — we never use picsum as thumbnail
  if (t.includes('picsum.photos')) return false
  try {
    const u = new URL(t)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * Resolve authoritative episode count.
 * Priority:
 *  1) Anime.episodes when present (>0) — AniList authoritative
 *  2) Provider episode count when episodes is null/0 — fixes One Piece ongoing where AniList episodes=null
 *  3) streamingEpisodes length when both above missing
 *  4) 0 -> empty state (do NOT invent 12/24/100 cap)
 *
 * Note: When episodes is present but provider has significantly more (stale IDB cache),
 * we treat provider as fresher if delta > 12 to avoid hiding new episodes due to stale cache.
 */
export function resolveEpisodeCount(
  anime: Anime,
  providerEpisodes?: VideoEpisode[] | null
): number {
  const anilistCount = anime.episodes
  const providerCount = providerEpisodes?.length ?? 0

  if (typeof anilistCount === 'number' && anilistCount > 0) {
    if (providerCount > anilistCount + 12) {
      // Stale anilist cache — provider is fresher (e.g., One Piece 1100 vs 1123)
      return providerCount
    }
    return anilistCount
  }
  if (providerCount > 0) return providerCount
  const streamingLen = anime.streamingEpisodes?.length ?? 0
  if (streamingLen > 0) return streamingLen
  return 0
}

/**
 * Normalize episodes with explicit priority for title/thumbnail:
 *  1) AniList streamingEpisodes[i] (by index, not shifted)
 *  2) Provider episode metadata by number
 *  3) other legitimate source (future hook, currently none)
 *  4) number-only fallback -> title undefined (UI shows "Episode N"), thumbnail undefined (UI shows neutral placeholder)
 *
 * Guarantees:
 *  - No invented titles/thumbnails (no picsum, no random, no poster as thumbnail, no another season's metadata)
 *  - Never uses another season's array — index i only from this anime's streamingEpisodes
 *  - Validates URLs (http/https only)
 *  - Handles broken thumbnails/CORS via UI onError (this layer does not fake)
 */
export function normalizeEpisodes(
  anime: Anime,
  providerEpisodes?: VideoEpisode[] | null
): AnimeEpisode[] {
  const count = resolveEpisodeCount(anime, providerEpisodes)
  if (count === 0) return []

  const providerByNum = new Map<number, VideoEpisode>()
  if (providerEpisodes) {
    for (const pe of providerEpisodes) {
      if (typeof pe.number === 'number' && pe.number >= 1 && pe.number <= count) {
        if (!providerByNum.has(pe.number)) providerByNum.set(pe.number, pe)
      }
    }
  }

  const baseDuration = anime.duration

  return Array.from({ length: count }, (_, i) => {
    const n = i + 1
    const se = anime.streamingEpisodes?.[i]

    let title: string | undefined
    let source: AnimeEpisode['source'] = 'none'
    let providerId: string | undefined

    // 1) AniList
    const anilistRaw = typeof se?.title === 'string' ? se.title.trim() : ''
    if (anilistRaw && !isGenericTitle(anilistRaw)) {
      title = anilistRaw
      source = 'anilist'
    } else {
      // 2) Provider
      const pe = providerByNum.get(n)
      const providerRaw = typeof pe?.title === 'string' ? pe.title.trim() : ''
      if (providerRaw && !isGenericTitle(providerRaw)) {
        title = providerRaw
        source = 'provider'
        providerId = pe?.provider
      } else if (pe) {
        providerId = pe.provider
      }
      // 3) other legitimate source could be inserted here
      // 4) fallback leaves title undefined
    }

    // Thumbnail: 1) AniList 2) Provider
    let thumbnail: string | undefined
    const anilistThumb = typeof se?.thumbnail === 'string' ? se.thumbnail.trim() : ''
    if (anilistThumb && isValidHttpUrl(anilistThumb)) {
      thumbnail = anilistThumb
      if (source === 'none') source = 'anilist'
    } else {
      const pe = providerByNum.get(n)
      const providerThumb = typeof pe?.thumbnail === 'string' ? pe.thumbnail.trim() : ''
      if (providerThumb && isValidHttpUrl(providerThumb)) {
        thumbnail = providerThumb
        if (source === 'none') source = 'provider'
        if (pe && !providerId) providerId = pe.provider
      }
    }

    const streamingUrl = typeof se?.url === 'string' && se.url.trim() ? se.url.trim() : undefined
    const peDur = providerByNum.get(n)?.duration
    const duration = baseDuration ?? peDur

    return {
      number: n,
      ...(title ? { title } : {}),
      ...(thumbnail ? { thumbnail } : {}),
      ...(duration ? { duration } : {}),
      ...(streamingUrl ? { streamingUrl } : {}),
      source,
      ...(providerId ? { providerId } : {}),
    }
  })
}

/**
 * Legacy helper for components that only need count — prefer normalizeEpisodes.
 */
export function getEpisodeCount(
  anime: Anime,
  providerEpisodes?: VideoEpisode[] | null
): number {
  return resolveEpisodeCount(anime, providerEpisodes)
}
