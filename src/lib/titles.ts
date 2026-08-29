import type { Anime } from '../types/anime'
import type { AnimeSeriesGroup } from '../services/anilist/series'

export function isTvFormat(format?: string | null): boolean {
  return format === 'TV' || format === 'TV_SHORT'
}

// Franchise title: strip known season/part suffixes for display, keep root title clean
// e.g. "Shingeki no Kyojin Season 3" -> "Shingeki no Kyojin"
// "Youkoso Jitsuryoku Shijou Shugi no Kyoushitsu e 2nd Season" -> "Youkoso Jitsuryoku Shijou Shugi no Kyoushitsu e"
// Robust: handles "The Final Season", "Final Season Part 2", "Season 3 Part 2", colon variants.
export function getFranchiseTitle(raw: string): string {
  if (!raw) return raw
  let t = raw.trim()
  let prev: string
  do {
    prev = t
    t = t.replace(/\s*:\s*(the\s+)?(season\s*\d+|\d+(st|nd|rd|th)\s*season|final\s*season.*|part\s*\d+.*)\s*$/i, '').trim()
    t = t.replace(/\s+(the\s+)?final\s+season(\s+part\s*\d+)?.*$/i, '').trim()
    t = t.replace(/\s+(the\s+)?(season\s*\d+|\d+(st|nd|rd|th)\s*season|part\s*\d+)\s*$/i, '').trim()
    t = t.replace(/\s+\d+(st|nd|rd|th)\s*season\s*$/i, '').trim()
  } while (t !== prev)
  return t || raw
}

export interface TitleHierarchy {
  /** H1 — franchise/display title (never season-specific for TV) */
  primary: string
  /** Japanese/native line — title.native when exists and distinct */
  native?: string
  /** Romanized line — title.romaji when exists and distinct from primary/native */
  romaji?: string
}

/**
 * Global title hierarchy for Aeri.
 * - TV (TV/TV_SHORT): H1 is franchise-stripped (group if present else strip suffix from anime). Native then romaji lines, deduped.
 * - MOVIE and others: normal hierarchy — H1 = english ?? romaji, then native, then romaji, deduped, no stripping.
 * Use AniList fields title.english, title.native, title.romaji.
 */
export function getTitleHierarchy(anime: Anime, group?: AnimeSeriesGroup | null): TitleHierarchy {
  const format = anime.format
  const isTv = isTvFormat(format)

  // For grouped TV, franchise titles come from group (root). Strip season suffix from english as well.
  if (group && isTv) {
    const groupEnglish = group.title.english?.trim() ? getFranchiseTitle(group.title.english.trim()) : undefined
    const groupRomaji = group.title.romaji?.trim() ? getFranchiseTitle(group.title.romaji.trim()) : undefined
    const fallbackPrimary = anime.title.english?.trim() ? getFranchiseTitle(anime.title.english.trim()) : anime.title.romaji ? getFranchiseTitle(anime.title.romaji) : ''
    const primary = (groupEnglish || groupRomaji || fallbackPrimary) ?? ''
    const nativeRaw = group.title.native?.trim()
    const romajiRaw = groupRomaji

    let native: string | undefined
    if (nativeRaw && nativeRaw !== primary) native = nativeRaw
    let romaji: string | undefined
    if (romajiRaw && romajiRaw !== primary && romajiRaw !== native) romaji = romajiRaw

    // Fallback: if primary was romaji and romaji line would duplicate, omit it (already primary)
    // If no english, primary may be romaji franchise — don't repeat
    return { primary, ...(native ? { native } : {}), ...(romaji ? { romaji } : {}) }
  }

  // Non-grouped
  if (!isTv) {
    // Movies etc: no stripping
    const primary = (anime.title.english?.trim() || anime.title.romaji?.trim()) ?? ''
    const nativeRaw = anime.title.native?.trim()
    const romajiRaw = anime.title.romaji?.trim()

    let native: string | undefined
    if (nativeRaw && nativeRaw !== primary) native = nativeRaw
    let romaji: string | undefined
    if (romajiRaw && romajiRaw !== primary && romajiRaw !== native) romaji = romajiRaw
    return { primary, ...(native ? { native } : {}), ...(romaji ? { romaji } : {}) }
  }

  // TV without group — strip season suffix from display titles
  // H1: prefer english stripped, else stripped romaji
  const englishRaw = anime.title.english?.trim()
  const romajiRaw = anime.title.romaji?.trim()
  const nativeRaw = anime.title.native?.trim()

  const primary = englishRaw ? getFranchiseTitle(englishRaw) : romajiRaw ? getFranchiseTitle(romajiRaw) : ''

  // For TV without group, secondary lines should use stripped romaji to avoid "Season 4" bleed
  const strippedRomaji = romajiRaw ? getFranchiseTitle(romajiRaw) : undefined
  // native rarely has season suffix, keep as is

  let native: string | undefined
  if (nativeRaw && nativeRaw !== primary) native = nativeRaw

  let romaji: string | undefined
  if (strippedRomaji && strippedRomaji !== primary && strippedRomaji !== native) romaji = strippedRomaji

  return { primary, ...(native ? { native } : {}), ...(romaji ? { romaji } : {}) }
}

/** Primary title only (for cards, search results compact). TV-aware stripping. */
export function getPrimaryTitle(anime: Anime, group?: AnimeSeriesGroup | null): string {
  return getTitleHierarchy(anime, group).primary
}
