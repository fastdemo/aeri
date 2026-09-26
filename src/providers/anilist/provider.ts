import { anilistGraphQL, clearAnilistMemoryCache } from '../../services/anilist/client'
import { deleteCache } from '../../storage/db'
import { ProviderError } from '../../services/anilist/errors'
import {
  aeriStatusToAnilist,
  mapAniListMediaToAnime,
  mapAniListEntryToAeri,
  type AniListMedia,
  type AniListMediaListEntryRaw,
} from '../../services/anilist/mapper'
import { getAnilistToken } from '../../storage/anilist'
import type { Anime, AnimeListEntry, AnimeStatus } from '../../types/anime'

export interface AniListUser {
  id: number
  name: string
  avatar?: { large?: string } | null
  bannerImage?: string | null
}

export interface TrackingProvider {
  id: 'anilist' | 'mal'
  getUser(token?: string): Promise<AniListUser>
  getAnimeList(token?: string): Promise<AnimeListEntry[]>
  getAnime(id: string): Promise<Anime>
  search(query: string): Promise<Anime[]>
  updateProgress(id: string, episode: number, isManga?: boolean): Promise<void>
  updateStatus(id: string, status: AnimeStatus, isManga?: boolean): Promise<void>
  updateRating(id: string, rating: number, isManga?: boolean): Promise<void>
}

// Queries
const VIEWER_QUERY = `
query {
  Viewer {
    id
    name
    avatar { large }
    bannerImage
  }
}
`

/**
 * Convert our 0-10 score into the user's AniList scoring format.
 * POINT_100: 8 → 80 · POINT_5: 8 → 4 · POINT_10/POINT_10_DECIMAL: 8 → 8.
 * Unknown format: raw passthrough. 0 always means unrated.
 */
export function toAnilistScore(rating: number, format: string | null): number {
  if (rating <= 0) return 0
  switch (format) {
    case 'POINT_100': return Math.round(rating * 10)
    case 'POINT_5': return Math.max(1, Math.min(5, Math.round(rating / 2)))
    case 'POINT_10':
    case 'POINT_10_DECIMAL':
    default:
      return format === 'POINT_10' ? Math.round(rating) : rating
  }
}

const MEDIA_LIST_COLLECTION_QUERY = `
query ($userId: Int!, $type: MediaType) {
  MediaListCollection(userId: $userId, type: $type) {
    lists {
      name
      isCustomList
      entries {
        id
        mediaId
        status
        progress
        score
        updatedAt
        media {
          id
          idMal
          type
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
          relations {
            edges {
              relationType
              node {
                id
                title { romaji english native }
                format
                status
                episodes
                coverImage { extraLarge large medium }
                bannerImage
              }
            }
          }
        }
      }
    }
  }
}
`

const MEDIA_QUERY = `
query ($id: Int) {
  Media(id: $id, type: ANIME) {
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
    relations {
      edges {
        relationType
        node {
          id
          title { romaji english native }
          format
          status
          episodes
          coverImage { extraLarge large medium }
          bannerImage
        }
      }
    }
  }
}
`

const SEARCH_QUERY = `
query ($search: String, $perPage: Int) {
  Page(perPage: $perPage) {
    media(search: $search, type: ANIME) {
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
      relations {
        edges {
          relationType
          node {
            id
            title { romaji english native }
            format
            status
            episodes
            coverImage { extraLarge large medium }
            bannerImage
          }
        }
      }
    }
  }
}
`

const SAVE_MEDIA_LIST_ENTRY = `
mutation ($mediaId: Int, $id: Int, $status: MediaListStatus, $progress: Int, $score: Float) {
  SaveMediaListEntry(mediaId: $mediaId, id: $id, status: $status, progress: $progress, score: $score) {
    id
    status
    progress
    score
  }
}
`

const DELETE_MEDIA_LIST_ENTRY = `
mutation ($id: Int) {
  DeleteMediaListEntry(id: $id) {
    deleted
  }
}
`

export class AniListProvider implements TrackingProvider {
  id: 'anilist' = 'anilist' as const

  private ensureToken(token?: string | null): string {
    const t = token ?? getAnilistToken()
    if (!t) throw new ProviderError('AUTH', 'Not connected to AniList. Connect in My List.', false)
    return t
  }

  async getUser(token?: string): Promise<AniListUser> {
    const t = this.ensureToken(token)
    type Res = { Viewer: AniListUser }
    const data = await anilistGraphQL<Res>(VIEWER_QUERY, {}, { token: t, cacheKey: `anilist:viewer`, useCache: true })
    if (!data.Viewer) throw new ProviderError('AUTH', 'Session expired. Reconnect to AniList.', false)
    return data.Viewer
  }

