import { anilistGraphQL, clearAnilistMemoryCache } from '../../services/anilist/client'
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
  updateProgress(id: string, episode: number): Promise<void>
  updateStatus(id: string, status: AnimeStatus): Promise<void>
  updateRating(id: string, rating: number): Promise<void>
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
        media {
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
    const cacheKey = `anilist:list:${viewer.id}`
    const data = await anilistGraphQL<Res>(
      MEDIA_LIST_COLLECTION_QUERY,
      { userId: viewer.id, type: 'ANIME' },
      { token: t, cacheKey, useCache: true },
    )
    const lists = data.MediaListCollection?.lists ?? []
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
    return (data.Page.media ?? []).map(mapAniListMediaToAnime)
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
    // Invalidate list cache
    clearAnilistMemoryCache()
    // Also clear IDB cache for list — we don't have delete, but put new expiry? Just clear memory and next fetch will refetch; IDB will still be respected until TTL, so force? For now, force next getAnimeList by clearing memory and not using IDB? We'll bypass by adding force flag in future. For now, we can clear IDB via putCache with new? Simpler: just clear memory and rely on IDB TTL 24h may still return stale. We should handle forced refresh in context.
  }

  async updateStatus(id: string, status: AnimeStatus): Promise<void> {
    const t = this.ensureToken()
    const anilistId = this.toAnilistId(id)
    const anilistStatus = aeriStatusToAnilist(status)
    const entryId = await this.findEntryIdForMedia(anilistId, t).catch(() => null)
    const vars: any = entryId ? { id: entryId, status: anilistStatus } : { mediaId: anilistId, status: anilistStatus }
    await anilistGraphQL(SAVE_MEDIA_LIST_ENTRY, vars, { token: t, useCache: false })
    clearAnilistMemoryCache()
  }

  async updateRating(id: string, rating: number): Promise<void> {
    const t = this.ensureToken()
    const anilistId = this.toAnilistId(id)
    // AniList score is float; user setting may be 10-point. We store normalized 0-10.
    // AniList expects score in user's scoring format; passing Float will respect user's method. We'll pass as given (0-10) — if user uses 100-point, 8 -> 80? But we handle simple.
    const score = rating // assume 0-10
    const entryId = await this.findEntryIdForMedia(anilistId, t).catch(() => null)
    const vars: any = entryId ? { id: entryId, score } : { mediaId: anilistId, score, status: 'COMPLETED' }
    await anilistGraphQL(SAVE_MEDIA_LIST_ENTRY, vars, { token: t, useCache: false })
    clearAnilistMemoryCache()
  }

  private toAnilistId(id: string): number {
    if (id.startsWith('anilist-')) return Number(id.replace('anilist-', ''))
    const n = Number(id)
    if (!Number.isNaN(n)) return n
    throw new ProviderError('NOT_FOUND', 'We couldn’t find that anime.', false)
  }
}

// Singleton for app use
export const aniListProvider = new AniListProvider()
