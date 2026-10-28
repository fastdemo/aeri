import type { Anime } from '../../types/anime'
import type { VideoProvider, VideoEpisode, VideoSourceEnhanced, ProviderCapabilities, SourceOptions } from './types'
import { cachedFetch, fetchWithTimeout, hintQuery } from './base'
import { getEffectiveVideoApiUrl } from '../../storage/preferences'

/**
 * AnimeParadise anime provider — VERIFIED_WORKING 2026-10-26 (Cowboy Bebop
 * ep 1: open API search → /anime/<link> (mappings.anilist = exact identity)
 * → /anime/<_id>/episode → Next.js server-action POST on /watch/<uid> →
 * streamLink → 1448x1080 HLS master + English VTT captions).
 *
 * Sub-only: the watch payload exposes no dub fields. Everything runs in the
 * Worker (the site is a Next.js app whose source link is only obtainable via
 * a build-specific server action), and delivery goes through the signed
 * relay so the HLS tokens never reach the page.
 */
export class AnimeParadiseProvider implements VideoProvider {
  id = 'animeparadise'
  name = 'AnimeParadise'
  status = 'verified' as const
  capabilities: ProviderCapabilities = {
    id: 'animeparadise',
    name: 'animeparadise',
    displayName: 'AnimeParadise',
    languages: ['sub'],
    subtitles: true,
    embed: false,
    directVideo: true,
    search: true,
    episodes: true,
    sources: true,
    hls: true,
    mp4: false,
  }

  private get base(): string | null {
    return getEffectiveVideoApiUrl()
  }

  async resolveAnimeId(anime: Anime): Promise<string | null> {
    return anime.identity.anilistId ? String(anime.identity.anilistId) : null
  }

  async getEpisodes(anime: Anime, signal?: AbortSignal): Promise<VideoEpisode[]> {
    const base = this.base
    const anilistId = anime.identity.anilistId
    if (!base || !anilistId) return []
    const titleHint = [anime.title.romaji, anime.title.english].filter(Boolean).join('||')
    return cachedFetch(`video:animeparadise:episodes:${anilistId}`, async () => {
      try {
        const res = await fetchWithTimeout(
          `${base}/api/episodes/${anilistId}?provider=animeparadise&title=${encodeURIComponent(titleHint)}` +
            `${typeof anime.episodes === 'number' && anime.episodes > 0 ? `&episodes=${anime.episodes}` : ''}` +
            `${anime.format ? `&format=${encodeURIComponent(anime.format)}` : ''}` +
            `${typeof anime.year === 'number' && anime.year > 1900 ? `&year=${anime.year}` : ''}`,
          {},
          8000,
          signal,
        )
        if (!res.ok) return []
        const j: any = await res.json().catch(() => null)
        const list = j?.episodes ?? []
        if (!Array.isArray(list)) return []
        return list.map((ep: any, idx: number) => ({
          id: `animeparadise-${anilistId}-${ep.number ?? idx + 1}`,
          animeId: anime.identity.internalId,
          number: ep.number ?? idx + 1,
          title: ep.title ?? `Episode ${ep.number ?? idx + 1}`,
          thumbnail: ep.thumbnail,
          provider: 'animeparadise',
          providerEpisodeId: `${anilistId}-${ep.number ?? idx + 1}`,
          language: 'sub' as const,
          availableLanguages: ['sub'],
        })) as VideoEpisode[]
      } catch {
        return []
      }
    })
  }

  async getSources(episode: VideoEpisode, options?: SourceOptions): Promise<VideoSourceEnhanced[]> {
    const base = this.base
    if (!base) return []
    const lang = options?.preferredLanguage ?? episode.language ?? 'sub'
    if (lang === 'dub') return []
    const m = episode.providerEpisodeId.match(/(\d+)-(\d+)$/)
    const anilistId = m?.[1] ?? episode.animeId.match(/anilist-(\d+)/)?.[1]
    if (!anilistId) return []
    const titleHint = options?.animeTitle?.trim() || ''
    // HLS tokens are build/session scoped — always resolve fresh.
    try {
      const url = `${base}/api/sources/animeparadise-${anilistId}-${episode.number}?language=${lang}&provider=animeparadise${titleHint ? `&title=${encodeURIComponent(titleHint)}` : ''}${hintQuery(options)}`
      const res = await fetchWithTimeout(url, {}, 15000, options?.signal)
      if (!res.ok) return []
      const j: any = await res.json().catch(() => null)
      const srcs = j?.sources ?? []
      if (!Array.isArray(srcs)) return []
      return srcs.map((s: any) => ({
        url: s.url,
        type: s.type ?? 'hls',
        quality: s.quality ?? 'auto',
        provider: 'animeparadise',
        language: (s.language ?? lang) as any,
        embed: false,
        subtitles: s.subtitles,
        headers: s.headers,
      })) as VideoSourceEnhanced[]
    } catch {
      return []
    }
  }
}

export const animeParadiseProvider = new AnimeParadiseProvider()
