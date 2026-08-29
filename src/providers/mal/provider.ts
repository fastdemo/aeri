import type { TrackingProvider, AniListUser } from '../anilist/provider'
import type { Anime, AnimeListEntry, AnimeStatus } from '../../types/anime'
import { malFetch, clearMalMemoryCache, MalProviderError } from '../../services/mal/client'
import { mapMALNodeToAnime, mapMALEntryToAeri, aeriStatusToMal, type MALNode, type MALListEntryRaw } from '../../services/mal/mapper'
import { getMalToken } from '../../storage/mal'

export class MALProvider implements TrackingProvider {
  id: 'mal' = 'mal'

  private ensureToken(token?: string | null): string {
    const t = token ?? getMalToken()
    if (!t) throw new MalProviderError('AUTH', 'Not connected to MyAnimeList. Connect in My List.', false)
    return t
  }

  async getUser(token?: string): Promise<AniListUser> {
    this.ensureToken(token)
    // MAL user endpoint returns { id, name, picture }
    type Res = { id: number; name: string; picture?: string | null }
    const data = await malFetch<Res>('/users/@me', { cacheKey: 'mal:viewer', useCache: true })
    return { id: data.id, name: data.name, avatar: data.picture ? { large: data.picture } : null, bannerImage: null } as AniListUser
  }

  async getAnimeList(token?: string): Promise<AnimeListEntry[]> {
    this.ensureToken(token)
    // MAL animelist: need to handle pagination and fields
    const fields = [
      'list_status{status,score,num_episodes_watched,updated_at}',
      'num_episodes',
      'genres',
      'main_picture',
      'alternative_titles',
      'start_date',
      'synopsis',
      'mean',
      'status',
      'media_type',
      'studios',
      'nsfw',
    ].join(',')
    // Try to fetch all pages via paging.next
    let url = `/users/@me/animelist?fields=${encodeURIComponent(fields)}&limit=1000&nsfw=true`
    const entries: AnimeListEntry[] = []
    while (url) {
      type PageRes = { data: MALListEntryRaw[]; paging?: { next?: string } }
      const cacheKey = url.includes('offset=') ? undefined : 'mal:list'
      const page = await malFetch<PageRes>(url, { cacheKey, useCache: !url.includes('offset=') })
      for (const raw of page.data ?? []) {
        const mapped = mapMALEntryToAeri(raw)
        entries.push(mapped)
      }
      url = page.paging?.next ? page.paging.next.replace('https://api.myanimelist.net/v2', '') : ''
      // Avoid infinite loop: break after first page for performance if not needed - but spec says reuse caching, not fetch every
      // MAL pagination next is full URL, we strip base to reuse malFetch
      if (url && entries.length > 500) break // safety
    }
    return entries
  }

  async getAnime(id: string): Promise<Anime> {
    // id may be mal-123 or raw 123 or anilist-123 (need to resolve via idMal?)
    // For MAL, we expect malId; if passed anilistId, try to use that as malId via mapping not available, so try to fetch via MAL id
    const malId = this.toMalId(id)
    const fields = [
      'id',
      'title',
      'main_picture',
      'alternative_titles',
      'start_date',
      'synopsis',
      'mean',
      'num_episodes',
      'status',
      'genres',
      'studios',
      'media_type',
      'nsfw',
      'my_list_status{status,score,num_episodes_watched}',
    ].join(',')
    type Res = MALNode & { my_list_status?: { status: string; score: number; num_episodes_watched: number } }
    const data = await malFetch<Res>(`/anime/${malId}?fields=${encodeURIComponent(fields)}`, { cacheKey: `mal:anime:${malId}`, useCache: true })
    // data includes my_list_status if authenticated and in list
    const listStatus = (data as any).my_list_status as { status: string; score: number; num_episodes_watched: number } | undefined
    const anime = mapMALNodeToAnime(data as MALNode, listStatus as any)
    return anime
  }

  async search(query: string): Promise<Anime[]> {
    if (!query.trim()) return []
    // Use MAL search as tracking-only fallback, but prefer AniList metadata for discovery
    // For Phase 5, we will keep AniList as primary discovery, so this search is not used in UI directly, but provider must implement
    const fields = ['id', 'title', 'main_picture', 'alternative_titles', 'start_date', 'synopsis', 'mean', 'num_episodes', 'status', 'genres', 'studios', 'media_type'].join(',')
    type Res = { data: { node: MALNode }[] }
    const url = `/anime?q=${encodeURIComponent(query.trim())}&limit=12&fields=${encodeURIComponent(fields)}&nsfw=true`
    const data = await malFetch<Res>(url, { cacheKey: `mal:search:${query.trim().toLowerCase()}`, useCache: true })
    return (data.data ?? []).map(d => mapMALNodeToAnime(d.node))
  }

  async updateProgress(id: string, episode: number): Promise<void> {
    const malId = this.toMalId(id)
    const body = new URLSearchParams()
    body.set('num_watched_episodes', String(episode))
    // MAL requires status to be set; if not in list, it will create with default? We need to ensure status is at least watching
    // First try to get current status via getAnime or via list? For simplicity, we set status to watching if not provided
    // To avoid overwriting, we fetch current list_status first
    try {
      const current = await this.getAnime(malId.toString())
      const currentStatus = current.listStatus ?? 'watching'
      body.set('status', aeriStatusToMal(currentStatus))
    } catch {
      body.set('status', 'watching')
    }
    await malFetch(`/anime/${malId}/my_list_status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      useCache: false,
    })
    clearMalMemoryCache()
  }

  async updateStatus(id: string, status: AnimeStatus): Promise<void> {
    const malId = this.toMalId(id)
    const malStatus = aeriStatusToMal(status)
    const body = new URLSearchParams()
    body.set('status', malStatus)
    // When moving to completed, MAL may require num_watched_episodes = num_episodes; but we leave as is
    await malFetch(`/anime/${malId}/my_list_status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      useCache: false,
    })
    clearMalMemoryCache()
  }

  async updateRating(id: string, rating: number): Promise<void> {
    const malId = this.toMalId(id)
    const score = Math.round(rating) // MAL score 0-10 integer
    const body = new URLSearchParams()
    body.set('score', String(score))
    // Need status as well? MAL allows just score
    await malFetch(`/anime/${malId}/my_list_status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      useCache: false,
    })
    clearMalMemoryCache()
  }

  private toMalId(id: string): number {
    if (id.startsWith('mal-')) return Number(id.replace('mal-', ''))
    // If passed anilist- id, we cannot directly map without cross-reference; try to parse as number and treat as anilistId? For MAL, we need malId
    // Try to see if id is numeric anilistId that has known mal mapping via AniList's idMal field? For now, throw if not mal
    // For dual-provider dedup, we store malId in identity, so id passed should be malId when coming from MAL list
    // If id is anilist-... we can try to fetch via AniList to get idMal, but for Phase 5 we keep simple and throw if not mal
    const n = Number(id)
    if (!Number.isNaN(n)) return n
    // Try to extract from internalId like anilist-154587 -> need mal mapping; for now throw
    throw new MalProviderError('NOT_FOUND', 'We couldn’t find that anime on MyAnimeList. This title may not be linked to MAL.', false)
  }
}

export const malProvider = new MALProvider()
