import { anilistGraphQL, anilistCachePut, getAnilistStats } from '../../services/anilist/client'
import { mapAniListMediaToAnime, type AniListMedia } from '../../services/anilist/mapper'
import { matchKnownGenre } from '../../lib/genres'
import { rankSearchResults } from '../../lib/searchRank'
import { ProviderError } from '../../services/anilist/errors'
import type { AnimeMetadataProvider } from './types'
import { getCachedAnime, putCachedAnime } from '../../services/anilist/animeCache'

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
  chapters
  volumes
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
  relations {
    edges {
      relationType
      node {
        id
        title { romaji english native }
        format
        status
        episodes
        chapters
        volumes
        coverImage { extraLarge large medium }
        bannerImage
      }
    }
  }
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

/**
 * HOME FEED. Home used to fire FOUR separate page queries carrying the full
 * detail field set — description HTML, every relation edge, streaming
 * episodes, airing schedule — for a page that only paints tiles. Measured
 * against the live API on 2026-10-25:
 *
 *   old: 4 requests · ~967 KB · ~2.0 s wall (and 4 slots of the burst limit)
 *   new: 1 request  · ~134 KB · ~1.4 s wall
 *
 * The four rails ride ONE aliased request under a single cache key. Fields
 * are exactly what a card/hero render needs; `description` stays for the
 * hero. Relations and streaming episodes are NOT here — detail pages fetch
 * the full record, and `getAnime` requires relations in a shared record, so
 * these light records are never published to the shared media cache (see
 * `mapHomePage`).
 */
const HOME_CARD_FIELDS = `
  id
  idMal
  type
  title { romaji english native }
  description
  coverImage { extraLarge large medium }
  bannerImage
  startDate { year }
  season
  seasonYear
  episodes
  chapters
  volumes
  duration
  status
  averageScore
  genres
  format
  popularity
`

function buildHomeRail(sort: string, extra?: string): string {
  return `media(type: ANIME, isAdult: false, sort: ${sort}${extra ?? ''}) {
        ${HOME_CARD_FIELDS}
      }`
}

const HOME_FEED_QUERY = `
  query ($perPage: Int) {
    trending: Page(perPage: $perPage) { ${buildHomeRail('TRENDING_DESC')} }
    popular: Page(perPage: $perPage) { ${buildHomeRail('POPULARITY_DESC')} }
    airing: Page(perPage: $perPage) { ${buildHomeRail('POPULARITY_DESC', ', status: RELEASING')} }
    newReleases: Page(perPage: $perPage) { ${buildHomeRail('START_DATE_DESC', ', status: FINISHED')} }
  }
`

export interface HomeFeed {
  trending: import('../../types/anime').Anime[]
  popular: import('../../types/anime').Anime[]
  airing: import('../../types/anime').Anime[]
  newReleases: import('../../types/anime').Anime[]
}


const MEDIA_QUERY = `
query ($id: Int) {
  Media(id: $id, type: ANIME) {
    ${MEDIA_FIELDS}
    trailer { id site }
  }
}
`

// Manga catalogue extensions: staff (authors/artists), tags, endDate.
// Requested ONLY on the manga detail query — page/search queries skip
// them (same cache key shape, no extra requests on rails). Absent on
// anime records by construction.
const MANGA_CATALOGUE_FIELDS = `
  staff { edges { role node { name { full } } } }
  tags { name rank }
  endDate { year month day }
`

const MEDIA_MANGA_QUERY = `
query ($id: Int) {
  Media(id: $id, type: MANGA) {
    ${MEDIA_FIELDS}
    ${MANGA_CATALOGUE_FIELDS}
  }
}
`

// BY-MAL LOOKUPS ARE TYPE-SCOPED IN BOTH THE QUERY AND THE CACHE KEY. MAL ids
// and AniList anime/manga ids are three separate numeric spaces; a number can
// be a valid animal id AND manga id in AniList simultaneously. Anime entries
// must never resolve a MAL lookup to a manga work (or vice versa) — separate
// queries AND separate `anilist:bymal:{kind}:<id>` keys keep that boundary.
const MEDIA_BY_MAL_QUERY = `
query ($malId: Int) {
  Media(idMal: $malId, type: ANIME) {
    ${MEDIA_FIELDS}
    trailer { id site }
  }
}
`

const MEDIA_MANGA_BY_MAL_QUERY = `
query ($malId: Int) {
  Media(idMal: $malId, type: MANGA) {
    ${MEDIA_FIELDS}
  }
}
`

