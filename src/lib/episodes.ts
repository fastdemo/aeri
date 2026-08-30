import type { Anime } from '../types/anime'
import type { VideoEpisode } from '../providers/video/types'
import type { AnimeSeriesGroup } from '../services/anilist/series'

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
  return false
}

export function parseEpisodeNumber(title: string): number | null {
  if (!title) return null
  const m = title.match(/Episode\s+(\d+(?:\.\d+)?)/i)
  if (!m) return null
  const n = parseFloat(m[1])
  return Number.isFinite(n) ? n : null
}

export function isTrailerTitle(title: string): boolean {
  const s = title.toLowerCase()
  return s.includes('trailer') || s.includes('preview') || s.includes(' teaser') || s.includes('| trailer') || s.includes(' pv')
}

function isValidHttpUrl(url: string): boolean {
  const t = url.trim()
  if (!t) return false
  if (t.startsWith('data:')) return false
  if (t.includes('picsum.photos')) return false
  try {
    const u = new URL(t)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

function getStreamingHash(anime: Anime): string {
  const arr = anime.streamingEpisodes ?? []
  if (!arr.length) return `empty-${anime.identity.anilistId ?? anime.identity.internalId}`
  const titles = arr.map(e => (e.title ?? '') + '|' + (e.thumbnail ?? '')).join('##')
  return `${arr.length}::${titles.slice(0, 2000)}`
}

export function filterAndSortStreamingEpisodes(
  streaming: { title?: string; thumbnail?: string; url?: string; site?: string }[] | undefined
): { title?: string; thumbnail?: string; url?: string; site?: string }[] | undefined {
  if (!streaming || streaming.length === 0) return undefined
  // filter trailers
  let filtered = streaming.filter(e => {
    const t = typeof e.title === 'string' ? e.title : ''
    if (t && isTrailerTitle(t)) return false
    return true
  })
  if (filtered.length === 0) return undefined
  // extract numbers
  const parsed = filtered.map(e => parseEpisodeNumber(typeof e.title === 'string' ? e.title : ''))
  const parseableCount = parsed.filter(n => n !== null).length
  if (parseableCount >= Math.ceil(filtered.length * 0.5) && filtered.length >= 2) {
    // sort ascending by parsed number; entries without number go to end preserving order
    filtered = [...filtered].sort((a, b) => {
      const na = parseEpisodeNumber(typeof a.title === 'string' ? a.title : '')
      const nb = parseEpisodeNumber(typeof b.title === 'string' ? b.title : '')
      if (na === null && nb === null) return 0
      if (na === null) return 1
      if (nb === null) return -1
      return na - nb
    })
  } else if (parseableCount >= 2) {
    const first = parsed[0], last = parsed[parsed.length - 1]
    if (first !== null && last !== null && first > last) {
      filtered = [...filtered].reverse()
    }
  }
  return filtered.length ? filtered : undefined
}

/**
 * Sanitize anime streaming for display, optionally with group context.
 * - filters trailers
 * - sorts ascending
 * - if group provided, detects duplicate streaming across seasons and keeps only for best-fit season
 * - validates against expected offset range if group provided
 */
export function sanitizeAnimeForDisplay(
  anime: Anime,
  group: AnimeSeriesGroup | null,
  seasonIdx: number | null
): Anime {
  const sorted = filterAndSortStreamingEpisodes(anime.streamingEpisodes)
  if (!sorted) {
    return { ...anime, streamingEpisodes: undefined }
  }
  // If no group context, apply local range validation: if majority of parsed numbers > episodes count, discard
  if (!group || seasonIdx === null || seasonIdx === undefined) {
    const count = anime.episodes
    if (typeof count === 'number' && count > 0) {
      const parsed = sorted.map(e => parseEpisodeNumber(typeof e.title === 'string' ? e.title : '')).filter(n => n !== null) as number[]
      if (parsed.length >= 2) {
        const outOfRange = parsed.filter(n => n > count + 0.6 || n < 0.5).length
        if (outOfRange / parsed.length > 0.7) {
          // Most numbers out of local range -> likely global numbering for another season, discard to avoid wrong titles
          return { ...anime, streamingEpisodes: undefined }
        }
      }
    }
    return { ...anime, streamingEpisodes: sorted }
  }
  // Group-aware deduplication + offset validation
  // Build hash map for group
  const hashCounts = new Map<string, number>()
  const hashOwner = new Map<string, { idx: number; diff: number }>()
  for (let i = 0; i < group.seasons.length; i++) {
    const s = group.seasons[i]
    const h = getStreamingHash(s)
    hashCounts.set(h, (hashCounts.get(h) ?? 0) + 1)
    const diff = Math.abs((s.streamingEpisodes?.length ?? 0) - (s.episodes ?? 0))
    const existing = hashOwner.get(h)
    if (!existing || diff < existing.diff) {
      hashOwner.set(h, { idx: i, diff })
    }
  }
  const thisHash = getStreamingHash(anime)
  const countDup = hashCounts.get(thisHash) ?? 0
  if (countDup > 1) {
    const owner = hashOwner.get(thisHash)!
    if (owner.idx !== seasonIdx) {
      return { ...anime, streamingEpisodes: undefined }
    }
  }
  // Offset validation
  const count = anime.episodes ?? 0
  if (count > 0) {
    let offset = 0
    for (let i = 0; i < seasonIdx; i++) {
      offset += group.seasons[i].episodes ?? 0
    }
    const parsed = sorted.map(e => parseEpisodeNumber(typeof e.title === 'string' ? e.title : '')).filter(n => n !== null) as number[]
    if (parsed.length >= 2) {
      const inRange = parsed.filter(n => n >= offset + 0.4 && n <= offset + count + 0.6).length
      if (inRange / parsed.length < 0.3) {
        // Check if maybe all numbers in local range instead (fallback global vs local)
        const inLocal = parsed.filter(n => n >= 0.5 && n <= count + 0.6).length
        if (inLocal / parsed.length < 0.3) {
          return { ...anime, streamingEpisodes: undefined }
        }
        // If inLocal is good but offset mismatch, keep local (means global numbers not matching offset, but local matches)
        // So keep sorted
      }
    }
  }
  return { ...anime, streamingEpisodes: sorted }
}

export function sanitizeGroup(group: AnimeSeriesGroup): AnimeSeriesGroup {
  // Returns new group with each season sanitized
  const sanitizedSeasons = group.seasons.map((s, idx) => sanitizeAnimeForDisplay(s, group, idx))
  return { ...group, seasons: sanitizedSeasons }
}

/**
 * Resolve authoritative episode count.
 */
export function resolveEpisodeCount(
  anime: Anime,
  providerEpisodes?: VideoEpisode[] | null
): number {
  const anilistCount = anime.episodes
  const providerCount = providerEpisodes?.length ?? 0

  if (typeof anilistCount === 'number' && anilistCount > 0) {
    if (providerCount > anilistCount + 12) {
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
 */
export function normalizeEpisodes(
  anime: Anime,
  providerEpisodes?: VideoEpisode[] | null
): AnimeEpisode[] {
  // Ensure streaming is filtered/sorted for standalone usage (without group)
  const sortedAnime: Anime = filterAndSortStreamingEpisodes(anime.streamingEpisodes)
    ? { ...anime, streamingEpisodes: filterAndSortStreamingEpisodes(anime.streamingEpisodes) }
    : anime
  // Apply local mismatch discard before index mapping?
  let effectiveAnime = sortedAnime
  if (sortedAnime.streamingEpisodes) {
    const countForCheck = resolveEpisodeCount(sortedAnime, providerEpisodes)
    const parsed = sortedAnime.streamingEpisodes.map(e => parseEpisodeNumber(typeof e.title === 'string' ? e.title : '')).filter(n => n !== null) as number[]
    if (parsed.length >= 2 && typeof sortedAnime.episodes === 'number' && sortedAnime.episodes > 0) {
      const outOfRange = parsed.filter(n => n > sortedAnime.episodes! + 0.6).length
      if (outOfRange / parsed.length > 0.7) {
        effectiveAnime = { ...sortedAnime, streamingEpisodes: undefined }
      }
    }
    // also if countForCheck !== sortedAnime.streamingEpisodes.length and outOfRange, already handled
    void countForCheck
  }

  const count = resolveEpisodeCount(effectiveAnime, providerEpisodes)
  if (count === 0) return []

  const providerByNum = new Map<number, VideoEpisode>()
  if (providerEpisodes) {
    for (const pe of providerEpisodes) {
      if (typeof pe.number === 'number' && pe.number >= 1 && pe.number <= count) {
        if (!providerByNum.has(pe.number)) providerByNum.set(pe.number, pe)
      }
    }
  }

  const baseDuration = effectiveAnime.duration

  // Build number-based lookup for streaming episodes when titles contain episode numbers
  const streamingByNumber = new Map<number, { title?: string; thumbnail?: string; url?: string; site?: string }>()
  let hasParseableNumbers = false
  if (effectiveAnime.streamingEpisodes) {
    for (const se of effectiveAnime.streamingEpisodes) {
      const parsed = parseEpisodeNumber(typeof se.title === 'string' ? se.title : '')
      if (parsed !== null) {
        hasParseableNumbers = true
        if (!streamingByNumber.has(parsed)) streamingByNumber.set(parsed, se)
      }
    }
  }
  const useNumberMapping = hasParseableNumbers

  return Array.from({ length: count }, (_, i) => {
    const n = i + 1
    let se: { title?: string; thumbnail?: string; url?: string; site?: string } | undefined
    if (useNumberMapping) {
      se = streamingByNumber.get(n)
    } else {
      se = effectiveAnime.streamingEpisodes?.[i]
    }

    let title: string | undefined
    let source: AnimeEpisode['source'] = 'none'
    let providerId: string | undefined

    const anilistRaw = typeof se?.title === 'string' ? se.title.trim() : ''
    if (anilistRaw && !isGenericTitle(anilistRaw)) {
      // If title contains global number prefix like "Episode 72 - Title", keep as is but it has been sorted
      // Optionally strip global number offset? Keep full title for now
      title = anilistRaw
      source = 'anilist'
    } else {
      const pe = providerByNum.get(n)
      const providerRaw = typeof pe?.title === 'string' ? pe.title.trim() : ''
      if (providerRaw && !isGenericTitle(providerRaw)) {
        title = providerRaw
        source = 'provider'
        providerId = pe?.provider
      } else if (pe) {
        providerId = pe.provider
      }
    }

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

export function getEpisodeCount(
  anime: Anime,
  providerEpisodes?: VideoEpisode[] | null
): number {
  return resolveEpisodeCount(anime, providerEpisodes)
}
