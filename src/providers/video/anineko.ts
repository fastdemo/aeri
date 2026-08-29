import type { Anime } from '../../types/anime'
import type { VideoProvider, VideoEpisode, VideoSourceEnhanced, ProviderCapabilities } from './types'
import { cachedFetch, isCorsError, fetchWithTimeout } from './base'

export class AniNekoProvider implements VideoProvider {
  id = 'anineko'
  name = 'AniNeko'
  capabilities: ProviderCapabilities = {
    id: 'anineko',
    name: 'anineko',
    displayName: 'AniNeko',
    languages: ['sub'],
    subtitles: true,
    embed: true,
    directVideo: false,
    search: true,
    episodes: true,
    sources: true,
  }

  // Investigation 2026-08-29: No stable public API docs found for anineko.to; any fetch from browser
  // would be expected to be CORS-blocked and Cloudflare-protected similar to other providers.

  async resolveAnimeId(anime: Anime): Promise<string | null> {
    return cachedFetch(`video:anineko:resolve:${anime.identity.internalId}`, async () => {
      try {
        const res = await fetchWithTimeout(`https://anineko.to/api/search?q=${encodeURIComponent(anime.title.romaji)}`)
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

export const aniNekoProvider = new AniNekoProvider()
