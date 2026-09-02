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

export function cleanEpisodeTitle(title: string): string {
  const t = title.trim()
  // Strip leading "Episode N - " or "Episode N: " or "Ep N - " etc.
  // e.g. "Episode 1 - Past x And x Future" -> "Past x And x Future"
  // e.g. "Episode 12: The Final Battle" -> "The Final Battle"
  const m = t.match(/^(?:Episode|Ep\.?)\s*\d+\s*[-:]\s*(.+)$/i)
  if (m && m[1] && m[1].trim().length > 0) {
    const rest = m[1].trim()
    // Don't strip if rest is generic (e.g. "Episode 1 - Episode 2" -> keep original? but that would be weird)
    if (!isGenericTitle(rest)) return rest
  }
  return t
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
  let preDiscardCount: number | null = null
  if (sortedAnime.streamingEpisodes) {
    const countForCheck = resolveEpisodeCount(sortedAnime, providerEpisodes)
    preDiscardCount = countForCheck
    const parsed = sortedAnime.streamingEpisodes.map(e => parseEpisodeNumber(typeof e.title === 'string' ? e.title : '')).filter(n => n !== null) as number[]
    if (parsed.length >= 2 && typeof sortedAnime.episodes === 'number' && sortedAnime.episodes > 0) {
      const outOfRange = parsed.filter(n => n > sortedAnime.episodes! + 0.6).length
      if (outOfRange / parsed.length > 0.7) {
        effectiveAnime = { ...sortedAnime, streamingEpisodes: undefined }
      }
    } else if (parsed.length >= 2 && (sortedAnime.episodes == null) ) {
      effectiveAnime = { ...sortedAnime, streamingEpisodes: undefined }
    }
  }

  const totalCount = (effectiveAnime.streamingEpisodes === undefined && preDiscardCount !== null && sortedAnime.episodes == null)
    ? preDiscardCount
    : resolveEpisodeCount(effectiveAnime, providerEpisodes)
  const airedCount = getAiredEpisodeCount(effectiveAnime)
  const count = (() => {
    if (effectiveAnime.status === 'NOT_YET_RELEASED') return 0
    if ((effectiveAnime.status === 'RELEASING') && (effectiveAnime.nextAiringEpisode || (effectiveAnime.airingSchedule && effectiveAnime.airingSchedule.length > 0))) {
      return Math.min(totalCount, airedCount)
    }
    return totalCount
  })()
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
  // Detect global offset (e.g., S2 episodes numbered 26..37 for local 1..12) vs local numbering
  const streamingByNumber = new Map<number, { title?: string; thumbnail?: string; url?: string; site?: string }>()
  let hasParseableNumbers = false
  let minParsed: number | null = null
  let maxParsed: number | null = null
  if (effectiveAnime.streamingEpisodes) {
    for (const se of effectiveAnime.streamingEpisodes) {
      const parsed = parseEpisodeNumber(typeof se.title === 'string' ? se.title : '')
      if (parsed !== null) {
        hasParseableNumbers = true
        if (minParsed === null || parsed < minParsed) minParsed = parsed
        if (maxParsed === null || parsed > maxParsed) maxParsed = parsed
        if (!streamingByNumber.has(parsed)) streamingByNumber.set(parsed, se)
      }
    }
  }
  // Determine offset for global numbering like S2 26..37
  // Only use offset when episodes is known and numbers are clearly global contiguous covering count
  let globalOffset = 0
  let useNumberMapping = hasParseableNumbers
  if (hasParseableNumbers && typeof effectiveAnime.episodes === 'number' && effectiveAnime.episodes > 0 && minParsed !== null && maxParsed !== null) {
    const countMatchesGlobal = (maxParsed - minParsed + 1) === count && minParsed > count && minParsed <= count + 200
    const allOutOfLocalRange = streamingByNumber.size >= Math.ceil(count * 0.8) && minParsed > count
    if (countMatchesGlobal || allOutOfLocalRange) {
      globalOffset = Math.round(minParsed - 1)
    }
    // One Piece case: episodes null -> do not use global offset, fallback to index if numbers out of range
    // Already handled by episodes check above (episodes null => no offset)
  }
  // For episodes-null (count derived from streamingLen) with global numbers like 892..911, don't use number mapping if numbers are far beyond count
  if (hasParseableNumbers && (effectiveAnime.episodes == null) && minParsed !== null && minParsed > count + 10) {
    useNumberMapping = false
  }

  return Array.from({ length: count }, (_, i) => {
    const n = i + 1
    let se: { title?: string; thumbnail?: string; url?: string; site?: string } | undefined
    if (useNumberMapping) {
      se = streamingByNumber.get(n) ?? (globalOffset ? streamingByNumber.get(n + globalOffset) : undefined)
      // If still miss and globalOffset exists, don't fallback to index — keep undefined to avoid wrong-season title
      // If no offset and miss, fallback to index for non-global case? Only if numbers are sparse
      if (!se && !globalOffset) {
        // Check if index fallback is safe: only when numbers are sparse and not all global
        const idxSe = effectiveAnime.streamingEpisodes?.[i]
        const idxParsed = idxSe ? parseEpisodeNumber(typeof idxSe.title === 'string' ? idxSe.title : '') : null
        if (idxParsed === null || Math.abs((idxParsed ?? 0) - n) < 2) {
          // Index title roughly matches local number, allow
          // Don't use idxSe if its parsed number is far from n (would be wrong season)
          if (idxParsed === null || idxParsed === n) {
            se = idxSe
          }
        }
      }
    } else {
      se = effectiveAnime.streamingEpisodes?.[i]
    }

    let title: string | undefined
    let source: AnimeEpisode['source'] = 'none'
    let providerId: string | undefined

    const anilistRaw = typeof se?.title === 'string' ? se.title.trim() : ''
    const cleanedAnilist = anilistRaw ? cleanEpisodeTitle(anilistRaw) : ''
    if (cleanedAnilist && !isGenericTitle(cleanedAnilist)) {
      title = cleanedAnilist
      source = 'anilist'
    } else {
      const pe = providerByNum.get(n)
      const providerRaw = typeof pe?.title === 'string' ? pe.title.trim() : ''
      const cleanedProvider = providerRaw ? cleanEpisodeTitle(providerRaw) : ''
      if (cleanedProvider && !isGenericTitle(cleanedProvider)) {
        title = cleanedProvider
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

export function getAiredEpisodeCount(anime: Anime): number {
  const nowSec = Math.floor(Date.now() / 1000)
  // Completed or finished anime: all episodes have aired
  if (anime.status && ['FINISHED', 'CANCELLED', 'HIATUS'].includes(anime.status)) {
    return anime.episodes ?? anime.streamingEpisodes?.length ?? 0
  }
  // Not yet released: none have aired
  if (anime.status === 'NOT_YET_RELEASED') return 0
  // Currently airing: use nextAiringEpisode or airingSchedule
  if (anime.nextAiringEpisode && typeof anime.nextAiringEpisode.episode === 'number' && typeof anime.nextAiringEpisode.airingAt === 'number') {
    // nextAiringEpisode.episode is the NEXT to air, so aired = episode - 1
    // But ensure airingAt is in future; if it's in past, it might be stale, fallback to schedule
    if (anime.nextAiringEpisode.airingAt > nowSec) {
      return Math.max(0, anime.nextAiringEpisode.episode - 1)
    }
    // If airingAt is in past, the episode has already aired, so we need to count via schedule
  }
  if (anime.airingSchedule && anime.airingSchedule.length > 0) {
    const aired = anime.airingSchedule.filter(s => s.airingAt <= nowSec).length
    if (aired > 0) return aired
    if (anime.nextAiringEpisode) return Math.max(0, anime.nextAiringEpisode.episode - 1)
  }
  // Fallback: if we have nextAiringEpisode but no schedule, use it
  if (anime.nextAiringEpisode && typeof anime.nextAiringEpisode.episode === 'number') {
    return Math.max(0, anime.nextAiringEpisode.episode - 1)
  }
  // For airing anime with no schedule data, fallback to episodes count but hide future? Without air date, we can't know, so show all
  // But to be safe for currently airing, if status is RELEASING and no schedule, we should not hide, show all
  // The user wants to hide future episodes only when we have air date info
  return anime.episodes ?? anime.streamingEpisodes?.length ?? 0
}

export function getEpisodeCount(
  anime: Anime,
  providerEpisodes?: VideoEpisode[] | null
): number {
  const total = resolveEpisodeCount(anime, providerEpisodes)
  const aired = getAiredEpisodeCount(anime)
  // If we have airing info, cap total to aired count; otherwise use total
  if (anime.status === 'RELEASING' || anime.status === 'NOT_YET_RELEASED') {
    // Only cap if we have reliable aired count (i.e., airingSchedule or nextAiringEpisode present)
    if (anime.nextAiringEpisode || (anime.airingSchedule && anime.airingSchedule.length > 0)) {
      return Math.min(total, aired)
    }
  }
  if (anime.status === 'NOT_YET_RELEASED') return 0
  return total
}

// ---------------------------------------------------------------------------
// Smart season / episode numbering (handles restart vs continuing seasons)
// ---------------------------------------------------------------------------

export function parseSeasonNumberFromTitle(raw: string): number | null {
  if (!raw) return null
  const t = raw.toLowerCase()
  // 2nd Season, 3rd Season
  let m = t.match(/(\d+)(?:st|nd|rd|th)\s+season/)
  if (m) return Number(m[1])
  // Season 2, Season 12
  m = t.match(/season\s+(\d+)/)
  if (m) return Number(m[1])
  return null
}

export function getSmartSeasonNumber(anime: Anime, group?: AnimeSeriesGroup | null, seasonIdx?: number | null): number {
  if (group && typeof seasonIdx === 'number' && seasonIdx >= 0 && seasonIdx < group.seasons.length) {
    return seasonIdx + 1
  }
  const candidates = [anime.title.english, anime.title.romaji].filter(Boolean) as string[]
  for (const raw of candidates) {
    const n = parseSeasonNumberFromTitle(raw as string)
    if (n) return n
  }
  return 1
}

/**
 * Detect whether this season's episode numbering continues globally.
 * Returns offset to add to local numbers to get global display numbers.
 * Uses streamingEpisodes parsed numbers as ground truth, and optionally
 * validates against group cumulative offset when available.
 */
export function getNumberingOffsetAndMode(
  anime: Anime,
  group?: AnimeSeriesGroup | null,
  seasonIdx?: number | null
): { mode: 'restart' | 'continue'; offset: number; seasonNumber: number } {
  const seasonNumber = getSmartSeasonNumber(anime, group ?? null, seasonIdx ?? null)
  const epCount = anime.episodes ?? 0

  // streaming-based offset detection (same heuristic as normalizeEpisodes)
  let streamingOffset = 0
  const streaming = anime.streamingEpisodes
  if (streaming && streaming.length && epCount > 0) {
    const parsed: number[] = []
    for (const se of streaming) {
      const n = parseEpisodeNumber(typeof se.title === 'string' ? se.title : '')
      if (n !== null) parsed.push(n)
    }
    if (parsed.length >= Math.ceil(streaming.length * 0.5) && parsed.length >= 2) {
      const min = Math.min(...parsed)
      const max = Math.max(...parsed)
      const count = epCount
      const countMatchesGlobal = (max - min + 1) === count && min > count && min <= count + 200
      const allOutOfLocal = parsed.length >= Math.ceil(count * 0.8) && min > count
      if (countMatchesGlobal || allOutOfLocal) {
        streamingOffset = Math.round(min - 1)
      }
    }
  }

  // group-based offset for validation / fallback
  let groupOffset = 0
  if (group && typeof seasonIdx === 'number' && seasonIdx > 0) {
    for (let i = 0; i < seasonIdx; i++) groupOffset += group.seasons[i].episodes ?? 0
  }

  // Decide mode: if streaming offset exists, it's authoritative for "continue"
  if (streamingOffset > 0) {
    // Validate against groupOffset when both exist — allow small discrepancy but prefer streaming
    return { mode: 'continue', offset: streamingOffset, seasonNumber }
  }
  // No streaming evidence -> default restart (most seasonal anime restart at 1)
  // Even if groupOffset >0, without evidence we don't assume continuing globally
  return { mode: 'restart', offset: 0, seasonNumber }
}

export function getDisplayEpisodeNumber(
  anime: Anime,
  localNumber: number,
  group?: AnimeSeriesGroup | null,
  seasonIdx?: number | null
): number {
  const { mode, offset } = getNumberingOffsetAndMode(anime, group ?? null, seasonIdx ?? null)
  return mode === 'continue' ? localNumber + offset : localNumber
}

export function getLocalEpisodeNumber(
  anime: Anime,
  displayNumber: number,
  group?: AnimeSeriesGroup | null,
  seasonIdx?: number | null
): number {
  const { mode, offset } = getNumberingOffsetAndMode(anime, group ?? null, seasonIdx ?? null)
  if (mode === 'continue') {
    const local = displayNumber - offset
    // clamp to valid range
    const max = anime.episodes ?? displayNumber
    if (local >= 1 && local <= max) return local
    return displayNumber // fallback if out of range (treat as local)
  }
  return displayNumber
}

export function formatEpisodeLabel(
  anime: Anime,
  localEp: number,
  group?: AnimeSeriesGroup | null,
  seasonIdx?: number | null
): string {
  const { seasonNumber } = getNumberingOffsetAndMode(anime, group ?? null, seasonIdx ?? null)
  const displayEp = getDisplayEpisodeNumber(anime, localEp, group ?? null, seasonIdx ?? null)
  return `S${seasonNumber}:E${displayEp}`
}
// trigger rebuild Tue Sep  1 15:41:15 +07 2026
