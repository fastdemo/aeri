import type { Anime, Episode, VideoSource } from '../../types/anime'

export interface VideoProvider {
  id: string
  getEpisodes(anime: Anime): Promise<Episode[]>
  getSources(episode: Episode): Promise<VideoSource[]>
}

// Mock authorized provider — returns no real video, respects spec
export class MockVideoProvider implements VideoProvider {
  id = 'mock'
  async getEpisodes(anime: Anime): Promise<Episode[]> {
    const n = anime.episodes ?? 12
    return Array.from({ length: Math.min(n, 12) }, (_, i) => ({
      id: `${anime.identity.internalId}-${i + 1}`,
      animeId: anime.identity.internalId,
      number: i + 1,
      title: `Episode ${i + 1}`,
      duration: anime.duration ?? 24,
    }))
  }
  async getSources(_episode: Episode): Promise<VideoSource[]> {
    // No real source — UI shows placeholder
    return [{ url: '', quality: '1080p', type: 'mock' }]
  }
}
