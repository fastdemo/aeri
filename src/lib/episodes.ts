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
  /** Display metadata provenance. Video providers never supply names/art. */
  source: 'anilist' | 'kitsu' | 'none'
  providerId?: string
  /**
   * Per-field resolution state. Loading ≠ failed ≠ absent: the UI shows a
   * neutral skeleton while a field is loading, the real value when it
   * resolves, and a quiet fallback ONLY when the field is confirmed
   * unavailable (upstream genuinely lacks it) or errored (provider down).
   * A late response may only fill fields that are still loading — it must
   * NEVER overwrite a resolved value (stale-overwrite guard in the merge
   * helpers below).
   */
  fieldState?: {
    title?: 'loading' | 'resolved' | 'unavailable' | 'error'
    thumbnail?: 'loading' | 'resolved' | 'unavailable' | 'error'
  }
}

/** Supplemental episode metadata (Kitsu), never a general metadata source. */
export interface EpisodeFallback {
  number: number
  title?: string
  thumbnail?: string
}

export type EpisodeFallbackStatus = 'idle' | 'loading' | 'resolved' | 'unavailable' | 'error'

export interface EpisodeFallbackInput {
  episodes?: EpisodeFallback[] | null
  status: EpisodeFallbackStatus
  /**
   * Whole-entry gate decided by the caller on the RAW AniList record.
   * `false` means AniList supplied metadata that SURVIVES the display
   * guards (season/range), so the fallback must not be used. When the
   * guards discard the list entirely (Code Geass R2) the gate stays `true`
   * and Kitsu may fill the whole entry.
   */
  allowed?: boolean
}

/** Field quality rank: resolved real data beats everything; a failed or
 * absent field must never overwrite a resolved one. */
export function fieldQuality(v: string | undefined, state: 'loading' | 'resolved' | 'unavailable' | 'error' | undefined): number {
  if (v && state !== 'error' && state !== 'unavailable') return state === 'resolved' ? 3 : 2
  if (state === 'loading' || state === undefined) return 1
  return 0
}

/**
 * Merge a late episode-metadata patch into an existing episode. Only fills
 * fields that are still loading/empty — never overwrites resolved values
 * with fallback or stale data. Returns the (possibly unchanged) episode.
 */
