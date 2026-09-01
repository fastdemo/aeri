import type { Anime } from '../../types/anime'
import type { VideoProvider, VideoEpisode, VideoSourceEnhanced, ProviderCapabilities, ProviderAnimeMatch, SourceOptions } from './types'
import { cachedFetch, fetchWithTimeout } from './base'

// Miruro / aggregator backend — uses same-origin /api when deployed on Cloudflare, or VITE_VIDEO_API_URL/custom
import { getEffectiveVideoApiUrl } from '../../storage/preferences'

export class MiruroProvider implements VideoProvider {
  id = 'miruro'
  name = 'Miruro'
  capabilities: ProviderCapabilities = {
    id: 'miruro',
    name: 'miruro',
    displayName: 'Miruro',
    languages: ['sub', 'dub'],
    subtitles: true,
    embed: true,
    directVideo: true,
    search: true,
    episodes: true,
    sources: true,
    hls: true,
    mp4: true,
  }

  private get base(): string | null {
    return getEffectiveVideoApiUrl()
  }

  async resolveAnimeId(anime: Anime): Promise<string | null> {
    if (!this.base) return null
    const match = await this.resolveAnime(anime)
    return match?.providerAnimeId ?? null
  }

  async resolveAnime(anime: Anime): Promise<ProviderAnimeMatch | null> {
    if (!this.base) return null
    const anilistId = anime.identity.anilistId
    if (!anilistId) return null
    return cachedFetch(`video:miruro:resolve:${anilistId}`, async () => {
      try {
        // Try map endpoint first (AniList -> provider) — use /api prefix for Cloudflare same-origin
        const res = await fetchWithTimeout(`${this.base}/api/map/${anilistId}`, {}, 3500)
        if (!res.ok) return null
        const json: any = await res.json().catch(() => null)
        // Support various aggregator shapes: { success, data: { id } } or { providerAnimeId }
        const pid = json?.providerAnimeId ?? json?.data?.id ?? json?.id ?? null
        if (pid) return { providerId: 'miruro', providerAnimeId: String(pid), title: json?.title }
        return null
      } catch {
        return null
      }
    })
  }

  async getEpisodes(anime: Anime): Promise<VideoEpisode[]> {
    if (!this.base) return []
    const anilistId = anime.identity.anilistId
    if (!anilistId) return []
    return cachedFetch(`video:miruro:episodes:${anilistId}`, async () => {
      try {
        const res = await fetchWithTimeout(`${this.base}/api/episodes/${anilistId}`, {}, 3500)
        if (!res.ok) return []
        const json: any = await res.json().catch(() => null)
        const list = json?.episodes ?? json?.data ?? json?.results ?? []
        if (!Array.isArray(list)) return []
        return list.map((ep: any, idx: number) => ({
          id: `miruro-${anilistId}-${ep.number ?? idx + 1}`,
          animeId: `anilist-${anilistId}`,
          number: ep.number ?? idx + 1,
          title: ep.title ?? ep.name ?? `Episode ${idx + 1}`,
          thumbnail: ep.thumbnail ?? ep.image,
          provider: 'miruro',
          providerEpisodeId: String(ep.id ?? ep.providerEpisodeId ?? `${anilistId}-${ep.number ?? idx + 1}`),
          language: ep.language ?? 'sub',
          availableLanguages: ep.availableLanguages,
        })) as VideoEpisode[]
      } catch {
        return []
      }
    })
  }

  async getSources(episode: VideoEpisode, options?: SourceOptions): Promise<VideoSourceEnhanced[]> {
    if (!this.base) return []
    const lang = options?.preferredLanguage ?? episode.language ?? 'sub'
    const anilistId = episode.animeId.replace('anilist-', '')
    return cachedFetch(`video:miruro:sources:${episode.providerEpisodeId}:${lang}`, async () => {
      try {
        const url = `${this.base}/api/watch/miruro/${anilistId}/${lang}/${episode.number}`
        const res = await fetchWithTimeout(url, {}, 3500)
        if (!res.ok) return []
        const json: any = await res.json().catch(() => null)
        const sources = json?.sources ?? json?.data ?? []
        if (!Array.isArray(sources)) return []
        return sources.map((s: any) => ({
          url: s.url,
          quality: s.quality ?? 'auto',
          type: s.type ?? (s.url?.includes('.m3u8') ? 'hls' : s.embed ? 'embed' : 'mp4'),
          provider: 'miruro',
          language: (s.language ?? lang) as any,
          embed: !!s.embed,
          subtitles: s.subtitles,
          headers: s.headers,
        })) as VideoSourceEnhanced[]
      } catch {
        return []
      }
    })
  }
}

export const miruroProvider = new MiruroProvider()
