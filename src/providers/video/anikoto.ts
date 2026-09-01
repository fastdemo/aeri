import type { Anime } from '../../types/anime'
import type { VideoProvider, VideoEpisode, VideoSourceEnhanced, ProviderCapabilities, SourceOptions } from './types'
import { cachedFetch, fetchWithTimeout } from './base'
import { getEffectiveVideoApiUrl } from '../../storage/preferences'

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

  private get base(): string | null {
    return getEffectiveVideoApiUrl()
  }

  async resolveAnimeId(anime: Anime): Promise<string | null> {
    const base = this.base
    if (!base || !anime.identity.anilistId) return null
    return cachedFetch(`video:anikoto:resolve:${anime.identity.anilistId}`, async () => {
      try {
        const res = await fetchWithTimeout(`${base}/api/map/${anime.identity.anilistId}?provider=anikoto`, {}, 3500)
        if (!res.ok) return null
        const j: any = await res.json().catch(() => null)
        return j?.providerAnimeId ?? null
      } catch { return null }
    })
  }

  async getEpisodes(anime: Anime, signal?: AbortSignal): Promise<VideoEpisode[]> {
    const base = this.base
    if (!base || !anime.identity.anilistId) return []
    return cachedFetch(`video:anikoto:episodes:${anime.identity.anilistId}`, async () => {
      try {
        const res = await fetchWithTimeout(`${base}/api/episodes/${anime.identity.anilistId}?provider=anikoto`, {}, 3500, signal)
        if (!res.ok) return []
        const j: any = await res.json().catch(() => null)
        const list = j?.episodes ?? []
        if (!Array.isArray(list)) return []
        return list.map((ep: any, idx: number) => ({
          id: ep.id ?? `anikoto-${anime.identity.anilistId}-${ep.number ?? idx + 1}`,
          animeId: anime.identity.internalId,
          number: ep.number ?? idx + 1,
          title: ep.title ?? `Episode ${ep.number ?? idx + 1}`,
          thumbnail: ep.thumbnail,
          provider: 'anikoto',
          providerEpisodeId: ep.providerEpisodeId ?? `${anime.identity.anilistId}-${ep.number ?? idx + 1}`,
          language: ep.language ?? 'sub',
          availableLanguages: ep.availableLanguages ?? ['sub', 'dub'],
        })) as VideoEpisode[]
      } catch { return [] }
    })
  }

  async getSources(episode: VideoEpisode, options?: SourceOptions): Promise<VideoSourceEnhanced[]> {
    const base = this.base
    if (!base) return []
    const lang = options?.preferredLanguage ?? episode.language ?? 'sub'
    // Extract anilistId from episode
    let anilistId: string | null = null
    const m = episode.animeId.match(/anilist-(\d+)/)
    if (m) anilistId = m[1]
    else {
      const m2 = episode.providerEpisodeId.match(/(\d+)-(\d+)$/)
      if (m2) anilistId = m2[1]
    }
    if (!anilistId) return []
    return cachedFetch(`video:anikoto:sources:${episode.providerEpisodeId}:${lang}`, async () => {
      try {
        const url = `${base}/api/sources/anikoto-${anilistId}-${episode.number}?language=${lang}&provider=anikoto`
        const res = await fetchWithTimeout(url, {}, 4000, options?.signal)
        if (!res.ok) return []
        const j: any = await res.json().catch(() => null)
        const srcs = j?.sources ?? []
        if (!Array.isArray(srcs)) return []
        return srcs.map((s: any) => ({
          url: s.url,
          type: s.type ?? (s.url?.includes('.m3u8') ? 'hls' : s.embed ? 'embed' : 'mp4'),
          quality: s.quality ?? 'auto',
          provider: 'anikoto',
          language: (s.language ?? lang) as any,
          embed: !!s.embed,
          subtitles: s.subtitles,
          headers: s.headers,
        })) as VideoSourceEnhanced[]
      } catch { return [] }
    })
  }
}

export const aniKotoProvider = new AniKotoProvider()
