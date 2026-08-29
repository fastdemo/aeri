import type { Anime, AnimeListEntry, AnimeStatus } from '../../types/anime'

export interface MALAlternativeTitles {
  en?: string
  ja?: string
  synonyms?: string[]
}

export interface MALMainPicture {
  large?: string
  medium?: string
}

export interface MALNode {
  id: number
  title: string
  main_picture?: MALMainPicture | null
  alternative_titles?: MALAlternativeTitles | null
  start_date?: string | null // YYYY-MM-DD
  end_date?: string | null
  synopsis?: string | null
  mean?: number | null // 0-10
  rank?: number | null
  popularity?: number | null
  num_episodes?: number | null
  status?: string | null // finished_airing, currently_airing, not_yet_aired
  genres?: { id: number; name: string }[] | null
  studios?: { id: number; name: string }[] | null
  media_type?: string | null // tv, ova, movie etc
  nsfw?: string | null
  created_at?: string | null
  updated_at?: string | null
}

export interface MALListStatus {
  status: string // watching, completed, on_hold, dropped, plan_to_watch
  score: number // 0-10
  num_episodes_watched: number
  is_rewatching?: boolean
  updated_at?: string
  start_date?: string | null
  finish_date?: string | null
}

export interface MALListEntryRaw {
  node: MALNode
  list_status: MALListStatus
}

export interface MALUser {
  id: number
  name: string
  picture?: string | null
}

export function malStatusToAeri(s: string | null | undefined): AnimeStatus {
  switch (s) {
    case 'watching': return 'watching'
    case 'completed': return 'completed'
    case 'on_hold': return 'on_hold'
    case 'dropped': return 'dropped'
    case 'plan_to_watch': return 'planned'
    default: return 'planned'
  }
}

export function aeriStatusToMal(s: AnimeStatus): string {
  switch (s) {
    case 'watching': return 'watching'
    case 'completed': return 'completed'
    case 'planned': return 'plan_to_watch'
    case 'on_hold': return 'on_hold'
    case 'dropped': return 'dropped'
    default: return 'watching'
  }
}

function cleanSynopsis(s?: string | null): string {
  if (!s) return ''
  return s.replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim().slice(0, 900)
}

function parseYear(startDate?: string | null): number | undefined {
  if (!startDate) return undefined
  const y = Number(startDate.slice(0, 4))
  return Number.isNaN(y) ? undefined : y
}

export function mapMALNodeToAnime(node: MALNode, listStatus?: MALListStatus): Anime {
  const title = {
    romaji: node.alternative_titles?.ja ?? node.title,
    english: node.alternative_titles?.en ?? node.title,
    native: node.alternative_titles?.ja ?? undefined,
  }
  const cover = node.main_picture?.large ?? node.main_picture?.medium ?? ''
  // MAL has no banner; use cover as backdrop as fallback (will be overridden by AniList banner if merged)
  const year = parseYear(node.start_date)
  const rating = node.mean ? Math.round(node.mean * 10) / 10 : undefined // already 0-10

  const anime: Anime = {
    identity: {
      internalId: `mal-${node.id}`,
      malId: node.id,
      // anilistId may be resolved via separate mapping if available (not directly from MAL)
    },
    title,
    description: cleanSynopsis(node.synopsis),
    coverImage: cover,
    backdropImage: cover, // no banner in MAL, use cover
    bannerImage: cover,
    year,
    season: undefined, // MAL start_date season not directly
    episodes: node.num_episodes ?? undefined,
    duration: undefined, // MAL has average_episode_duration but not in list_status
    status: node.status ?? undefined,
    rating,
    genres: node.genres?.map(g => g.name) ?? [],
    studios: node.studios?.map(s => s.name) ?? [],
    format: node.media_type ?? undefined,
    popularity: node.popularity ?? undefined,
  }

  if (listStatus) {
    const status = malStatusToAeri(listStatus.status)
    const progress = listStatus.num_episodes_watched ?? 0
    const episodes = anime.episodes ?? 0
    const percent = episodes > 0 ? Math.round((progress / episodes) * 100) : progress > 0 ? 50 : 0
    anime.progress = { episode: progress, percent }
    anime.listStatus = status
    anime.inList = true
  }

  return anime
}

export function mapMALEntryToAeri(raw: MALListEntryRaw): AnimeListEntry {
  const anime = mapMALNodeToAnime(raw.node, raw.list_status)
  const status = malStatusToAeri(raw.list_status.status)
  const progress = raw.list_status.num_episodes_watched ?? 0
  const score = raw.list_status.score > 0 ? raw.list_status.score : undefined
  // Ensure anime already has progress/listStatus from map
  return {
    anime,
    status,
    progress,
    score,
  }
}

// For cross-provider dedup: MAL node may have no anilistId, but AniList media has idMal. We can use that to match.
// When we have both lists, we can match via malId.
