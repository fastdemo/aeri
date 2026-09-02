import { anilistGraphQL } from '../../services/anilist/client'
import { mapAniListMediaToAnime, type AniListMedia } from '../../services/anilist/mapper'
import { ProviderError } from '../../services/anilist/errors'
import type { AnimeMetadataProvider } from './types'

const MEDIA_FIELDS = `
  id
  idMal
  title { romaji english native }
  description
  coverImage { extraLarge large medium }
  bannerImage
  startDate { year month day }
  season
  seasonYear
  episodes
  duration
  status
  averageScore
  genres
  studios { edges { isMain } nodes { name isAnimationStudio } }
  format
  popularity
  streamingEpisodes { title thumbnail url site }
  nextAiringEpisode { airingAt timeUntilAiring episode }
  airingSchedule { nodes { airingAt episode } }
  isAdult
`

function buildPageQuery(sort: string, extra?: string): string {
  // extra can include status filter etc
  return `
  query ($perPage: Int) {
    Page(perPage: $perPage) {
      media(type: ANIME, isAdult: false, sort: ${sort} ${extra ?? ''}) {
        ${MEDIA_FIELDS}
      }
    }
  }`
}

const TRENDING_QUERY = buildPageQuery('TRENDING_DESC')
const POPULAR_QUERY = buildPageQuery('POPULARITY_DESC')
const AIRING_QUERY = buildPageQuery('POPULARITY_DESC', ', status: RELEASING')
const NEW_RELEASES_QUERY = buildPageQuery('START_DATE_DESC', ', status: FINISHED')
const UPCOMING_QUERY = buildPageQuery('POPULARITY_DESC', ', status: NOT_YET_RELEASED')
const FINISHED_QUERY = buildPageQuery('END_DATE_DESC', ', status: FINISHED')

const MEDIA_QUERY = `
query ($id: Int) {
  Media(id: $id, type: ANIME) {
    ${MEDIA_FIELDS}
  }
}
`

const SEARCH_QUERY = `
query ($search: String, $perPage: Int) {
  Page(perPage: $perPage) {
    media(search: $search, type: ANIME, isAdult: false) {
      ${MEDIA_FIELDS}
    }
  }
}
`

function mapPage(res: { Page: { media: AniListMedia[] } }): ReturnType<typeof mapAniListMediaToAnime>[] {
  return (res.Page.media ?? []).map(mapAniListMediaToAnime)
}

export interface BrowseParams {
  sort?: 'TRENDING_DESC' | 'POPULARITY_DESC' | 'SCORE_DESC' | 'START_DATE_DESC' | 'END_DATE_DESC'
  status?: 'RELEASING' | 'NOT_YET_RELEASED' | 'FINISHED' | 'CANCELLED' | 'HIATUS'
  genre?: string
  seasonYear?: number
  season?: 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL'
  format?: 'TV' | 'MOVIE' | 'OVA' | 'SPECIAL' | 'ONA' | 'MUSIC'
  perPage?: number
  page?: number
}

function buildBrowseQuery(params: BrowseParams): { query: string; variables: Record<string, any>; cacheKey: string } {
  const { sort = 'POPULARITY_DESC', status, genre, seasonYear, season, format, perPage = 24, page = 1 } = params
  const filters: string[] = ['type: ANIME', 'isAdult: false', `sort: ${sort}`]
  if (status) filters.push(`status: ${status}`)
  if (genre) filters.push(`genre: "${genre}"`)
  if (seasonYear) filters.push(`seasonYear: ${seasonYear}`)
  if (season) filters.push(`season: ${season}`)
  if (format) filters.push(`format: ${format}`)
  const filterStr = filters.join(', ')
  const query = `
  query ($perPage: Int, $page: Int) {
    Page(perPage: $perPage, page: $page) {
      pageInfo { hasNextPage currentPage lastPage total }
      media(${filterStr}) {
        ${MEDIA_FIELDS}
      }
    }
  }`
  const variables = { perPage, page }
  const keyParts = [sort, status || '', genre || '', seasonYear || '', season || '', format || '', perPage, page].join(':')
  return { query, variables, cacheKey: `anilist:browse:${keyParts}` }
}

export class AniListMetadataProvider implements AnimeMetadataProvider {
  id = 'anilist-metadata' as const

