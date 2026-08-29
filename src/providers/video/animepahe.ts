import type { Anime } from '../../types/anime'
import type { VideoProvider, VideoEpisode, VideoSourceEnhanced, ProviderCapabilities } from './types'
import { cachedFetch, isCorsError, fetchWithTimeout } from './base'

export class AnimePaheProvider implements VideoProvider {
  id = 'animepahe'
  name = 'AnimePahe'
  capabilities: ProviderCapabilities = {
    id: 'animepahe',
    name: 'animepahe',
    displayName: 'AnimePahe',
    languages: ['sub'],
    subtitles: true,
    embed: true,
    directVideo: false,
    search: true,
    episodes: true,
    sources: true,
  }

  // Investigation 2026-08-29 from https://fastdemo.github.io origin:
  // fetch("https://animepahe.ru/api?m=search&q=naruto") → CORS blocked: No 'Access-Control-Allow-Origin' header, ERR_FAILED
  // fetch("https://animepahe.su/api?m=search&q=naruto") → same CORS blocked
  // curl without Origin → 200 HTML, but browser is blocked. No CORS headers on api.*.
  // Therefore browser-direct is impossible without proxy. Documented as browser-incompatible.

  async resolveAnimeId(anime: Anime): Promise<string | null> {
    return cachedFetch(`video:animepahe:resolve:${anime.identity.anilistId ?? anime.identity.internalId}`, async () => {
      try {
        const url = `https://animepahe.ru/api?m=search&q=${encodeURIComponent(anime.title.romaji)}`
        const res = await fetchWithTimeout(url)
        if (!res.ok) return null
        const json: any = await res.json().catch(() => null)
        return json?.data?.[0]?.session ?? null
      } catch (e) {
        if (isCorsError(e)) return null
        return null
      }
    })
  }

  async getEpisodes(anime: Anime): Promise<VideoEpisode[]> {
    const pid = await this.resolveAnimeId(anime)
    if (!pid) return []
    return cachedFetch(`video:animepahe:episodes:${pid}`, async () => {
      try {
        const res = await fetchWithTimeout(`https://animepahe.ru/api?m=release&id=${encodeURIComponent(pid)}&sort=episode_asc&page=1`)
        if (!res.ok) return []
        const json: any = await res.json().catch(() => null)
        const eps = json?.data ?? []
        return eps.map((ep: any, i: number) => ({
          id: `${anime.identity.internalId}-pahe-${ep.episode ?? i + 1}`,
          animeId: anime.identity.internalId,
          number: ep.episode ?? i + 1,
          title: `Episode ${ep.episode ?? i + 1}`,
          provider: this.id,
          providerEpisodeId: String(ep.id ?? ep.session ?? i + 1),
        }))
      } catch (e) {
        if (isCorsError(e)) return []
        return []
      }
    })
  }

  async getSources(_episode: VideoEpisode): Promise<VideoSourceEnhanced[]> {
    // Would resolve kwik link to m3u8, but requires bypassing Cloudflare and CORS
    return []
  }
}

export const animePaheProvider = new AnimePaheProvider()