  async getAnimeList(token?: string): Promise<AnimeListEntry[]> {
    const t = this.ensureToken(token)
    // Need viewer id first (cached)
    const viewer = await this.getUser(t)
    type Res = {
      MediaListCollection: {
        lists: { name: string; isCustomList: boolean; entries: AniListMediaListEntryRaw[] }[]
      } | null
    }
    // Anime + manga lists: same shape, progress = episodes/chapters.
    // Fetched in parallel; manga entries carry MANGA mediaType at map time.
    const cacheKeyA = `anilist:list:${viewer.id}`
    const cacheKeyM = `anilist:list:manga:${viewer.id}`
    const [aData, mData] = await Promise.all([
      anilistGraphQL<Res>(
        MEDIA_LIST_COLLECTION_QUERY,
        { userId: viewer.id, type: 'ANIME' },
        { token: t, cacheKey: cacheKeyA, useCache: true },
      ),
      anilistGraphQL<Res>(
        MEDIA_LIST_COLLECTION_QUERY,
        { userId: viewer.id, type: 'MANGA' },
        { token: t, cacheKey: cacheKeyM, useCache: true },
      ).catch(() => null),
    ])
    const lists = [...(aData.MediaListCollection?.lists ?? []), ...(mData?.MediaListCollection?.lists ?? [])]
    const entries: AnimeListEntry[] = []
    for (const list of lists) {
      // Include custom lists too per docs — already iterating all
      for (const e of list.entries) {
        const mapped = mapAniListEntryToAeri(e)
        if (mapped) entries.push(mapped)
      }
    }
    // De-duplicate by internalId? AniList separates lists but custom may duplicate; keep first occurrence
    const seen = new Set<string>()
    const deduped: AnimeListEntry[] = []
    for (const e of entries) {
      const id = e.anime.identity.internalId
      if (seen.has(id)) continue
      seen.add(id)
      deduped.push(e)
    }
    return deduped
  }

  async getAnime(id: string): Promise<Anime> {
    // id may be internalId anilist-123 or raw 123
    const anilistId = id.startsWith('anilist-') ? Number(id.replace('anilist-', '')) : Number(id)
    if (Number.isNaN(anilistId)) throw new ProviderError('NOT_FOUND', 'We couldn’t find that anime.', false)
    const cacheKey = `anilist:anime:${anilistId}`
    type Res = { Media: AniListMedia }
    // No auth required for media fetch, but use token if available
    const t = getAnilistToken()
    const data = await anilistGraphQL<Res>(MEDIA_QUERY, { id: anilistId }, { token: t ?? undefined, cacheKey, useCache: true })
    if (!data.Media) throw new ProviderError('NOT_FOUND', 'We couldn’t find that anime.', false)
    return mapAniListMediaToAnime(data.Media)
  }

  async search(query: string): Promise<Anime[]> {
    const t = getAnilistToken()
    type Res = { Page: { media: AniListMedia[] } }
    const data = await anilistGraphQL<Res>(SEARCH_QUERY, { search: query, perPage: 12 }, { token: t ?? undefined, useCache: true, cacheKey: `anilist:search:${query.toLowerCase()}` })
    return (data.Page.media ?? []).map((m) => mapAniListMediaToAnime(m, 'ANIME'))
  }

  // Helpers to find existing list entry id
  private async findEntryIdForMedia(mediaId: number, token: string): Promise<number | null> {
    // Try to locate existing entry via user's list — use cached list if possible, otherwise query single?
    // For simplicity, fetch user's list and find
    try {
      const list = await this.getAnimeList(token)
      const found = list.find((e) => e.anime.identity.anilistId === mediaId)
      // Need entry id — we lost it in mapping? Extend mapping to include entry id? We'll need to store entry id via anime identity? Better to refetch with entry id map
      // For now, we re-query MediaList with specific media query to get entry id via mediaListEntry
      if (found) {
        // Re-query media to get mediaListEntry
        const q = `
          query ($mediaId: Int) {
            Media(id: $mediaId, type: ANIME) {
              mediaListEntry { id status progress }
            }
          }
        `
        type R = { Media: { mediaListEntry: { id: number } | null } }
        const r = await anilistGraphQL<R>(q, { mediaId }, { token, useCache: false })
        return r.Media.mediaListEntry?.id ?? null
      }
    } catch {}
    return null
  }

