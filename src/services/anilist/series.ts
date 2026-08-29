import { anilistGraphQL } from './client'
import { mapAniListMediaToAnime } from './mapper'
import type { Anime } from '../../types/anime'
import type { AniListMedia } from './mapper'

export interface AnimeSeriesGroup {
  rootId: number
  title: { romaji: string; english?: string; native?: string }
  seasons: Anime[] // ordered, each retains its own AniList ID
  totalSeasons: number
  relation: 'SEQUEL' // the relation type used for grouping
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
async function findRoot(media: AniListMedia & { relations: any }): Promise<AniListMedia & { relations: any }> {
  let current = media
  const visited = new Set<number>([current.id])
  // Follow PREQUEL links that are TV seasons
  while (true) {
    const prequelEdge = current.relations?.edges?.find((e: any) => isSeasonRelation(e.relationType, e.node.format))
      && current.relations.edges.find((e: any) => e.relationType === 'PREQUEL' && isSeasonFormat(e.node.format))
    if (!prequelEdge) break
    const prequelId = prequelEdge.node.id
    if (visited.has(prequelId)) break
    visited.add(prequelId)
    try {
      const prequelMedia = await fetchWithRelations(prequelId)
      current = prequelMedia
    } catch {
      break
    }
  }
  return current
}

// Walk SEQUEL chain from root to collect ordered seasons
async function collectSeasons(root: AniListMedia & { relations: any }): Promise<AniListMedia[]> {
  const seasons: AniListMedia[] = []
  const visited = new Set<number>()
  let current: AniListMedia & { relations: any } | null = root

  while (current && !visited.has(current.id)) {
    visited.add(current.id)
    // Only add if it's a TV season (conservative)
    if (isSeasonFormat(current.format)) {
      seasons.push(current)
    }
    // Find next sequel that is TV
    const sequelEdge = current.relations?.edges?.find((e: any) => e.relationType === 'SEQUEL' && isSeasonFormat(e.node.format))
    if (!sequelEdge) break
    const nextId = sequelEdge.node.id
    if (visited.has(nextId)) break
    try {
      const nextMedia = await fetchWithRelations(nextId)
      current = nextMedia
    } catch {
      break
    }
  }
  return seasons
}

export async function getSeriesGroup(animeId: number): Promise<AnimeSeriesGroup | null> {
  try {
    const initial = await fetchWithRelations(animeId)
    // If initial is not a TV season, don't group (e.g., movie)
    if (!isSeasonFormat(initial.format)) {
      // Still try to find its TV parent via PARENT relation? For now, conservative: no grouping for non-TV
      return null
    }
    const root = await findRoot(initial)
    const seasonMedias = await collectSeasons(root)
    if (seasonMedias.length <= 1) return null // No multiple seasons, not a series

    // Sort by seasonYear and season if needed (already in sequel order, but ensure)
    // sequel order is already chronological, keep it
    const seasons: Anime[] = seasonMedias.map(m => mapAniListMediaToAnime(m as any))

    return {
      rootId: root.id,
      title: {
        romaji: root.title?.romaji ?? `Series ${root.id}`,
        english: root.title?.english ?? undefined,
        native: root.title?.native ?? undefined,
      },
      seasons,
      totalSeasons: seasons.length,
      relation: 'SEQUEL',
    }
  } catch {
    return null
  }
}

// For Browse/Home deduplication: given a list of Anime, group by series and return one per series (root)
// Conservative: only deduplicate when they are in same SEQUEL chain
export function deduplicateBySeries(animes: Anime[]): Anime[] {
  // For now, do not deduplicate in discovery rows — conservative grouping means we keep all
  // This function is a placeholder for future browse deduplication if needed
  // To avoid hiding legitimate movies/OVAs, we return as-is
  return animes
}
