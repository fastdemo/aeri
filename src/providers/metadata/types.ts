import type { Anime } from '../../types/anime'

export interface AnimeMetadataProvider {
  id: string
  getAnime(id: string): Promise<Anime>
  search(query: string, perPage?: number): Promise<Anime[]>
  getTrending(perPage?: number): Promise<Anime[]>
  getPopular(perPage?: number): Promise<Anime[]>
  getAiring(perPage?: number): Promise<Anime[]>
  getNewReleases(perPage?: number): Promise<Anime[]>
  getUpcoming(perPage?: number): Promise<Anime[]>
  getFinished(perPage?: number): Promise<Anime[]>
  browse(params: { sort?: string; status?: string; genre?: string; seasonYear?: number; season?: string; format?: string; perPage?: number; page?: number }): Promise<{ data: Anime[]; hasNextPage: boolean; pageInfo: { currentPage: number; lastPage?: number } }>
}
