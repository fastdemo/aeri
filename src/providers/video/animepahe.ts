import type { Anime } from '../../types/anime'
import type { VideoProvider, VideoEpisode, VideoSourceEnhanced, ProviderCapabilities, SourceOptions } from './types'
import { cachedFetch, fetchWithTimeout } from './base'
import { getEffectiveVideoApiUrl } from '../../storage/preferences'

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

  private get base(): string | null {
    return getEffectiveVideoApiUrl()
  }

  async resolveAnimeId(anime: Anime): Promise<string | null> {
    const base = this.base
    if (!base || !anime.identity.anilistId) return null
    return cachedFetch(`video:animepahe:resolve:${anime.identity.anilistId}`, async () => {
      try {
        const res = await fetchWithTimeout(`${base}/map/${anime.identity.anilistId}?provider=animepahe`, {}, 3500)
        if (!res.ok) return null
        const j: any = await res.json().catch(() => null)
        return j?.providerAnimeId ?? null
      } catch { return null }
    })
  }

  async getEpisodes(anime: Anime, signal?: AbortSignal): Promise<VideoEpisode[]> {
    const base = this.base
    if (!base || !anime.identity.anilistId) return []
    return cachedFetch(`video:animepahe:episodes:${anime.identity.anilistId}`, async () => {
      try {
        const res = await fetchWithTimeout(`${base}/episodes/${anime.identity.anilistId}?provider=animepahe`, {}, 3500, signal)
        if (!res.ok) return []
        const j: any = await res.json().catch(() => null)
        const list = j?.episodes ?? []
        if (!Array.isArray(list)) return []
        return list.map((ep: any, idx: number) => ({
          id: ep.id ?? `animepahe-${anime.identity.anilistId}-${ep.number ?? idx + 1}`,
          animeId: anime.identity.internalId,
          number: ep.number ?? idx + 1,
          title: ep.title ?? `Episode ${ep.number ?? idx + 1}`,
          thumbnail: ep.thumbnail,
          provider: 'animepahe',
          providerEpisodeId: ep.providerEpisodeId ?? `${anime.identity.anilistId}-${ep.number ?? idx + 1}`,
          language: 'sub',
          availableLanguages: ['sub'],
        })) as VideoEpisode[]
      } catch { return [] }
    })
  }

  async getSources(episode: VideoEpisode, options?: SourceOptions): Promise<VideoSourceEnhanced[]> {
    const base = this.base
    if (!base) return []
    if (options?.preferredLanguage === 'dub') return []
    let anilistId: string | null = null
    const m = episode.animeId.match(/anilist-(\d+)/)
    if (m) anilistId = m[1]
    if (!anilistId) return []
    return cachedFetch(`video:animepahe:sources:${episode.providerEpisodeId}:sub`, async () => {
      try {
        const url = `${base}/sources/animepahe-${anilistId}-${episode.number}?language=sub&provider=animepahe`
        const res = await fetchWithTimeout(url, {}, 5000, options?.signal)
        if (!res.ok) return []
        const j: any = await res.json().catch(() => null)
        const srcs = j?.sources ?? []
        if (!Array.isArray(srcs)) return []
        return srcs.map((s: any) => ({
          url: s.url,
          type: s.type ?? (s.url?.includes('.m3u8') ? 'hls' : s.embed ? 'embed' : 'mp4'),
          quality: s.quality ?? 'auto',
          provider: 'animepahe',
          language: 'sub' as const,
          embed: !!s.embed,
          subtitles: s.subtitles,
          headers: s.headers,
        })) as VideoSourceEnhanced[]
      } catch { return [] }
    })
  }
}

export const animePaheProvider = new AnimePaheProvider()
