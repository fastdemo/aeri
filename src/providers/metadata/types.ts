import type { Anime } from '../../types/anime'

export interface AnimeMetadataProvider {
  id: string
  getAnime(id: string, signal?: AbortSignal): Promise<Anime>
  search(query: string, perPage?: number, signal?: AbortSignal): Promise<Anime[]>
  getTrending(perPage?: number, signal?: AbortSignal): Promise<Anime[]>
  getPopular(perPage?: number, signal?: AbortSignal): Promise<Anime[]>
  getAiring(perPage?: number, signal?: AbortSignal): Promise<Anime[]>
  getNewReleases(perPage?: number, signal?: AbortSignal): Promise<Anime[]>
  getUpcoming(perPage?: number, signal?: AbortSignal): Promise<Anime[]>
  getFinished(perPage?: number, signal?: AbortSignal): Promise<Anime[]>
  browse(params: { sort?: string; status?: string; genre?: string; seasonYear?: number; season?: string; format?: string; perPage?: number; page?: number }, signal?: AbortSignal): Promise<{ data: Anime[]; hasNextPage: boolean; pageInfo: { currentPage: number; lastPage?: number } }>
}