// BATCHED BY-MAL LOOKUPS (D111): ONE
// request per ≤50-id chunk resolves the ENTIRE tracker list, instead of one
// request per entry (which crawled through the rate limit and let throttled
// shows vanish — the continue row appeared late and incomplete). An id ABSENT
// from a chunk that completed is a DEFINITIVE
// non-mapping — the filter matched and found nothing — not a failure, so the
// negative is seeded under the same kind-scoped per-id key (24h, like every
// cache) and the entry can keep a stable identity until AniList maps it.
// Field parity with the per-id queries keeps seeded records indistinguishable:
// anime carry trailer, manga carry the catalogue extension (staff/tags/endDate)
// so seeded records fully serve detail pages too.
const MEDIA_BY_MAL_BATCH_ANIME_QUERY = `
query ($ids: [Int]) {
  Page(perPage: 50) {
    media(idMal_in: $ids, type: ANIME) {
      ${MEDIA_FIELDS}
      trailer { id site }
    }
  }
}
`

const MEDIA_BY_MAL_BATCH_MANGA_QUERY = `
query ($ids: [Int]) {
  Page(perPage: 50) {
    media(idMal_in: $ids, type: MANGA) {
      ${MEDIA_FIELDS}
      ${MANGA_CATALOGUE_FIELDS}
    }
  }
}
`

const SEARCH_QUERY = `
query ($search: String, $perPage: Int) {
  Page(perPage: $perPage) {
    media(search: $search, isAdult: false) {
      ${MEDIA_FIELDS}
    }
  }
}
`

function mapPage(res: { Page: { media: AniListMedia[] } }, mediaType?: 'ANIME' | 'MANGA'): ReturnType<typeof mapAniListMediaToAnime>[] {
  // HOME RULE: TV + MOVIE only. Home rows consume hook data directly
  // (bypassing any page-level pool), so the filter lives HERE at
  // ingestion — every consumer (home rows, hero, pools) inherits it.
  // OVA/ONA/SPECIAL/MUSIC never appear on Home (Continue Watching is the
  // only exempt surface). MANGA-type queries are unaffected. Format comes
  // straight from the provider record — no title-specific hacks.
  const out = (res.Page.media ?? [])
    .filter((m) => mediaType === 'MANGA' || ['TV', 'MOVIE'].includes(((m as AniListMedia).format ?? '').toUpperCase()))
    .map((m) => mapAniListMediaToAnime(m, mediaType))
  // Page results are full media records (relations included): publish each
  // to the shared cache so later detail visits cost zero network AND still
  // get Related Shows/Manga. Records without relation edges are NOT
  // published — a stale relations-less entry would hide related sections.
  for (const a of out) {
    if (a.identity.anilistId && (a.relations?.edges?.length ?? 0) > 0) putCachedAnime(a.identity.anilistId, a)
  }
  return out
}

/**
 * Home rails use the light card field set (no relations, no streaming
 * episodes). Same TV+MOVIE ingestion rule as `mapPage`, but these records
 * are NOT published to the shared media cache: a relations-less record would
 * either be ignored by detail reads (they require relations) or, worse, be
 * mistaken for a complete one later. Detail/warm-up fetches own that cache.
 */
function mapHomePage(res: { media: AniListMedia[] } | undefined): import('../../types/anime').Anime[] {
  return (res?.media ?? [])
    .filter((m) => ['TV', 'MOVIE'].includes((m.format ?? '').toUpperCase()))
    .map((m) => mapAniListMediaToAnime(m, 'ANIME'))
}

export interface BrowseParams {
  sort?: 'TRENDING_DESC' | 'POPULARITY_DESC' | 'SCORE_DESC' | 'START_DATE_DESC' | 'END_DATE_DESC'
  status?: 'RELEASING' | 'NOT_YET_RELEASED' | 'FINISHED' | 'CANCELLED' | 'HIATUS'
  genre?: string
  seasonYear?: number
  season?: 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL'
  format?: 'TV' | 'MOVIE' | 'OVA' | 'SPECIAL' | 'ONA' | 'MUSIC'
  // Inclusive start-year range (FuzzyDateInt bounds) for presets like "90s".
  // When set, replaces the exact seasonYear filter.
  yearFrom?: number
  yearTo?: number
  perPage?: number
  page?: number
}

