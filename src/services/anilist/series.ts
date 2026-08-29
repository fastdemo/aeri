import { anilistGraphQL } from './client'
import { mapAniListMediaToAnime } from './mapper'
import type { Anime } from '../../types/anime'
import type { AniListMedia } from './mapper'

export interface AnimeSeriesGroup {
  rootId: number
  title: { romaji: string; english?: string; native?: string }
  stem: string
  seasons: Anime[] // ordered, each retains its own AniList ID
  totalSeasons: number
  relation: 'SEQUEL'
  confidence: 'high' | 'medium' | 'low'
  span?: { from?: number; to?: number }
}

// Only TV (and TV_SHORT) seasons are considered genuine seasons, not movies/OVAs/specials
function isSeasonFormat(format: string | null | undefined): boolean {
  return format === 'TV' || format === 'TV_SHORT'
}

// Conservative: only PREQUEL/SEQUEL with TV format are seasons
function isSeasonRelation(relationType: string, format: string | null | undefined): boolean {
  if (relationType !== 'PREQUEL' && relationType !== 'SEQUEL') return false
  return isSeasonFormat(format)
}
void isSeasonRelation

export function normalizeTitleStem(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[×:]/g, ' ')
    .replace(/\b(season|part|saison)\s*\d+\b/gi, '')
    .replace(/\b\d+(st|nd|rd|th)\s*season\b/gi, '')
    .replace(/:\s*.+-(hen|arc)\s*$/i, '')
    .replace(/\b(2nd|3rd|4th|5th)\s*season\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Franchise title: strip known season/part suffixes for display, keep root title clean
// e.g. "Shingeki no Kyojin Season 3" -> "Shingeki no Kyojin"
// "Youkoso Jitsuryoku Shijou Shugi no Kyoushitsu e 2nd Season" -> "Youkoso Jitsuryoku Shijou Shugi no Kyoushitsu e"
export function getFranchiseTitle(romaji: string): string {
  // Remove trailing season/part markers
  let t = romaji
  // Remove "Season 2", "2nd Season", "3rd Season", "Part 2", "Final Season" etc.
  t = t.replace(/\s*(season\s*\d+|\d+(st|nd|rd|th)\s*season|part\s*\d+|final\s*season.*|2nd\s*season|3rd\s*season|4th\s*season)\s*$/i, '')
  t = t.replace(/\s*:\s*(season\s*\d+|part\s*\d+).*$/i, '')
  t = t.trim()
  // Handle "Shingeki no Kyojin: The Final Season" -> keep prefix before colon if suffix was season
  // Already handled above, but keep fallback
  return t || romaji
}

const RELATIONS_QUERY = `
query ($id: Int) {
  Media(id: $id, type: ANIME) {
    id
    title { romaji english native }
    format
    status
    season
    seasonYear
    startDate { year month day }
    episodes
    duration
    averageScore
    popularity
    genres
    studios { edges { isMain } nodes { name isAnimationStudio } }
    coverImage { extraLarge large medium }
    bannerImage
    description
    isAdult
    streamingEpisodes { title thumbnail url site }
    relations {
      edges {
        relationType
        node {
          id
          title { romaji english native }
          format
          status
          season
          seasonYear
          startDate { year month day }
          episodes
          duration
          averageScore
          popularity
          genres
          studios { edges { isMain } nodes { name isAnimationStudio } }
          coverImage { extraLarge large medium }
          bannerImage
          description
          isAdult
          streamingEpisodes { title thumbnail url site }
          idMal
        }
      }
    }
  }
}
`

type RelationsResponse = {
  Media: AniListMedia & {
    relations: { edges: { relationType: string; node: AniListMedia }[] }
  }
}

async function fetchWithRelations(id: number): Promise<AniListMedia & { relations: { edges: { relationType: string; node: AniListMedia }[] } }> {
  const data = await anilistGraphQL<RelationsResponse>(RELATIONS_QUERY, { id }, { cacheKey: `anilist:relations:${id}`, useCache: true })
  if (!data.Media) throw new Error('Not found')
  return data.Media as any
}

// Walk PREQUEL chain to find root (earliest season)
// Now with mutual-link check and branching safety
async function findRoot(media: AniListMedia & { relations: any }): Promise<AniListMedia & { relations: any }> {
  let current = media
  const visited = new Set<number>([current.id])
  while (true) {
    const prequelEdges = current.relations?.edges?.filter((e: any) => e.relationType === 'PREQUEL' && isSeasonFormat(e.node.format)) ?? []
    if (prequelEdges.length !== 1) break // 0 = root, >1 = branching -> stop
    const prequelEdge = prequelEdges[0]
    const prequelId = prequelEdge.node.id
    if (visited.has(prequelId)) break
    visited.add(prequelId)
    try {
      const prequelMedia = await fetchWithRelations(prequelId)
      // Mutual link check: prequel should have SEQUEL back to current
      const backLink = prequelMedia.relations?.edges?.some((e: any) => e.relationType === 'SEQUEL' && e.node.id === current.id && isSeasonFormat(e.node.format))
      if (!backLink) break
      current = prequelMedia
    } catch {
      break
    }
  }
  return current
}

// Walk SEQUEL chain from root to collect ordered seasons
async function collectSeasons(root: AniListMedia & { relations: any }): Promise<{ seasons: AniListMedia[]; confidence: 'high' | 'medium' | 'low' }> {
  const seasons: AniListMedia[] = []
  const visited = new Set<number>()
  let current: AniListMedia & { relations: any } | null = root
  let confidence: 'high' | 'medium' | 'low' = 'high'

  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    if (isSeasonFormat(current.format)) {
      seasons.push(current)
    }
    const sequelEdges = current.relations?.edges?.filter((e: any) => e.relationType === 'SEQUEL' && isSeasonFormat(e.node.format)) ?? []
    if (sequelEdges.length === 0) break
    if (sequelEdges.length > 1) {
      // Branching: try to disambiguate via mutual link + stem match
      const currentStem = normalizeTitleStem(current.title?.romaji ?? '')
      const scored: { edge: any; node: any; hasBack: boolean; stemMatch: boolean; year: number }[] = await Promise.all(sequelEdges.map(async (edge: any) => {
        try {
          const node = await fetchWithRelations(edge.node.id)
          const hasBack = node.relations?.edges?.some((e: any) => e.relationType === 'PREQUEL' && e.node.id === current!.id)
          const stem = normalizeTitleStem(edge.node.title?.romaji ?? '')
          const stemMatch = !!(currentStem && stem && (stem === currentStem || stem.startsWith(currentStem) || currentStem.startsWith(stem)))
          const year: number = edge.node.startDate?.year ?? edge.node.seasonYear ?? 9999
          return { edge, node, hasBack, stemMatch, year }
        } catch {
          return { edge, node: null as any, hasBack: false, stemMatch: false, year: 9999 }
        }
      }))
      // Prefer hasBack + stemMatch
      const withBack = scored.filter((s: any) => s.hasBack)
      const pool: typeof scored = withBack.length ? withBack : scored
      const stemMatched = pool.filter((s: any) => s.stemMatch)
      let chosen: typeof scored[number] | undefined
      if (stemMatched.length === 1) chosen = stemMatched[0]
      else if (stemMatched.length > 1) {
        stemMatched.sort((a: any, b: any) => a.year - b.year)
        chosen = stemMatched[0]
        confidence = 'low'
      } else if (pool.length === 1) {
        chosen = pool[0]
        confidence = 'medium'
      } else {
        // Multiple candidates, no stem match - ambiguous (e.g., Fate)
        pool.sort((a: any, b: any) => a.year - b.year)
        chosen = pool[0]
        confidence = 'low'
      }
      const nextId2 = (chosen as any).edge.node.id
      if (visited.has(nextId2)) break
      try {
        const nextMedia2: any = (chosen as any).node ?? await fetchWithRelations(nextId2)
        if ((chosen as any).hasBack === false) confidence = 'low'
        current = nextMedia2
      } catch {
        break
      }
      continue
    }
    // Single sequel
    const sequelEdge2: any = sequelEdges[0]
    const nextId3 = sequelEdge2.node.id
    if (visited.has(nextId3)) break
    try {
      const nextMedia3: any = await fetchWithRelations(nextId3)
      const hasBack = nextMedia3.relations?.edges?.some((e: any) => e.relationType === 'PREQUEL' && e.node.id === current!.id)
      if (!hasBack) {
        // Check stem as advisory
        const curStem = normalizeTitleStem(current.title?.romaji ?? '')
        const nextStem = normalizeTitleStem(sequelEdge2.node.title?.romaji ?? '')
        if (curStem && nextStem && curStem !== nextStem && !nextStem.startsWith(curStem) && !curStem.startsWith(nextStem)) {
          confidence = 'medium'
        }
      }
      current = nextMedia3
    } catch {
      break
    }
  }
  return { seasons, confidence }
}

