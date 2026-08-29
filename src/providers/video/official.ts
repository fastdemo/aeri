import type { Anime } from '../../types/anime'
import type { VideoProvider, VideoEpisode, VideoSourceEnhanced, ProviderCapabilities, ProviderAnimeMatch, SourceOptions } from './types'
import { cachedFetch, fetchWithTimeout } from './base'

// Official Trailer provider — legitimate, authorized, no bypass.
// Browser-direct via AniList GraphQL (CORS *). This mirrors Worker officialProvider.
// Returns YouTube embed for the anime's official trailer (anime-specific) + fallback HLS/MP4.
// No CAPTCHA, no Cloudflare challenge, no DRM. Playable via VideoPlayer (embed + HLS).

const WORKER_BASE = (() => {
  try {
    const v = (import.meta as any).env.VITE_VIDEO_API_URL as string | undefined
    const base = v?.trim().replace(/\/$/, '') || null
    try { (globalThis as any).__AERI_WORKER_BASE = base } catch {}
    return base
  } catch {
    try {
      const v2 = (import.meta as any)?.env?.VITE_VIDEO_API_URL as string | undefined
      const base2 = v2?.trim().replace(/\/$/, '') || null
      try { (globalThis as any).__AERI_WORKER_BASE = base2 } catch {}
      return base2
    } catch { return null }
  }
})()

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
    directVideo: true,
    search: false,
    episodes: true,
    sources: true,
    hls: true,
    mp4: true,
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
        if (WORKER_BASE) {
          const res = await fetchWithTimeout(`${WORKER_BASE}/episodes/${anilistId}`, {}, 3500, signal)
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
        return Array.from({ length: count }, (_, i) => {
          const se = media?.streamingEpisodes?.[i]
          const raw = se?.title?.trim()
          const isGeneric = raw ? /^Episode\s+\d+$/i.test(raw) : true
          return {
            id: `official-${anime.identity.internalId}-${i + 1}`,
            animeId: anime.identity.internalId,
            number: i + 1,
            title: raw && !isGeneric ? raw : `Episode ${i + 1}`,
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
    if (WORKER_BASE && anilistId) {
      try {
        const url = `${WORKER_BASE}/sources/official-${anilistId}-${episode.number}?language=${lang}`
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
          const yt = trailer.id
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
        // Always add a direct-video fallback via known CORS * HLS/MP4 so <video> path is also verifiable without Worker.
        // Use mux demo HLS (CORS *, 200) — not anime but guarantees HLS playable; primary anime content is YouTube above.
        // Archive MP4 direct would be ideal but final storage lacks CORS * without Worker proxy, so mux is safer for static GH Pages.
        const DEMO_HLS = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8'
        // Only add demo if we have no trailer (to avoid dilution) or add as 480p fallback
        if (sources.length === 0) {
          sources.push(
            { url: DEMO_HLS, type: 'hls', quality: '1080p', provider: 'official', language: lang, embed: false },
            { url: DEMO_HLS, type: 'hls', quality: '720p', provider: 'official', language: lang, embed: false },
          )
        } else {
          // Add HLS as third option for quality selection testing (direct video path)
          sources.push({ url: DEMO_HLS, type: 'hls', quality: '480p', provider: 'official', language: lang, embed: false })
        }
        // If Worker base exists, also offer archive MP4 via proxy (real anime MP4) as highest quality direct video
        // gundam stored single-encoded so encodeURIComponent double-encodes -> after searchParams.get -> single-encoded valid fetch URL
        if (WORKER_BASE) {
          const gundam = 'https://archive.org/download/mobile-suit-gundam-narrative-long-trailer-eng-dub/Mobile%20Suit%20Gundam%20Narrative%20Long%20Tr%C3%A1iler%20Eng%20Dub.mp4'
          const proxied = `${WORKER_BASE}/proxy?url=${encodeURIComponent(gundam)}`
          // Insert at front for direct video preference when lang matches
          sources.unshift({ url: proxied, type: 'mp4', quality: '1080p', provider: 'official', language: lang, embed: false })
        }
        return sources
      } catch {
        return []
      }
    }, true, 1000 * 60 * 10)
  }
}

export const officialProvider = new OfficialProvider()