function buildBrowseQuery(params: BrowseParams): { query: string; variables: Record<string, any>; cacheKey: string } {
  const { sort = 'POPULARITY_DESC', status, genre, seasonYear, season, format, yearFrom, yearTo, perPage = 24, page = 1 } = params
  const filters: string[] = ['type: ANIME', 'isAdult: false', `sort: ${sort}`]
  if (status) filters.push(`status: ${status}`)
  if (genre) filters.push(`genre: "${genre}"`)
  if (yearFrom != null || yearTo != null) {
    if (yearFrom != null) filters.push(`startDate_greaterThan: ${yearFrom * 10000 + 101}`)
    if (yearTo != null) filters.push(`startDate_lesserThan: ${yearTo * 10000 + 1232}`)
  } else if (seasonYear) {
    filters.push(`seasonYear: ${seasonYear}`)
  }
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
  const keyParts = [sort, status || '', genre || '', seasonYear || '', season || '', format || '', yearFrom ?? '', yearTo ?? '', perPage, page].join(':')
  return { query, variables, cacheKey: `anilist:browse:${keyParts}` }
}

export interface BrowseMangaParams {
  sort?: 'TRENDING_DESC' | 'POPULARITY_DESC' | 'SCORE_DESC' | 'START_DATE_DESC' | 'END_DATE_DESC'
  status?: 'RELEASING' | 'NOT_YET_RELEASED' | 'FINISHED' | 'CANCELLED' | 'HIATUS'
  genre?: string
  seasonYear?: number
  format?: 'MANGA' | 'NOVEL' | 'ONE_SHOT'
  yearFrom?: number
  yearTo?: number
  perPage?: number
  page?: number
}

function buildBrowseMangaQuery(params: BrowseMangaParams): { query: string; variables: Record<string, any>; cacheKey: string } {
  const { sort = 'POPULARITY_DESC', status, genre, seasonYear, format, yearFrom, yearTo, perPage = 24, page = 1 } = params
  const filters: string[] = ['type: MANGA', 'isAdult: false', `sort: ${sort}`]
  if (status) filters.push(`status: ${status}`)
  if (genre) filters.push(`genre: "${genre}"`)
  if (yearFrom != null || yearTo != null) {
    if (yearFrom != null) filters.push(`startDate_greaterThan: ${yearFrom * 10000 + 101}`)
    if (yearTo != null) filters.push(`startDate_lesserThan: ${yearTo * 10000 + 1232}`)
  } else if (seasonYear) {
    filters.push(`startDate_greaterThan: ${seasonYear * 10000 + 101}`)
    filters.push(`startDate_lesserThan: ${seasonYear * 10000 + 1232}`)
  }
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
  const keyParts = [sort, status || '', genre || '', seasonYear || '', format || '', yearFrom ?? '', yearTo ?? '', perPage, page].join(':')
  return { query, variables, cacheKey: `anilist:browsemanga:${keyParts}` }
}

export class AniListMetadataProvider implements AnimeMetadataProvider {
  id = 'anilist-metadata' as const

