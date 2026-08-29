import type { Anime, AnimeListEntry, AnimeStatus } from '../../types/anime'

// AniList GraphQL types (partial)
export interface AniListTitle {
  romaji?: string | null
  english?: string | null
  native?: string | null
}

export interface AniListMedia {
  id: number
  idMal?: number | null
  title: AniListTitle
  description?: string | null
  coverImage?: { large?: string | null; extraLarge?: string | null; medium?: string | null } | null
  bannerImage?: string | null
  startDate?: { year?: number | null; month?: number | null; day?: number | null } | null
  season?: string | null
  seasonYear?: number | null
  episodes?: number | null
  duration?: number | null
  status?: string | null // FINISHED, RELEASING, NOT_YET_RELEASED etc
  averageScore?: number | null // 0-100
  genres?: string[] | null
  studios?: { nodes?: { name: string }[] | null } | null
  format?: string | null // TV, MOVIE etc
  popularity?: number | null
}

export interface AniListMediaListEntryRaw {
  id: number // list entry id
  mediaId: number
  status?: string | null // CURRENT, COMPLETED, PLANNING, PAUSED, DROPPED, REPEATING
  progress?: number | null
  score?: number | null // raw float
  scoreRaw?: number | null
  media?: AniListMedia | null
}

export function anilistStatusToAeri(status: string | null | undefined): AnimeStatus {
  switch (status) {
    case 'CURRENT':
    case 'REPEATING':
      return 'watching'
    case 'COMPLETED':
      return 'completed'
    case 'PLANNING':
      return 'planned'
    case 'PAUSED':
      return 'on_hold'
    case 'DROPPED':
      return 'dropped'
    default:
      return 'planned'
  }
}

export function aeriStatusToAnilist(status: AnimeStatus): string {
  switch (status) {
    case 'watching': return 'CURRENT'
    case 'completed': return 'COMPLETED'
    case 'planned': return 'PLANNING'
    case 'on_hold': return 'PAUSED'
    case 'dropped': return 'DROPPED'
    default: return 'CURRENT'
  }
}

function cleanDescription(html?: string | null): string {
  if (!html) return ''
  // AniList description is HTML with <br> and <i> etc. Strip tags for Aeri
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?i>/gi, '')
    .replace(/<\/?b>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .trim()
    .slice(0, 900)
}

export function mapAniListMediaToAnime(media: AniListMedia): Anime {
  const title = {
    romaji: media.title?.romaji ?? `Anime ${media.id}`,
    english: media.title?.english ?? undefined,
    native: media.title?.native ?? undefined,
  }
  const cover = media.coverImage?.extraLarge ?? media.coverImage?.large ?? media.coverImage?.medium ?? ''
  // Banner fallback to cover if missing — hero expects landscape
  const banner = media.bannerImage ?? cover

  const year = media.seasonYear ?? media.startDate?.year ?? undefined
  const season = media.season ?? undefined

  // averageScore is 0-100, convert to 0-10
  const rating = media.averageScore ? Math.round((media.averageScore / 10) * 10) / 10 : undefined

  return {
    identity: {
      internalId: `anilist-${media.id}`,
      anilistId: media.id,
      malId: media.idMal ?? undefined,
    },
    title,
    description: cleanDescription(media.description),
    coverImage: cover,
    backdropImage: banner,
    bannerImage: banner,
    year,
    season,
    episodes: media.episodes ?? undefined,
    duration: media.duration ?? undefined,
    status: media.status ?? undefined,
    rating,
    genres: media.genres ?? [],
    studios: media.studios?.nodes?.map((n) => n.name).filter(Boolean) ?? [],
    format: media.format ?? undefined,
    popularity: media.popularity ?? undefined,
  }
}

export function mapAniListEntryToAeri(entry: AniListMediaListEntryRaw): AnimeListEntry | null {
  if (!entry.media) return null
  const anime = mapAniListMediaToAnime(entry.media)
  const status = anilistStatusToAeri(entry.status)
  const progress = entry.progress ?? 0
  const episodes = anime.episodes ?? 0
  const percent = episodes > 0 ? Math.round((progress / episodes) * 100) : progress > 0 ? 50 : 0

  // attach progress to anime for continue watching UI
  anime.progress = { episode: progress, percent }
  anime.inList = true
  anime.listStatus = status

  // score: AniList returns 0-10 or 0-100 depending user setting; we pass through 0-10 normalized if >10 divide
  let score: number | undefined = undefined
  if (entry.score != null && entry.score > 0) {
    score = entry.score > 10 ? Math.round((entry.score / 10) * 10) / 10 : entry.score
  }

  return {
    anime,
    status,
    progress,
    score,
  }
}

// For hero/backdrop fallback, ensure at least one image
export function ensureAnimeImages(a: Anime): Anime {
  if (!a.backdropImage && a.coverImage) a.backdropImage = a.coverImage
  if (!a.coverImage && a.backdropImage) a.coverImage = a.backdropImage
  return a
}
