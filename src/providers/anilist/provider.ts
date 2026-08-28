import type { Anime, AnimeListEntry } from '../../types/anime'

export interface TrackingProvider {
  id: 'anilist' | 'mal'
  getUser(token: string): Promise<any>
  getAnimeList(token: string): Promise<AnimeListEntry[]>
  updateProgress(id: string, episode: number): Promise<void>
  updateStatus(id: string, status: string): Promise<void>
  search(query: string): Promise<Anime[]>
}

export class AniListProvider implements TrackingProvider {
  id: 'anilist' = 'anilist'
  async getUser(_token: string) { throw new Error('Not implemented in Phase 2 — mock data') }
  async getAnimeList(_token: string): Promise<AnimeListEntry[]> { return [] }
  async updateProgress(_id: string, _ep: number) {}
  async updateStatus(_id: string, _status: string) {}
  async search(_q: string): Promise<Anime[]> { return [] }
}
