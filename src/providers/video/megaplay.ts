import type { Anime } from '../../types/anime'
import type { VideoProvider, VideoEpisode, VideoSourceEnhanced, ProviderCapabilities } from './types'
import { cachedFetch, isCorsError } from './base'

export class MegaPlayProvider implements VideoProvider {
  id = 'megaplay'
  name = 'MegaPlay'
  capabilities: ProviderCapabilities = {
    id: 'megaplay',
    name: 'megaplay',
    displayName: 'MegaPlay',
    languages: ['sub', 'dub'],
    subtitles: true,
    embed: true,
    directVideo: false,
    search: true,
    episodes: true,
    sources: true,
  }

  // Investigation 2026-08-29 from https://fastdemo.github.io:
  // fetch("https://megaplay.buzz/api/search?q=naruto") → 200 CORS: * but body is HTML <title>Error - MegaPlay</title> not JSON.
  // Endpoint appears to be HTML error page, not a JSON API for browser. No documented browser API.

  async resolveAnimeId(anime: Anime): Promise<string | null> {
    return cachedFetch(`video:megaplay:resolve:${anime.identity.internalId}`, async () => {
      try {
        const res = await fetch(`https://megaplay.buzz/api/search?q=${encodeURIComponent(anime.title.romaji)}`)
        if (!res.ok) return null
        const json: any = await res.json().catch(() => null)
        if (!json || typeof json !== 'object') return null
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

export const megaPlayProvider = new MegaPlayProvider()
