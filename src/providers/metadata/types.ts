import type { Anime } from '../../types/anime'

export interface AnimeMetadataProvider {
  id: string
  getAnime(id: string): Promise<Anime>
  search(query: string, perPage?: number): Promise<Anime[]>
  getTrending(perPage?: number): Promise<Anime[]>
  getPopular(perPage?: number): Promise<Anime[]>
  getAiring(perPage?: number): Promise<Anime[]>
  getNewReleases(perPage?: number): Promise<Anime[]>
}
