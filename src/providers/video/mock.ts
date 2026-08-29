import type { Anime } from '../../types/anime'
import type { VideoProvider, VideoEpisode, VideoSourceEnhanced, ProviderCapabilities } from './types'
import { cachedFetch } from './base'

export class MockVideoProvider implements VideoProvider {
  id = 'mock'
  name = 'Mock'
  capabilities: ProviderCapabilities = {
    id: 'mock',
    name: 'mock',
    displayName: 'Mock (No Video)',
    languages: [],
    subtitles: false,
    embed: false,
    directVideo: false,
    search: false,
    episodes: true,
    sources: false,
  }

  async resolveAnimeId(_anime: Anime): Promise<string | null> {
    return null
  }

  async getEpisodes(anime: Anime): Promise<VideoEpisode[]> {
    return cachedFetch(`video:mock:episodes:${anime.identity.internalId}`, async () => {
      // Mock is fallback for navigation only — do NOT invent count when anime.episodes is missing.
      // Return [] for null/0 to avoid arbitrary "12" / "24 cap" (One Piece would be 0 vs provider's 1123).
      // When count exists, generate full count without 24/100 cap — virtualization handles large lists.
      // Titles are generic "Episode N" which normalizeEpisodes treats as not legitimate (fallback).
      const count = anime.episodes
      if (typeof count !== 'number' || count <= 0) return []
      return Array.from({ length: count }, (_, i) => ({
        id: `${anime.identity.internalId}-${i + 1}`,
        animeId: anime.identity.internalId,
        number: i + 1,
        title: `Episode ${i + 1}`,
        duration: anime.duration ?? 24,
        provider: this.id,
        providerEpisodeId: `${anime.identity.internalId}-${i + 1}`,
      }))
    })
  }

  async getSources(_episode: VideoEpisode): Promise<VideoSourceEnhanced[]> {
    // No real source — forces no-source UI, respects "no fake video URLs in production"
    return []
  }
}

export const mockVideoProvider = new MockVideoProvider()