  async updateProgress(id: string, episode: number): Promise<void> {
    const t = this.ensureToken()
    const anilistId = this.toAnilistId(id)
    // Need to find existing entry id or create via mediaId
    // First try to get entry id
    const entryId = await this.findEntryIdForMedia(anilistId, t).catch(() => null)

    let mutationId: any = {}
    if (entryId) {
      mutationId = { id: entryId, progress: episode }
    } else {
      mutationId = { mediaId: anilistId, progress: episode, status: 'CURRENT' }
    }

    await anilistGraphQL(SAVE_MEDIA_LIST_ENTRY, mutationId, { token: t, useCache: false })
    // Invalidate list cache (memory + IDB) so the follow-up loadList in the
    // context reads the just-written server state, not a 24h IDB snapshot.
    clearAnilistMemoryCache()
    try { await deleteCache(`anilist:list:${(await this.getUser(t).catch(() => null))?.id ?? ''}`).catch(() => {}) } catch {}
  }

  async updateStatus(id: string, status: AnimeStatus): Promise<void> {
    const t = this.ensureToken()
    const anilistId = this.toAnilistId(id)
    const anilistStatus = aeriStatusToAnilist(status)
    const entryId = await this.findEntryIdForMedia(anilistId, t).catch(() => null)
    const vars: any = entryId ? { id: entryId, status: anilistStatus } : { mediaId: anilistId, status: anilistStatus }
    await anilistGraphQL(SAVE_MEDIA_LIST_ENTRY, vars, { token: t, useCache: false })
    clearAnilistMemoryCache()
    try { await deleteCache(`anilist:list:${(await this.getUser(t).catch(() => null))?.id ?? ''}`).catch(() => {}) } catch {}
    try { await deleteCache(`anilist:list:manga:${(await this.getUser(t).catch(() => null))?.id ?? ''}`).catch(() => {}) } catch {}
  }

  /**
   * Remove the entry from the user's list entirely (AniList
   * DeleteMediaListEntry). No-op when the title isn't in the list.
   */
  async removeEntry(id: string): Promise<void> {
    const t = this.ensureToken()
    const anilistId = this.toAnilistId(id)
    const entryId = await this.findEntryIdForMedia(anilistId, t).catch(() => null)
    if (!entryId) return
    await anilistGraphQL(DELETE_MEDIA_LIST_ENTRY, { id: entryId }, { token: t, useCache: false })
    clearAnilistMemoryCache()
    try { await deleteCache(`anilist:list:${(await this.getUser(t).catch(() => null))?.id ?? ''}`).catch(() => {}) } catch {}
    try { await deleteCache(`anilist:list:manga:${(await this.getUser(t).catch(() => null))?.id ?? ''}`).catch(() => {}) } catch {}
  }

  async updateRating(id: string, rating: number): Promise<void> {
    const t = this.ensureToken()
    const anilistId = this.toAnilistId(id)
    // AniList stores score in the USER's scoring format (POINT_100 = 0-100,
    // POINT_10_DECIMAL = 0-10 float, POINT_10 = 0-10 int, POINT_5 = 0-5).
    // Convert our 0-10 value into that format so the write round-trips;
    // the read path (mapper) normalizes >10 back by /10.
    const format = await this.getScoreFormat(t).catch(() => null)
    const score = toAnilistScore(rating, format)
    const entryId = await this.findEntryIdForMedia(anilistId, t).catch(() => null)
    const vars: any = entryId ? { id: entryId, score } : { mediaId: anilistId, score, status: 'COMPLETED' }
    await anilistGraphQL(SAVE_MEDIA_LIST_ENTRY, vars, { token: t, useCache: false })
    clearAnilistMemoryCache()
    try { await deleteCache(`anilist:list:${(await this.getUser(t).catch(() => null))?.id ?? ''}`).catch(() => {}) } catch {}
  }

  private toAnilistId(id: string): number {
    if (id.startsWith('anilist-')) return Number(id.replace('anilist-', ''))
    const n = Number(id)
    if (!Number.isNaN(n)) return n
    throw new ProviderError('NOT_FOUND', 'We couldn’t find that anime.', false)
  }

  /** The user's score-format preference (drives write conversion). Cached;
      failures return null (caller falls back to raw 0-10). */
  private scoreFormatCache: { value: string | null; expiry: number } | null = null
  private async getScoreFormat(token: string): Promise<string | null> {
    if (this.scoreFormatCache && this.scoreFormatCache.expiry > Date.now()) return this.scoreFormatCache.value
    type R = { Viewer: { mediaListOptions?: { scoreFormat?: string | null } | null } | null }
    const r = await anilistGraphQL<R>(
      `query { Viewer { mediaListOptions { scoreFormat } } }`,
      {},
      { token, useCache: false },
    ).catch(() => null)
    const value = r?.Viewer?.mediaListOptions?.scoreFormat ?? null
    this.scoreFormatCache = { value, expiry: Date.now() + 1000 * 60 * 60 }
    return value
  }
}

// Singleton for app use
export const aniListProvider = new AniListProvider()
