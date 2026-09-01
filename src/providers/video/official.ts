import type { Anime } from '../../types/anime'
import type { VideoProvider, VideoEpisode, VideoSourceEnhanced, ProviderCapabilities, ProviderAnimeMatch, SourceOptions } from './types'
import { cachedFetch, fetchWithTimeout } from './base'

// Official Trailer provider — legitimate, authorized, no bypass.
// Browser-direct via AniList GraphQL (CORS *). This mirrors Worker officialProvider.
// Returns YouTube embed for the anime's official trailer (anime-specific) + fallback HLS/MP4.
// No CAPTCHA, no Cloudflare challenge, no DRM. Playable via VideoPlayer (embed + HLS).

import { getEffectiveVideoApiUrl } from '../../storage/preferences'

const WORKER_BASE = (() => {
  try {
    const base = getEffectiveVideoApiUrl()?.replace(/\/$/, '') || null
    try { (globalThis as any).__AERI_WORKER_BASE = base } catch {}
    return base
  } catch { return null }
})()

function getWorkerBase(): string | null {
  try { return getEffectiveVideoApiUrl()?.replace(/\/$/, '') || null } catch { return WORKER_BASE }
}

export class OfficialProvider implements VideoProvider {
  id = 'official'
  name = 'OfficialTrailer'
  capabilities: ProviderCapabilities = {
    id: 'official',
    name: 'official',
    displayName: 'Official Trailer',
    languages: ['sub', 'dub'],
    subtitles: false,
    embed: true,
    directVideo: false,
    search: false,
    episodes: true,
    sources: true,
    hls: false,
    mp4: false,
  }

  async resolveAnimeId(anime: Anime): Promise<string | null> {
    const m = await this.resolveAnime(anime)
    return m?.providerAnimeId ?? null
  }

  async resolveAnime(anime: Anime): Promise<ProviderAnimeMatch | null> {
    const anilistId = anime.identity.anilistId
    if (!anilistId) return null
    return { providerId: 'official', providerAnimeId: String(anilistId), title: anime.title.romaji }
  }