  async getTrending(perPage = 12, signal?: AbortSignal): Promise<import('../../types/anime').Anime[]> {
    type Res = { Page: { media: AniListMedia[] } }
    const data = await anilistGraphQL<Res>(TRENDING_QUERY, { perPage }, { cacheKey: `anilist:trending:${perPage}`, useCache: true, signal })
    return mapPage(data)
  }

  async getPopular(perPage = 12, signal?: AbortSignal): Promise<import('../../types/anime').Anime[]> {
    type Res = { Page: { media: AniListMedia[] } }
    const data = await anilistGraphQL<Res>(POPULAR_QUERY, { perPage }, { cacheKey: `anilist:popular:${perPage}`, useCache: true, signal })
    return mapPage(data)
  }

  async getAiring(perPage = 12, signal?: AbortSignal): Promise<import('../../types/anime').Anime[]> {
    type Res = { Page: { media: AniListMedia[] } }
    const data = await anilistGraphQL<Res>(AIRING_QUERY, { perPage }, { cacheKey: `anilist:airing:${perPage}`, useCache: true, signal })
    return mapPage(data)
  }

  async getNewReleases(perPage = 12, signal?: AbortSignal): Promise<import('../../types/anime').Anime[]> {
    type Res = { Page: { media: AniListMedia[] } }
    const data = await anilistGraphQL<Res>(NEW_RELEASES_QUERY, { perPage }, { cacheKey: `anilist:new:${perPage}`, useCache: true, signal })
    return mapPage(data)
  }

  async getUpcoming(perPage = 12, signal?: AbortSignal): Promise<import('../../types/anime').Anime[]> {
    type Res = { Page: { media: AniListMedia[] } }
    const data = await anilistGraphQL<Res>(UPCOMING_QUERY, { perPage }, { cacheKey: `anilist:upcoming:${perPage}`, useCache: true, signal })
    return mapPage(data)
  }

  async getFinished(perPage = 12, signal?: AbortSignal): Promise<import('../../types/anime').Anime[]> {
    type Res = { Page: { media: AniListMedia[] } }
    const data = await anilistGraphQL<Res>(FINISHED_QUERY, { perPage }, { cacheKey: `anilist:finished:${perPage}`, useCache: true, signal })
    return mapPage(data)
  }

  async browse(params: BrowseParams, signal?: AbortSignal): Promise<{ data: import('../../types/anime').Anime[]; hasNextPage: boolean; pageInfo: { currentPage: number; lastPage?: number } }> {
    const { query, variables, cacheKey } = buildBrowseQuery(params)
    type Res = { Page: { media: AniListMedia[]; pageInfo: { hasNextPage: boolean; currentPage: number; lastPage: number; total: number } } }
    const data = await anilistGraphQL<Res>(query, variables, { cacheKey, useCache: true, signal })
    return { data: mapPage(data), hasNextPage: !!data.Page.pageInfo?.hasNextPage, pageInfo: { currentPage: data.Page.pageInfo?.currentPage ?? params.page ?? 1, lastPage: data.Page.pageInfo?.lastPage } }
  }

  async getAnime(id: string, signal?: AbortSignal): Promise<import('../../types/anime').Anime> {
    const anilistId = id.startsWith('anilist-') ? Number(id.replace('anilist-', '')) : Number(id)
    if (Number.isNaN(anilistId)) throw new ProviderError('NOT_FOUND', 'We couldn’t find that anime.', false)
    type Res = { Media: AniListMedia }
    const data = await anilistGraphQL<Res>(MEDIA_QUERY, { id: anilistId }, { cacheKey: `anilist:anime:${anilistId}`, useCache: true, signal })
    if (!data.Media) throw new ProviderError('NOT_FOUND', 'We couldn’t find that anime.', false)
    return mapAniListMediaToAnime(data.Media)
  }

  async search(query: string, perPage = 12, signal?: AbortSignal): Promise<import('../../types/anime').Anime[]> {
    if (!query.trim()) return []
    type Res = { Page: { media: AniListMedia[] } }
    const data = await anilistGraphQL<Res>(SEARCH_QUERY, { search: query.trim(), perPage }, { cacheKey: `anilist:search:${query.trim().toLowerCase()}:${perPage}`, useCache: true, signal })
    return mapPage(data)
  }
}

export const anilistMetadataProvider = new AniListMetadataProvider()
