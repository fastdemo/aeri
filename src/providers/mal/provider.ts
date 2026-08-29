import type { TrackingProvider, AniListUser } from '../anilist/provider'
import type { Anime, AnimeListEntry } from '../../types/anime'

export class MALProvider implements TrackingProvider {
  id: 'mal' = 'mal'
  async getUser(_token?: string): Promise<AniListUser> { throw new Error('Not implemented — Phase 4') }
  async getAnimeList(_token?: string): Promise<AnimeListEntry[]> { return [] }
  async getAnime(_id: string): Promise<Anime> { throw new Error('Not implemented — Phase 4') }
  async search(_q: string): Promise<Anime[]> { return [] }
  async updateProgress(_id: string, _ep: number): Promise<void> {}
  async updateStatus(_id: string, _s: any): Promise<void> {}
  async updateRating(_id: string, _r: number): Promise<void> {}
}