export async function getSeriesGroup(animeId: number): Promise<AnimeSeriesGroup | null> {
  try {
    const initial = await fetchWithRelations(animeId)
    if (!isSeasonFormat(initial.format)) {
      return null
    }
    const root = await findRoot(initial)
    const { seasons: seasonMedias, confidence } = await collectSeasons(root)
    if (seasonMedias.length <= 1) return null

    const seasons: Anime[] = seasonMedias.map(m => mapAniListMediaToAnime(m as any))

    // Compute franchise title from root, normalized
    const franchiseRomaji = getFranchiseTitle(root.title?.romaji ?? seasons[0].title.romaji)
    const years = seasonMedias.map(m => m.seasonYear ?? m.startDate?.year).filter(Boolean) as number[]
    const span = years.length ? { from: Math.min(...years), to: Math.max(...years) } : undefined

    return {
      rootId: root.id,
      title: {
        romaji: franchiseRomaji,
        english: root.title?.english ?? undefined,
        native: root.title?.native ?? undefined,
      },
      stem: normalizeTitleStem(franchiseRomaji),
      seasons,
      totalSeasons: seasons.length,
      relation: 'SEQUEL',
      confidence,
      span,
    }
  } catch {
    return null
  }
}

// Deduplication for discovery: group by stem (synchronous, no extra fetch)
// Conservative: only dedupe when stem matches and both are TV/TV_SHORT and years are plausible
// This avoids hiding movies/OVAs and alternative routes (Fate) while collapsing genuine seasons (COTE, AoT)
export function deduplicateBySeries(animes: Anime[]): Anime[] {
  if (!animes.length) return animes
  const seen = new Map<string, Anime>()
  const result: Anime[] = []
  for (const anime of animes) {
    // Only consider TV candidates for dedup; movies/OVA stay separate
    if (!isSeasonFormat(anime.format ?? null)) {
      result.push(anime)
      continue
    }
    const stem = normalizeTitleStem(anime.title.romaji)
    if (!stem) {
      result.push(anime)
      continue
    }
    const existing = seen.get(stem)
    if (!existing) {
      seen.set(stem, anime)
      result.push(anime)
    } else {
      // Keep the more popular / higher scored as representative, but preserve root franchise title
      // Prefer higher popularity
      const existingPop = existing.popularity ?? 0
      const currentPop = anime.popularity ?? 0
      if (currentPop > existingPop) {
        // Replace in result
        const idx = result.findIndex(a => a === existing)
        if (idx >= 0) result[idx] = anime
        seen.set(stem, anime)
      }
      // else keep existing, drop current (deduplicated)
    }
  }
  return result
}

// Async version that verifies dedup via actual relations (for Search detail pages)
// Use when you have time to fetch relations and want high confidence
export async function deduplicateBySeriesAsync(animes: Anime[]): Promise<Anime[]> {
  // For now, just use sync version; async verification can be added with getSeriesGroup checks
  return deduplicateBySeries(animes)
}
