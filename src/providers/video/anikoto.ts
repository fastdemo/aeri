import type { Anime } from '../../types/anime'
import type { VideoProvider, VideoEpisode, VideoSourceEnhanced, ProviderCapabilities } from './types'
import { cachedFetch, isCorsError } from './base'

export class AniKotoProvider implements VideoProvider {
  id = 'anikoto'
  name = 'AniKoto'
  capabilities: ProviderCapabilities = {
    id: 'anikoto',
    name: 'anikoto',
    displayName: 'AniKoto',
    languages: ['sub', 'dub'],
    subtitles: true,
    embed: true,
    directVideo: false,
    search: true,
    episodes: true,
    sources: true,
  }

  // Investigation 2026-08-29: fetch("https://anikoto.to/api/search?keyword=naruto") from https://fastdemo.github.io
  // → DNS ERR_NAME_NOT_RESOLVED / CORS blocked, domain not resolving or Cloudflare. No CORS headers.
  // Browser-direct impossible.

  async resolveAnimeId(anime: Anime): Promise<string | null> {
    return cachedFetch(`video:anikoto:resolve:${anime.identity.internalId}`, async () => {
      try {
        const res = await fetch(`https://anikoto.to/api/search?keyword=${encodeURIComponent(anime.title.romaji)}`)
        if (!res.ok) return null
        const json: any = await res.json().catch(() => null)
        return json?.data?.[0]?.id ?? null
      } catch (e) {
        if (isCorsError(e)) return null
        return null
      }
    })
  }

  async getEpisodes(anime: Anime): Promise<VideoEpisode[]> {
    const pid = await this.resolveAnimeId(anime)
    if (!pid) return []
    return []
  }

  async getSources(_episode: VideoEpisode): Promise<VideoSourceEnhanced[]> {
    return []
  }
}

export const aniKotoProvider = new AniKotoProvider()
