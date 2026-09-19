import type { Anime } from '../types/anime'

export function isTvFormat(format?: string | null): boolean {
  return format === 'TV' || format === 'TV_SHORT'
}

// Display-title helper: strip known season/part suffixes so TV H1s read
// cleanly (e.g. "Shingeki no Kyojin Season 3" -> "Shingeki no Kyojin").
// Display-only — never identity, grouping, or matching.
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
 * Global title hierarchy for Aeri. Each entry stands alone — no franchise
 * grouping: H1 is the entry's own title (TV strips season suffix for
 * display), then native, then romaji, deduped.
 * Use AniList fields title.english, title.native, title.romaji.
 */
export function getTitleHierarchy(anime: Anime): TitleHierarchy {
  const format = anime.format
  const isTv = isTvFormat(format)

  // Non-TV: no stripping
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

  // TV — strip season suffix from display titles
  // H1: prefer english stripped, else stripped romaji
  const englishRaw = anime.title.english?.trim()
  const romajiRaw = anime.title.romaji?.trim()
  const nativeRaw = anime.title.native?.trim()

  const primary = englishRaw ? getFranchiseTitle(englishRaw) : romajiRaw ? getFranchiseTitle(romajiRaw) : ''

  // secondary lines use stripped romaji to avoid "Season 4" bleed
  const strippedRomaji = romajiRaw ? getFranchiseTitle(romajiRaw) : undefined
  // native rarely has season suffix, keep as is

  let native: string | undefined
  if (nativeRaw && nativeRaw !== primary) native = nativeRaw

  let romaji: string | undefined
  if (strippedRomaji && strippedRomaji !== primary && strippedRomaji !== native) romaji = strippedRomaji

  return { primary, ...(native ? { native } : {}), ...(romaji ? { romaji } : {}) }
}

/** Primary title only (for cards, search results compact). TV-aware stripping. */
export function getPrimaryTitle(anime: Anime): string {
  return getTitleHierarchy(anime).primary
}
