import type { Anime } from '../../types/anime'
import type { VideoProvider, VideoEpisode, VideoSourceEnhanced, ProviderCapabilities } from './types'
import { cachedFetch, isCorsError, fetchWithTimeout } from './base'

export class AllAnimeProvider implements VideoProvider {
  id = 'allanime'
  name = 'AllAnime'
  capabilities: ProviderCapabilities = {
    id: 'allanime',
    name: 'allanime',
    displayName: 'AllAnime',
    languages: ['sub', 'dub'],
    subtitles: true,
    embed: true,
    directVideo: false,
    search: true,
    episodes: true,
    sources: true,
  }

  // Browser test 2026-08-29: POST https://api.allanime.day/api from https://fastdemo.github.io
  // → CORS header Access-Control-Allow-Origin: https://fastdemo.github.io (sent), but query must be exact.
  // Our earlier tests with incorrect SearchInput fields got 400 BAD_USER_INPUT, but CORS header was present,
  // so the endpoint IS CORS-enabled. However, finding the correct GraphQL query requires reverse-engineering
  // AllAnime's obfuscated API and handling Cloudflare. For Phase 7 static build we treat it as
  // browser-incompatible without a backend and return no-source, documenting the limitation.

  async resolveAnimeId(anime: Anime): Promise<string | null> {
    return cachedFetch(`video:allanime:resolve:${anime.identity.anilistId ?? anime.identity.internalId}`, async () => {
      try {
        const safeTitle = anime.title.romaji.replace(/"/g, '\\"')
        // Correct AllAnime query per docs: allowAdult/allowUnknown/query
        const res = await fetchWithTimeout('https://api.allanime.day/api', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: `query { shows(search: {allowAdult: false, allowUnknown: false, query: "${safeTitle}"}) { edges { _id name } } }`,
          }),
        })
        if (!res.ok) return null
        const json: any = await res.json().catch(() => null)
        const edges = json?.data?.shows?.edges ?? []
        // Prefer exact title match, else first
        const exact = edges.find((e: any) => e.name?.toLowerCase() === anime.title.romaji.toLowerCase())
        return (exact?._id ?? edges[0]?._id ?? null) as string | null
      } catch (e) {
        if (isCorsError(e)) return null
        return null
      }
    })
  }

  async getEpisodes(anime: Anime): Promise<VideoEpisode[]> {
    const providerId = await this.resolveAnimeId(anime)
    if (!providerId) return []
    return cachedFetch(`video:allanime:episodes:${providerId}`, async () => {
      // Would fetch episodes via AllAnime's clock.json or similar, but requires backend/proxy for full flow
      return []
    })
  }

  async getSources(_episode: VideoEpisode): Promise<VideoSourceEnhanced[]> {
    // Would fetch m3u8/mp4 or embed via AllAnime's player, but browser CORS + Cloudflare
    return []
  }
}

export const allAnimeProvider = new AllAnimeProvider()