  async getEpisodes(anime: Anime, signal?: AbortSignal): Promise<VideoEpisode[]> {
    // Authoritative via AniList episodes/streamingEpisodes (no external mapping). Cached.
    const anilistId = anime.identity.anilistId
    if (anilistId) {
      try {
        // Prefer Worker if available for consistency, else browser direct
        const base = getWorkerBase()
        if (base) {
          const res = await fetchWithTimeout(`${base}/api/episodes/${anilistId}`, {}, 3500, signal)
          if (res.ok) {
            const j: any = await res.json().catch(() => null)
            const list = j?.episodes ?? []
            if (Array.isArray(list) && list.length) {
              return list.map((ep: any) => ({
                id: ep.id ?? `official-${anilistId}-${ep.number}`,
                animeId: anime.identity.internalId,
                number: ep.number,
                title: ep.title,
                thumbnail: ep.thumbnail,
                provider: 'official',
                providerEpisodeId: ep.providerEpisodeId ?? `official-${anilistId}-${ep.number}`,
                language: (ep.language ?? 'sub') as any,
                availableLanguages: ep.availableLanguages ?? ['sub', 'dub'],
              })) as VideoEpisode[]
            }
          }
        }
      } catch {}
    }
    // Fallback to AniList direct
    return cachedFetch(`video:official:episodes:${anime.identity.internalId}`, async () => {
      try {
        const res = await fetchWithTimeout('https://graphql.anilist.co', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: `query($id:Int){ Media(id:$id,type:ANIME){ episodes streamingEpisodes{title thumbnail} } }`,
            variables: { id: anilistId },
          }),
          signal,
        }, 4000, signal)
        if (!res.ok) return []
        const j: any = await res.json().catch(() => null)
        const media = j?.data?.Media
        const count: number = media?.episodes ?? media?.streamingEpisodes?.length ?? 0
        if (!count) return []
        // When episodes is null (e.g., One Piece), streaming may be global offset (130..62). Don't use offset titles for local EP1.
        const isEpisodesUnknown = media?.episodes == null
        return Array.from({ length: count }, (_, i) => {
          const se = media?.streamingEpisodes?.[i]
          const raw = se?.title?.trim()
          const isGeneric = raw ? /^Episode\s+\d+$/i.test(raw) : true
          const title = (isEpisodesUnknown || !raw || isGeneric) ? `Episode ${i + 1}` : raw
          return {
            id: `official-${anime.identity.internalId}-${i + 1}`,
            animeId: anime.identity.internalId,
            number: i + 1,
            title,
            thumbnail: se?.thumbnail,
            provider: 'official',
            providerEpisodeId: `official-${anilistId ?? anime.identity.internalId}-${i + 1}`,
            language: 'sub' as const,
            availableLanguages: ['sub', 'dub'] as const,
          }
        }) as VideoEpisode[]
      } catch {
        return []
      }
    })
  }

  async getSources(episode: VideoEpisode, options?: SourceOptions): Promise<VideoSourceEnhanced[]> {
    const lang = options?.preferredLanguage ?? (episode.language as any) ?? 'sub'
    const signal = options?.signal
    // Derive anilistId from episode.animeId or providerEpisodeId
    let anilistId: number | null = null
    const m = episode.animeId.match(/anilist-(\d+)/)
    if (m) anilistId = Number(m[1])
    else {
      const m2 = episode.providerEpisodeId.match(/official-(\d+)-/)
      if (m2) anilistId = Number(m2[1])
      else if (/^\d+$/.test(episode.animeId)) anilistId = Number(episode.animeId)
    }
    // If we still don't have anilistId, try to extract from id like official-1-1
    if (!anilistId) {
      const m3 = episode.id.match(/(\d+)-(\d+)$/)
      if (m3) anilistId = Number(m3[1])
    }

    // Try Worker first if available — it returns YouTube embed + proxied Archive MP4 (playable MP4 via /proxy)
    const workerBaseForSources = getWorkerBase()
    if (workerBaseForSources && anilistId) {
      try {
        const url = `${workerBaseForSources}/api/sources/official-${anilistId}-${episode.number}?language=${lang}`
        const res = await fetchWithTimeout(url, {}, 4000, signal)
        if (res.ok) {
          const j: any = await res.json().catch(() => null)
          const srcs = j?.sources ?? []
          if (Array.isArray(srcs) && srcs.length) {
            return srcs.map((s: any) => ({
              url: s.url,
              type: s.type ?? (s.url.includes('.m3u8') ? 'hls' : s.embed ? 'embed' : 'mp4'),
              quality: s.quality ?? 'auto',
              provider: 'official',
              language: (s.language ?? lang) as any,
              embed: !!s.embed,
              subtitles: s.subtitles,
              headers: s.headers,
            })) as VideoSourceEnhanced[]
          }
        }
      } catch {
        // fall through to browser-direct
      }
    }

    // Browser-direct: AniList trailer -> YouTube embed (anime-specific, playable via iframe)
    // This path is used on GH Pages when VITE_VIDEO_API_URL not set, and also as fallback.
    if (!anilistId) return []

    return cachedFetch(`video:official:sources:${anilistId}:${episode.number}:${lang}`, async () => {
      try {
        const res = await fetchWithTimeout('https://graphql.anilist.co', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: `query($id:Int){ Media(id:$id,type:ANIME){ trailer{id site} } }`,
            variables: { id: anilistId },
          }),
          signal,
        }, 3500, signal)
        if (!res.ok) return []
        const j: any = await res.json().catch(() => null)
        const trailer = j?.data?.Media?.trailer
        const sources: VideoSourceEnhanced[] = []
        if (trailer?.site === 'youtube' && trailer.id) {
          const yt = String(trailer.id).trim()
          if (!yt) return sources
          sources.push({
            url: `https://www.youtube-nocookie.com/embed/${yt}?rel=0&modestbranding=1`,
            type: 'embed',
            quality: '1080p',
            provider: 'official',
            language: lang,
            embed: true,
          })
          sources.push({
            url: `https://www.youtube.com/embed/${yt}?rel=0`,
            type: 'embed',
            quality: '720p',
            provider: 'official',
            language: lang,
            embed: true,
          })
        }
        // No unrelated Archive fallback in production — only anime-specific YouTube trailer is honest.
        // Previously returned Gundam/Sintel MP4s which are unrelated to the requested anime and violate full-episode contract.
        // Keep only YouTube embeds here; Worker proxy for Archive is disabled for honesty.
        // In dev, allow mux demo HLS for local HLS testing without Worker
        if (import.meta.env.DEV && sources.length === 0) {
          const DEMO_HLS = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8'
          sources.push(
            { url: DEMO_HLS, type: 'hls', quality: '1080p', provider: 'official', language: lang, embed: false },
            { url: DEMO_HLS, type: 'hls', quality: '720p', provider: 'official', language: lang, embed: false },
          )
        }
        return sources
      } catch {
        return []
      }
    }, true, 1000 * 60 * 10)
  }
}

export const officialProvider = new OfficialProvider()
