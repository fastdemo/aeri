import type { TrackingProvider } from '../anilist/provider'

export class MALProvider implements TrackingProvider {
  id: 'mal' = 'mal'
  async getUser(_token: string) { throw new Error('Not implemented — Phase 4') }
  async getAnimeList() { return [] }
  async updateProgress() {}
  async updateStatus() {}
  async search() { return [] }
}