  /**
   * ONE request for Home's four rails (see HOME_FEED_QUERY). Cached as a
   * single unit (`anilist:home:<perPage>`, memory 5 min + IDB 24 h) so a
   * return visit paints every row from one cache read — no request at all
   * while warm, one request when cold.
   */
  async getHomeFeed(perPage = 24, signal?: AbortSignal): Promise<HomeFeed> {
    type Res = {
      trending: { media: AniListMedia[] } | null
      popular: { media: AniListMedia[] } | null
      airing: { media: AniListMedia[] } | null
      newReleases: { media: AniListMedia[] } | null
    }
    const data = await anilistGraphQL<Res>(HOME_FEED_QUERY, { perPage }, {
      cacheKey: `anilist:home:${perPage}`,
      useCache: true,
      signal,
    })
    return {
      trending: mapHomePage(data.trending ?? undefined),
      popular: mapHomePage(data.popular ?? undefined),
      airing: mapHomePage(data.airing ?? undefined),
      newReleases: mapHomePage(data.newReleases ?? undefined),
    }
  }

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
    // Filter switches bypass the cache: a cached response for the NEW key
    // may itself be stale (older snapshot), and serving ANY cached data
    // here re-introduces the stale-grid bug (old filter's rows surviving
    // under the new filter's tab). Fresh fetch, then cache for later.
    const data = await anilistGraphQL<Res>(query, variables, { cacheKey, useCache: true, force: params.page === 1 || params.page == null, signal })
    return { data: mapPage(data), hasNextPage: !!data.Page.pageInfo?.hasNextPage, pageInfo: { currentPage: data.Page.pageInfo?.currentPage ?? params.page ?? 1, lastPage: data.Page.pageInfo?.lastPage } }
  }

  async browseManga(params: BrowseMangaParams, signal?: AbortSignal): Promise<{ data: import('../../types/anime').Anime[]; hasNextPage: boolean; pageInfo: { currentPage: number; lastPage?: number } }> {
    const { query, variables, cacheKey } = buildBrowseMangaQuery(params)
    type Res = { Page: { media: AniListMedia[]; pageInfo: { hasNextPage: boolean; currentPage: number; lastPage: number; total: number } } }
    const data = await anilistGraphQL<Res>(query, variables, { cacheKey, useCache: true, force: params.page === 1 || params.page == null, signal })
    return { data: mapPage(data, 'MANGA'), hasNextPage: !!data.Page.pageInfo?.hasNextPage, pageInfo: { currentPage: data.Page.pageInfo?.currentPage ?? params.page ?? 1, lastPage: data.Page.pageInfo?.lastPage } }
  }

  async getAnime(id: string, signal?: AbortSignal): Promise<import('../../types/anime').Anime> {
    // MAL-backed ids resolve through idMal so MAL tracker entries get full
    // AniList metadata (banner, season, studios) instead of MAL fallbacks.
    if (id.startsWith('mal-')) {
      const malId = Number(id.replace('mal-', ''))
      if (Number.isNaN(malId)) throw new ProviderError('NOT_FOUND', 'We couldn’t find that anime.', false)
      return this.getAnimeByMalId(malId, signal)
    }
    const anilistId = id.startsWith('anilist-') ? Number(id.replace('anilist-', '')) : Number(id)
    if (Number.isNaN(anilistId)) throw new ProviderError('NOT_FOUND', 'We couldn’t find that anime.', false)
    // Shared media record first — but ONLY when it carries relations.
    // Older cached entries (written before relations rode on Media queries)
    // lack them; using one would permanently hide Related Shows/Manga.
    // Fall through to network so the fresh record includes relations.
    const shared = await getCachedAnime(anilistId, 'ANIME')
    if (shared && (shared.relations?.edges?.length ?? 0) > 0) return shared
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
    type Res = { Media: AniListMedia }
    const data = await anilistGraphQL<Res>(MEDIA_QUERY, { id: anilistId }, { cacheKey: `anilist:anime:${anilistId}`, useCache: true, signal })
    if (!data.Media) throw new ProviderError('NOT_FOUND', 'We couldn’t find that anime.', false)
    const anime = mapAniListMediaToAnime(data.Media, 'ANIME')
    putCachedAnime(anilistId, anime, 'ANIME')
    return anime
  }

  async getManga(id: string, signal?: AbortSignal): Promise<import('../../types/anime').Anime> {
    // MAL-backed ids resolve through idMal, exactly like getAnime. MAL
    // tracker entries carry `internalId: mal-<malId>` (mapper.ts) and every
    // Read link is built from that internalId — without this branch
    // `Number('mal-23390')` is NaN, so /read/mal-23390/… answered "Manga not
    // found" for every signed-in MAL manga even though the detail page had
    // just listed its chapters.
    if (id.startsWith('mal-')) {
      const malId = Number(id.replace('mal-', ''))
      if (Number.isNaN(malId)) throw new ProviderError('NOT_FOUND', 'We couldn’t find that manga.', false)
      return this.getMangaByMalId(malId, signal)
    }
    const anilistId = id.startsWith('anilist-') ? Number(id.replace('anilist-', '')) : Number(id)
    if (Number.isNaN(anilistId)) throw new ProviderError('NOT_FOUND', 'We couldn’t find that manga.', false)
    // Type-scoped shared record: an anime record with the same numeric id
    // must NEVER satisfy a manga read (HxH collision). The cache itself
    // enforces the boundary; this explicit type keeps it obvious.
    const shared = await getCachedAnime(anilistId, 'MANGA')
    if (shared) return shared
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
    type Res = { Media: AniListMedia }
    // Manga detail must query type: MANGA — the ANIME query returns null for
    // manga ids (that's why the reader showed "not found"). Fail closed on
    // type: if AniList says this id is not manga-kind, reject (callers must
    // not render an anime record as manga).
    const data = await anilistGraphQL<Res>(MEDIA_MANGA_QUERY, { id: anilistId }, { cacheKey: `anilist:manga:${anilistId}`, useCache: true, signal })
    if (!data.Media) throw new ProviderError('NOT_FOUND', 'We couldn’t find that manga.', false)
    const manga = mapAniListMediaToAnime(data.Media, 'MANGA')
    const fmt = (manga.format ?? '').toUpperCase()
    if (fmt !== 'MANGA' && fmt !== 'NOVEL' && fmt !== 'ONE_SHOT') {
      throw new ProviderError('NOT_FOUND', 'That entry is an anime, not a manga.', false)
    }
    putCachedAnime(anilistId, manga, 'MANGA')
    return manga
  }

  async getAnimeByMalId(malId: number, signal?: AbortSignal): Promise<import('../../types/anime').Anime> {
    type Res = { Media: AniListMedia | null }
    const data = await anilistGraphQL<Res>(MEDIA_BY_MAL_QUERY, { malId }, { cacheKey: `anilist:bymal:anime:${malId}`, useCache: true, signal })
    if (!data.Media) throw new ProviderError('NOT_FOUND', 'We couldn’t find that anime.', false)
    return mapAniListMediaToAnime(data.Media)
  }

  /** Manga record by MAL id — tracker-manga entries resolve here. MANGA
   *  type-scoped query + `anilist:bymal:manga:` cache key: the same numeric
   *  MAL id must never satisfy the anime kind (or be satisfied by one). */
  async getMangaByMalId(malId: number, signal?: AbortSignal): Promise<import('../../types/anime').Anime> {
    type Res = { Media: AniListMedia | null }
    const data = await anilistGraphQL<Res>(MEDIA_MANGA_BY_MAL_QUERY, { malId }, { cacheKey: `anilist:bymal:manga:${malId}`, useCache: true, signal })
    if (!data.Media) throw new ProviderError('NOT_FOUND', 'We couldn’t find that manga.', false)
    return mapAniListMediaToAnime(data.Media, 'MANGA')
  }

  /**
   * BATCHED resolution for a whole tracker list (D111): resolves up to 50
   * MAL ids per request, mapping each record to the kind-scoped space and
   * seeding the per-id cache keys — positives AND definitive negatives — so
   * subsequent single lookups (`getAnimeByMalId`/`getMangaByMalId`) answer
   * from cache with zero network, and detail opens are warm.
   *
   * `onChunk` fires after each ≤50-chunk's records are mapped (list rows can
   * commit progressively while the next chunk fetches).
   *
   * THROTTLED chunks retry patient-style (cooldown-aware, ≤4 attempts) before
   * giving up; a failed chunk makes the method THROW (never a silent partial)
   * so callers fall back to the per-entry pipeline for those ids. Ids absent
   * from a SUCCESSFUL chunk are definitive non-mappings — reported as
   * `unmapped` — and their per-id key is seeded with the null Media shape
   * single lookups read back (no repeat network on later passes).
   */
  async getBatchByMalIds(
    malIds: number[],
    kind: 'anime' | 'manga',
    opts?: {
      signal?: AbortSignal
      onChunk?: (resolved: Map<number, import('../../types/anime').Anime>, unmapped: number[], kind: 'anime' | 'manga') => void
    },
  ): Promise<{ resolved: Map<number, import('../../types/anime').Anime>; unmapped: number[] }> {
    const signal = opts?.signal
    const type = kind === 'manga' ? 'MANGA' : 'ANIME'
    const query = kind === 'manga' ? MEDIA_BY_MAL_BATCH_MANGA_QUERY : MEDIA_BY_MAL_BATCH_ANIME_QUERY
    const ids = [...new Set(malIds.filter((n) => Number.isFinite(n) && n > 0))]
    const resolved = new Map<number, import('../../types/anime').Anime>()
    const unmapped: number[] = []
    if (!ids.length) return { resolved, unmapped }

    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50)
      type Res = { Page: { media: AniListMedia[] } }
      // Patient retry: a cold 429 here is the gate to the WHOLE list staying
      // hidden — worth bounded cooldown-aware retries, unlike per-entry calls.
      let data: Res | null = null
      let lastErr: unknown = null
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          data = await anilistGraphQL<Res>(query, { ids: chunk }, {
            cacheKey: `anilist:bymalbatch:${type}:${chunk.map(String).join(',')}`,
            useCache: true,
            signal,
          })
          lastErr = null
          break
        } catch (e: any) {
          if (e?.code !== 'THROTTLED' || attempt === 3) { lastErr = e; break }
          // Ignore per-caller abort during the cooldown wait — the effect
          // unmount races its own signal; the next attempt rechecks.
          const remain = (() => { try { return Math.max(0, getAnilistStats().cooldownUntil - Date.now()) } catch { return 0 } })()
          await new Promise<void>((r) => setTimeout(r, Math.min(Math.max(remain, 1500), 90_000)))
        }
      }
      if (lastErr || !data) throw lastErr ?? new ProviderError('NETWORK', 'AniList metadata could not be resolved.', true)
      const byMal = new Map<number, AniListMedia>()
      for (const m of data.Page.media ?? []) if (typeof m.idMal === 'number') byMal.set(m.idMal, m)
      const chunkResolved = new Map<number, import('../../types/anime').Anime>()
      const chunkUnmapped: number[] = []
      for (const malId of chunk) {
        const m = byMal.get(malId)
        if (m) {
          const anime = mapAniListMediaToAnime(m, type)
          if (anime.identity.anilistId) putCachedAnime(anime.identity.anilistId, anime, type)
          chunkResolved.set(malId, anime)
          // Seed the single-lookup key with the EXACT response shape the
          // per-id getter reads (`data.Media`) — later calls are cache hits.
          void anilistCachePut(`anilist:bymal:${kind}:${malId}`, { Media: m })
        } else {
          chunkUnmapped.push(malId)
          void anilistCachePut(`anilist:bymal:${kind}:${malId}`, { Media: null })
        }
      }
      for (const [k, v] of chunkResolved.entries()) resolved.set(k, v)
      for (const id of chunkUnmapped) if (!unmapped.includes(id)) unmapped.push(id)
      try { opts?.onChunk?.(chunkResolved, chunkUnmapped, kind) } catch {}
    }
    return { resolved, unmapped }
  }

  async search(query: string, perPage = 12, signal?: AbortSignal): Promise<import('../../types/anime').Anime[]> {
    const q = query.trim()
    if (!q) return []
    type Res = { Page: { media: AniListMedia[] } }
    // Title search + (when the query names a genre) a popularity-sorted genre
    // browse in parallel. Genre words otherwise return junk from title search.
    const genre = matchKnownGenre(q)
    const [titleRes, genreRes] = await Promise.all([
      anilistGraphQL<Res>(SEARCH_QUERY, { search: q, perPage }, { cacheKey: `anilist:search:${q.toLowerCase()}:${perPage}`, useCache: true, signal }),
      genre
        ? this.browse({ genre, sort: 'POPULARITY_DESC', perPage, page: 1 }, signal)
            .then((r) => r.data)
            .catch(() => [] as import('../../types/anime').Anime[])
        : Promise.resolve([] as import('../../types/anime').Anime[]),
    ])
    const seen = new Set<string>()
    const merged: import('../../types/anime').Anime[] = []
    for (const a of [...mapPage(titleRes), ...genreRes]) {
      if (seen.has(a.identity.internalId)) continue
      seen.add(a.identity.internalId)
      merged.push(a)
    }
    // Conservative order: best (exact/prefix) on top, then relevant
    // (substring, genre/studio), then the rest in AniList order.
    return rankSearchResults(q, merged).slice(0, Math.max(perPage, 12))
  }
}

export const anilistMetadataProvider = new AniListMetadataProvider()

/**
 * Patient anime lookup — the reliability upgrade for NAME surfaces. Same
 * provider `getAnime`, but THROTTLED attempts
 * (AniList 429 / burst cooldown) retry after the shared cooldown lifts,
 * up to `maxAttempts`. Other error kinds never retry (404, AUTH…). Late
 * names beat bare captions, so this is deliberately long-limbed; it is
 * for small single-record lookups ONLY (cards, modal E-line), never list
 * pages — the shared client already parks those during cooldown.
 */
export async function getAnimePatient(id: string, maxAttempts = 4): Promise<import('../../types/anime').Anime | null> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await anilistMetadataProvider.getAnime(id)
    } catch (e: any) {
      if (e?.code !== 'THROTTLED' || attempt === maxAttempts - 1) return null
      const remain = (() => {
        try { return Math.max(0, getAnilistStats().cooldownUntil - Date.now()) } catch { return 0 }
      })()
      await new Promise<void>(r => setTimeout(r, Math.min(remain + 1500, 90_000) || 4000))
    }
  }
  return null
}
