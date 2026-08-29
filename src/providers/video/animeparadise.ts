import type { Anime } from '../../types/anime'
import type { VideoProvider, VideoEpisode, VideoSourceEnhanced, ProviderCapabilities } from './types'
import { cachedFetch, isCorsError, fetchWithTimeout } from './base'

export class AnimeParadiseProvider implements VideoProvider {
  id = 'animeparadise'
  name = 'AnimeParadise'
  capabilities: ProviderCapabilities = {
    id: 'animeparadise',
    name: 'animeparadise',
    displayName: 'AnimeParadise',
    languages: ['sub', 'dub'],
    subtitles: true,
    embed: true,
    directVideo: false,
    search: true,
    episodes: true,
    sources: true,
  }

  // Investigation 2026-08-29 from https://fastdemo.github.io:
  // fetch("https://www.animeparadise.moe/api/search?q=naruto") → CORS blocked: No Allow-Origin, ERR_FAILED
  // No CORS headers on api.

  async resolveAnimeId(anime: Anime): Promise<string | null> {
    return cachedFetch(`video:animeparadise:resolve:${anime.identity.internalId}`, async () => {
      try {
        const res = await fetchWithTimeout(`https://www.animeparadise.moe/api/search?q=${encodeURIComponent(anime.title.romaji)}`)
        if (!res.ok) return null
        const json: any = await res.json().catch(() => null)
        return json?.data?.[0]?.id ?? null
      } catch (e) {
        if (isCorsError(e)) return null
        return null
      }
    })
  }

  async getEpisodes(_anime: Anime): Promise<VideoEpisode[]> {
    return []
  }

  async getSources(_episode: VideoEpisode): Promise<VideoSourceEnhanced[]> {
    return []
  }
}

export const animeParadiseProvider = new AnimeParadiseProvider()