export function mergeEpisodeField<T extends Pick<AnimeEpisode, 'title' | 'thumbnail' | 'fieldState'>>(
  ep: T,
  patch: { title?: string; thumbnail?: string; source: AnimeEpisode['source'] },
): T {
  const out = { ...ep, fieldState: { ...ep.fieldState } }
  if (patch.title && fieldQuality(out.title, out.fieldState?.title) < 2) {
    const clean = cleanEpisodeTitle(patch.title.trim())
    if (clean && !isGenericTitle(clean)) {
      out.title = clean
      out.fieldState!.title = 'resolved'
    }
  }
  if (patch.thumbnail && fieldQuality(out.thumbnail, out.fieldState?.thumbnail) < 2) {
    if (isValidHttpUrl(patch.thumbnail.trim())) {
      out.thumbnail = patch.thumbnail.trim()
      out.fieldState!.thumbnail = 'resolved'
    }
  }
  void patch.source
  return out
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

// Best-effort display title for a local episode number from streaming metadata
// (AniList streamingEpisodes). Returns null when no credible title exists.
export function getStreamingEpisodeTitle(anime: Anime, localNum: number): string | null {
  const list = anime.streamingEpisodes ?? []
  if (!list.length || localNum < 1) return null
  for (const e of list) {
    const raw = typeof e.title === 'string' ? e.title : ''
    if (!raw || isTrailerTitle(raw)) continue
    if (parseEpisodeNumber(raw) === localNum) {
      const clean = cleanEpisodeTitle(raw)
      if (clean && !isGenericTitle(clean)) return clean
    }
  }
  return null
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

/**
 * Kitsu may answer ONLY when
 * AniList cannot render usable episode metadata for the entry. "Usable"
 * means at least one non-generic title or one real thumbnail AND that list
 * survives the season-pollution / range guards. Partial AniList data is
 * still AniList data: missing rows keep the UI placeholder and Kitsu is
 * never mixed in. A list the guards discard does not count — see
 * `anilistEpisodeMetadataSurvivesGuards`.
 *
 * Pass the RAW streaming list here from `anilistEpisodeMetadataSurvivesGuards`
 * callers; this predicate alone does not apply the season/range guards.
 */
export function hasUsableAniListEpisodeMetadata(anime: Pick<Anime, 'streamingEpisodes'>): boolean {
  for (const episode of anime.streamingEpisodes ?? []) {
    const rawTitle = typeof episode.title === 'string' ? episode.title.trim() : ''
    const title = rawTitle ? cleanEpisodeTitle(rawTitle) : ''
    if (title && !isGenericTitle(title)) return true
    const thumbnail = typeof episode.thumbnail === 'string' ? episode.thumbnail.trim() : ''
    if (thumbnail && isValidHttpUrl(thumbnail)) return true
  }
  return false
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
 * SEASON-POLLUTION GUARD. AniList frequently attaches ANOTHER season's
 * crunchyroll listing to a sequel entry — verified upstream: Code Geass R2
 * (2904) carries S1's full 25-row list (identical titles AND crunchyroll
 * urls), and 86: Part 2 (131586) carries Part 1's 11 rows over its own 12.
 * There is no local way to re-derive the correct titles, so when the
 * pollution signals fire the list is dropped entirely: clean "Episode N"
 * rows with the show's own cover as the thumbnail are always correct —
 * wrong-season titles never are. Only FINISHED/CANCELLED entries are
 * tested: airing shows legitimately grow their lists week by week.
 *
 * (i) Row-count mismatch on a finished entry (streaming rows ≠ the entry's
 *     own episode count).
 * (ii) Finished entry with a prequel of the SAME episode count and an
 *     equally long streaming list — the exact shape AniList's
 *     first-season copies take (CG R2). Trade-off (documented): a
 *     correct same-length sequel loses its titles too; generic-but-correct
 *     rows beat detailed-but-wrong ones.
 */
function seasonPollutedStreaming(anime: Anime): boolean {
  const status = (anime.status ?? '').toUpperCase()
  if (status !== 'FINISHED' && status !== 'CANCELLED') return false
  const count = anime.episodes
  if (typeof count !== 'number' || count <= 0) return false
  const ses = anime.streamingEpisodes
  if (!ses || !ses.length) return false
  if (ses.length !== count) return true
  const prequel = anime.relations?.edges?.find((e) => e.relationType === 'PREQUEL')?.node
  if (prequel && typeof prequel.episodes === 'number' && prequel.episodes === count) return true
  return false
}

/** Pure display-time guard: strips season-polluted streaming lists. */
export function discardSeasonPollutedStreaming(anime: Anime): Anime {
  if (!seasonPollutedStreaming(anime)) return anime
  return { ...anime, streamingEpisodes: undefined }
}

/**
 * Sanitize anime streaming for display (standalone entry — no group model).
 * - strips season-polluted lists (see discardSeasonPollutedStreaming)
 * - filters trailers
 * - sorts ascending
 * - local range validation: if majority of parsed numbers exceed the
 *   episode count, discard (likely another entry's global numbering).
 */
function survivingStreamingEpisodes(anime: Anime) {
  const guarded = discardSeasonPollutedStreaming(anime)
  const sorted = filterAndSortStreamingEpisodes(guarded.streamingEpisodes)
  if (!sorted) return undefined
  const count = guarded.episodes
  if (typeof count === 'number' && count > 0) {
    const parsed = sorted.map(e => parseEpisodeNumber(typeof e.title === 'string' ? e.title : '')).filter(n => n !== null) as number[]
    if (parsed.length >= 2) {
      const outOfRange = parsed.filter(n => n > count + 0.6 || n < 0.5).length
      if (outOfRange / parsed.length > 0.7) return undefined
    }
  }
  return sorted
}

export function sanitizeAnimeForDisplay(anime: Anime): Anime {
  const guarded = discardSeasonPollutedStreaming(anime)
  const sorted = survivingStreamingEpisodes(anime)
  return { ...guarded, streamingEpisodes: sorted }
}

/**
 * the Kitsu fallback is allowed when
 * AniList's episode metadata does NOT survive the display guards. The old
 * gate asked only "does the raw list contain a title/thumbnail?", so a
 * season-polluted list (AniList id 2904 carries S1's 25 Crunchyroll rows)
 * counted as usable even though `sanitizeAnimeForDisplay` throws the whole
 * list away — the UI then showed bare "Episode N" placeholders forever and
 * Kitsu was never consulted. Data the guards discard is NOT usable data.
 *
 * True = AniList can render at least one real title/thumbnail in the UI.
 * False = the whole-entry fallback may run (Kitsu, or the UI placeholder
 * when Kitsu has nothing either).
 */
export function anilistEpisodeMetadataSurvivesGuards(anime: Anime): boolean {
  const surviving = survivingStreamingEpisodes(anime)
  return hasUsableAniListEpisodeMetadata({ streamingEpisodes: surviving })
}

/**
 * Estimate how many episodes have aired when AniList has no authoritative
 * `episodes` count (long-running shows like One Piece report episodes: null).
 * Prefers nextAiringEpisode (episode N airs next => N-1 aired), then the
 * highest aired episode in airingSchedule, then streaming length.
 */
export function estimateAiredEpisodeCount(anime: Anime): number {
  const next = anime.nextAiringEpisode
  if (next && typeof next.episode === 'number' && next.episode > 1) {
    return next.episode - 1
  }
  if (anime.airingSchedule && anime.airingSchedule.length > 0) {
    const nowSec = Math.floor(Date.now() / 1000)
    let maxAired = 0
    for (const s of anime.airingSchedule) {
      if (typeof s.airingAt === 'number' && typeof s.episode === 'number' && s.airingAt <= nowSec && s.episode > maxAired) {
        maxAired = s.episode
      }
    }
    if (maxAired > 0) return maxAired
  }
  return anime.streamingEpisodes?.length ?? 0
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
  // No authoritative count (e.g. ongoing long-runners with episodes: null):
  // use the largest available signal so lists aren't truncated to a
  // streaming slice (One Piece showed ~10 instead of 1100+).
  const streamingLen = anime.streamingEpisodes?.length ?? 0
  const estimate = estimateAiredEpisodeCount(anime)
  const best = Math.max(providerCount, estimate, streamingLen)
  if (best > 0) return best
  return 0
}

/**
 * Resolve a LOCAL episode number against a Kitsu fallback list.
 *
 * Kitsu entries in a franchise sometimes carry FRANCHISE-absolute numbers
 * (a 25-episode sequel listed as 26..50) while Aeri's locals are 1..N. An
 * exact miss therefore falls back to a contiguous-offset list — only when
 * the numbers really are a single run starting above 1, so a sparse or
 * partial list can never be mapped onto the wrong episodes.
 */
export function findFallbackEpisode<T extends { number: number }>(
  episodes: T[] | null | undefined,
  localNum: number,
): T | null {
  if (!episodes?.length || !(localNum >= 1)) return null
  const exact = episodes.find(e => e.number === localNum)
  if (exact) return exact
  const nums = episodes.map(e => e.number).filter(n => typeof n === 'number' && Number.isFinite(n) && n > 0)
  if (!nums.length) return null
  const min = Math.min(...nums)
  const max = Math.max(...nums)
  if (min > 1 && max - min + 1 === episodes.length) {
    return episodes.find(e => e.number === min + localNum - 1) ?? null
  }
  return null
}

/**
 * Normalize episodes with explicit priority for title/thumbnail:
 * AniList → (Kitsu ONLY when the whole entry has zero AniList episode
 * metadata) → UI placeholder. Video-provider rows still supply the
 * episode COUNT/duration and source-mapping ids, but never names or art.
 */
export function normalizeEpisodes(
  anime: Anime,
  providerEpisodes?: VideoEpisode[] | null,
  fallback?: EpisodeFallbackInput | null,
): AnimeEpisode[] {
  // Ensure streaming is filtered/sorted for standalone usage (without group)
  const rawStreaming = filterAndSortStreamingEpisodes(anime.streamingEpisodes)
  const sortedAnime: Anime = discardSeasonPollutedStreaming(
    rawStreaming ? { ...anime, streamingEpisodes: rawStreaming } : anime
  )
  // Fallback gate follows the DISPLAY guards (2026-10-25): a list the
  // season-pollution/range guards discard cannot suppress Kitsu — that was
  // Code Geass R2 (polluted list dropped → bare "Episode N" forever).
  const anilistHasMetadata = anilistEpisodeMetadataSurvivesGuards(anime)
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
      // Episodes unknown: keep streaming only when its numbers plausibly fit
      // the aired estimate (e.g. One Piece 62..130 within ~1176 aired).
      // Otherwise discard to avoid wrong-season titles.
      const est = estimateAiredEpisodeCount(sortedAnime)
      if (est > 0) {
        const outOfRange = parsed.filter(n => n < 0.5 || n > est + 0.6).length
        if (outOfRange / parsed.length > 0.7) {
          effectiveAnime = { ...sortedAnime, streamingEpisodes: undefined }
        }
      } else {
        effectiveAnime = { ...sortedAnime, streamingEpisodes: undefined }
      }
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

  // AniList owns episode metadata while it survives the display guards.
  // Kitsu is a whole-entry fallback: the moment AniList can render ONE real
  // title/thumbnail, the fallback is ignored entirely and any gaps stay
  // placeholders. `fallback.allowed` carries the caller's whole-entry gate.
  const fallbackAllowed = !anilistHasMetadata && (fallback?.allowed ?? true)
  const fallbackByNum = new Map<number, EpisodeFallback>()
  let fallbackOffset = 0
  if (fallbackAllowed && fallback?.episodes?.length) {
    for (const episode of fallback.episodes) {
      if (typeof episode.number === 'number' && Number.isFinite(episode.number) && episode.number >= 1) {
        if (!fallbackByNum.has(episode.number)) fallbackByNum.set(episode.number, episode)
      }
    }
    // Franchise-absolute Kitsu numbering (a 25-ep sequel listed 26..50):
    // a single contiguous run above 1 maps onto locals 1..N by offset.
    // Sparse lists never qualify (see findFallbackEpisode).
    const run = fallback.episodes
      .map(e => e.number)
      .filter(n => typeof n === 'number' && Number.isFinite(n) && n > 0)
    if (run.length === fallback.episodes.length && run.length) {
      const mn = Math.min(...run)
      const mx = Math.max(...run)
      if (mn > 1 && mx - mn + 1 === run.length) fallbackOffset = Math.round(mn - 1)
    }
  }
  const fallbackFor = (n: number): EpisodeFallback | undefined =>
    fallbackByNum.get(n) ?? (fallbackOffset ? fallbackByNum.get(n + fallbackOffset) : undefined)
  const fallbackPending = fallbackAllowed && fallback?.status === 'loading'

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
    // Field states: resolved only when a REAL value landed; loading while
    // the whole-entry Kitsu fallback is still in flight; unavailable when
    // no source has it and none is pending. The UI skeleton-binds on
    // 'loading', falls back quietly otherwise — a generic "Episode N"
    // label is never presented as resolved metadata.
    let titleState: 'loading' | 'resolved' | 'unavailable' | 'error' = 'unavailable'
    let thumbState: 'loading' | 'resolved' | 'unavailable' | 'error' = 'unavailable'

    const pe = providerByNum.get(n)
    if (pe) providerId = pe.provider

    const anilistRaw = typeof se?.title === 'string' ? se.title.trim() : ''
    const cleanedAnilist = anilistRaw ? cleanEpisodeTitle(anilistRaw) : ''
    if (cleanedAnilist && !isGenericTitle(cleanedAnilist)) {
      title = cleanedAnilist
      source = 'anilist'
      titleState = 'resolved'
    } else {
      const fallbackTitle = fallbackAllowed ? fallbackFor(n)?.title?.trim() : ''
      const cleanedFallback = fallbackTitle ? cleanEpisodeTitle(fallbackTitle) : ''
      if (cleanedFallback && !isGenericTitle(cleanedFallback)) {
        title = cleanedFallback
        source = 'kitsu'
        titleState = 'resolved'
      } else if (fallbackPending) {
        titleState = 'loading'
      }
    }

    let thumbnail: string | undefined
    const anilistThumb = typeof se?.thumbnail === 'string' ? se.thumbnail.trim() : ''
    if (anilistThumb && isValidHttpUrl(anilistThumb)) {
      thumbnail = anilistThumb
      if (source === 'none') source = 'anilist'
      thumbState = 'resolved'
    } else {
      const fallbackThumb = fallbackAllowed ? fallbackFor(n)?.thumbnail?.trim() : ''
      if (fallbackThumb && isValidHttpUrl(fallbackThumb)) {
        thumbnail = fallbackThumb
        if (source === 'none') source = 'kitsu'
        thumbState = 'resolved'
      } else if (fallbackPending) {
        thumbState = 'loading'
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
      fieldState: { title: titleState, thumbnail: thumbState },
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

/**
 * DISPLAY DENOMINATOR FOR PROGRESS. Airing shows are measured against the
 * episodes that HAVE AIRED, not the
 * planned season total — otherwise a fully caught-up viewer of a 12-episode
 * show sitting on episode 3 reads as 25% instead of 3 of 3. Finished shows
 * are unaffected: `getAiredEpisodeCount` returns the full episode count for
 * them, so the denominator stays the real total.
 *
 * `plannedTotal` is the caller's known total (episodes for anime, chapters
 * for manga) and is used as the fallback when there is no airing data at
 * all. Never returns more than the planned total when one is known.
 */
export function getAiredTotal(anime: Anime, plannedTotal = 0): number {
  const planned = plannedTotal > 0 ? plannedTotal : (anime.episodes ?? 0)
  const aired = getAiredEpisodeCount(anime)
  if (aired <= 0) return planned
  return planned > 0 ? Math.min(aired, planned) : aired
}

/**
 * Percentage of the AIRED units completed (0-100). `fallback` is returned
 * when the denominator is unknown, so callers keep whatever the tracker
 * supplied rather than inventing a number.
 */
export function getAiredProgressPercent(anime: Anime, watched: number, plannedTotal = 0, fallback = 0): number {
  const total = getAiredTotal(anime, plannedTotal)
  if (total <= 0 || watched <= 0) return fallback
  return Math.min(100, Math.round((watched / total) * 100))
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

/**
 * Season number parsed from the title when present ("Season 2", "2nd
 * Season"), else 1. Informational display only — never identity.
 */
export function getSmartSeasonNumber(anime: Anime): number {
  const candidates = [anime.title.english, anime.title.romaji].filter(Boolean) as string[]
  for (const raw of candidates) {
    const n = parseSeasonNumberFromTitle(raw as string)
    if (n) return n
  }
  return 1
}

/**
 * Detect whether this entry's episode numbering continues globally
 * (streaming titles carry global numbers). Returns offset to add to local
 * numbers to get display numbers. Purely per-entry — no group model.
 */
export function getNumberingOffsetAndMode(
  anime: Anime,
): { mode: 'restart' | 'continue'; offset: number; seasonNumber: number } {
  const seasonNumber = getSmartSeasonNumber(anime)
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

  // Decide mode: if streaming offset exists, it's authoritative for "continue"
  if (streamingOffset > 0) {
    return { mode: 'continue', offset: streamingOffset, seasonNumber }
  }
  // No streaming evidence -> default restart (most seasonal anime restart at 1)
  return { mode: 'restart', offset: 0, seasonNumber }
}

export function getDisplayEpisodeNumber(
  anime: Anime,
  localNumber: number,
): number {
  const { mode, offset } = getNumberingOffsetAndMode(anime)
  return mode === 'continue' ? localNumber + offset : localNumber
}

export function getLocalEpisodeNumber(
  anime: Anime,
  displayNumber: number,
): number {
  const { mode, offset } = getNumberingOffsetAndMode(anime)
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
): string {
  const displayEp = getDisplayEpisodeNumber(anime, localEp)
  return `E${displayEp}`
}
// trigger rebuild Tue Sep  1 15:41:15 +07 2026
