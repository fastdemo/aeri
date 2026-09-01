import type { Anime } from '../../types/anime'
import type { VideoProvider, VideoEpisode, VideoSourceEnhanced, ProviderCapabilities, ProviderAnimeMatch, SourceOptions } from './types'
import { cachedFetch, fetchWithTimeout } from './base'
import { getEffectiveVideoApiUrl } from '../../storage/preferences'

export class CustomProvider implements VideoProvider {
  id = 'custom'
  name = 'Custom'
  capabilities: ProviderCapabilities = {
    id: 'custom',
    name: 'custom',
    displayName: 'Custom Endpoint',
    languages: ['sub', 'dub'],
    subtitles: true,
    embed: true,
    directVideo: true,
    search: false,
    episodes: true,
    sources: true,
    hls: true,
    mp4: true,
  }

  private get base(): string | null {
    return getEffectiveVideoApiUrl()
  }

  async resolveAnimeId(anime: Anime): Promise<string | null> {
    const m = await this.resolveAnime(anime)
    return m?.providerAnimeId ?? null
  }

  async resolveAnime(anime: Anime): Promise<ProviderAnimeMatch | null> {
    const base = this.base
    if (!base) return null
    const anilistId = anime.identity.anilistId
    if (!anilistId) return null
    return cachedFetch(`video:custom:resolve:${anilistId}`, async () => {
      try {
        const res = await fetchWithTimeout(`${base}/api/map/${anilistId}`, {}, 3500)
        if (!res.ok) return null
        const json: any = await res.json().catch(() => null)
        const pid = json?.providerAnimeId ?? json?.data?.id ?? json?.id ?? null
        if (pid) return { providerId: 'custom', providerAnimeId: String(pid), title: json?.title }
        return null
      } catch { return null }
    })
  }

  async getEpisodes(anime: Anime, signal?: AbortSignal): Promise<VideoEpisode[]> {
    const base = this.base
    if (!base) return []
    const anilistId = anime.identity.anilistId
    if (!anilistId) return []
    return cachedFetch(`video:custom:episodes:${anilistId}`, async () => {
      try {
        const res = await fetchWithTimeout(`${base}/api/episodes/${anilistId}`, {}, 3500, signal)
        if (!res.ok) return []
        const json: any = await res.json().catch(() => null)
        const list = json?.episodes ?? json?.data ?? json?.results ?? []
        if (!Array.isArray(list)) return []
        return list.map((ep: any, idx: number) => ({
          id: `custom-${anilistId}-${ep.number ?? idx + 1}`,
          animeId: `anilist-${anilistId}`,
          number: ep.number ?? idx + 1,
          title: ep.title ?? ep.name ?? `Episode ${idx + 1}`,
          thumbnail: ep.thumbnail ?? ep.image,
          provider: 'custom',
          providerEpisodeId: String(ep.id ?? ep.providerEpisodeId ?? `${anilistId}-${ep.number ?? idx + 1}`),
          language: ep.language ?? 'sub',
          availableLanguages: ep.availableLanguages,
        })) as VideoEpisode[]
      } catch { return [] }
    })
  }

  async getSources(episode: VideoEpisode, options?: SourceOptions): Promise<VideoSourceEnhanced[]> {
    const base = this.base
    if (!base) return []
    const lang = options?.preferredLanguage ?? episode.language ?? 'sub'
    // Extract anilistId from episode.animeId or providerEpisodeId
    let anilistId: string | null = null
    const m = episode.animeId.match(/anilist-(\d+)/)
    if (m) anilistId = m[1]
    else {
      const m2 = episode.providerEpisodeId.match(/custom-(\d+)-/)
      if (m2) anilistId = m2[1]
      else {
        const m3 = episode.id.match(/(\d+)-(\d+)$/)
        if (m3) anilistId = m3[1]
      }
    }
    if (!anilistId) return []
    return cachedFetch(`video:custom:sources:${episode.providerEpisodeId}:${lang}`, async () => {
      try {
        const url = `${base}/api/sources/custom-${anilistId}-${episode.number}?language=${lang}`
        const res = await fetchWithTimeout(url, {}, 3500, options?.signal)
        if (!res.ok) return []
        const json: any = await res.json().catch(() => null)
        const sources = json?.sources ?? json?.data ?? []
        if (!Array.isArray(sources)) return []
        return sources.map((s: any) => ({
          url: s.url,
          quality: s.quality ?? 'auto',
          type: s.type ?? (s.url?.includes('.m3u8') ? 'hls' : s.embed ? 'embed' : 'mp4'),
          provider: 'custom',
          language: (s.language ?? lang) as any,
          embed: !!s.embed,
          subtitles: s.subtitles,
          headers: s.headers,
        })) as VideoSourceEnhanced[]
      } catch { return [] }
    })
  }
}

export const customProvider = new CustomProvider()
