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
  studios { nodes { name } }
  format
  popularity
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

export class AniListMetadataProvider implements AnimeMetadataProvider {
  id = 'anilist-metadata' as const

  async getTrending(perPage = 12): Promise<import('../../types/anime').Anime[]> {
    type Res = { Page: { media: AniListMedia[] } }
    const data = await anilistGraphQL<Res>(TRENDING_QUERY, { perPage }, { cacheKey: `anilist:trending:${perPage}`, useCache: true })
    return mapPage(data)
  }

  async getPopular(perPage = 12): Promise<import('../../types/anime').Anime[]> {
    type Res = { Page: { media: AniListMedia[] } }
    const data = await anilistGraphQL<Res>(POPULAR_QUERY, { perPage }, { cacheKey: `anilist:popular:${perPage}`, useCache: true })
    return mapPage(data)
  }

  async getAiring(perPage = 12): Promise<import('../../types/anime').Anime[]> {
    type Res = { Page: { media: AniListMedia[] } }
    const data = await anilistGraphQL<Res>(AIRING_QUERY, { perPage }, { cacheKey: `anilist:airing:${perPage}`, useCache: true })
    return mapPage(data)
  }

  async getNewReleases(perPage = 12): Promise<import('../../types/anime').Anime[]> {
    type Res = { Page: { media: AniListMedia[] } }
    const data = await anilistGraphQL<Res>(NEW_RELEASES_QUERY, { perPage }, { cacheKey: `anilist:new:${perPage}`, useCache: true })
    return mapPage(data)
  }

  async getAnime(id: string): Promise<import('../../types/anime').Anime> {
    const anilistId = id.startsWith('anilist-') ? Number(id.replace('anilist-', '')) : Number(id)
    if (Number.isNaN(anilistId)) throw new ProviderError('NOT_FOUND', 'We couldn’t find that anime.', false)
    type Res = { Media: AniListMedia }
    const data = await anilistGraphQL<Res>(MEDIA_QUERY, { id: anilistId }, { cacheKey: `anilist:anime:${anilistId}`, useCache: true })
    if (!data.Media) throw new ProviderError('NOT_FOUND', 'We couldn’t find that anime.', false)
    return mapAniListMediaToAnime(data.Media)
  }

  async search(query: string, perPage = 12): Promise<import('../../types/anime').Anime[]> {
    if (!query.trim()) return []
    type Res = { Page: { media: AniListMedia[] } }
    const data = await anilistGraphQL<Res>(SEARCH_QUERY, { search: query.trim(), perPage }, { cacheKey: `anilist:search:${query.trim().toLowerCase()}:${perPage}`, useCache: true })
    return mapPage(data)
  }
}

export const anilistMetadataProvider = new AniListMetadataProvider()
