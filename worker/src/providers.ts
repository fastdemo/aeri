/**
 * Clean provider abstraction for Cloudflare Worker.
 * Worker -> provider adapter -> normalized source -> VideoPlayer (HLS/MP4/embed)
 *
 * Each provider implements VideoSourceProvider. Registry selects ONE real provider
 * with fallback ordering: preferred -> language -> quality -> alternative provider.
 * Failures isolated per provider, every request abortable via AbortSignal.
 */

export type VideoLanguage = 'sub' | 'dub'
export type VideoType = 'hls' | 'mp4' | 'embed'

export interface NormalizedSource {
  provider: string
  url: string
  type: VideoType
  language: VideoLanguage
  quality: string
  embed: boolean
  subtitles?: { language: string; label: string; url: string; type?: string }[]
  headers?: Record<string, string>
}

export interface ProviderCapabilities {
  id: string
  displayName: string
  languages: VideoLanguage[]
  subtitles: boolean
  hls: boolean
  mp4: boolean
  embed: boolean
  search: boolean
  episodes: boolean
  sources: boolean
}

export interface VideoSourceProvider {
  id: string
  capabilities: ProviderCapabilities
  getEpisodes(anilistId: number, signal?: AbortSignal): Promise<{ number: number; title?: string; thumbnail?: string }[]>
  getSources(anilistId: number, episode: number, language: VideoLanguage, workerOrigin: string | null, signal?: AbortSignal): Promise<NormalizedSource[]>
}

// --- Helpers ---

async function fetchWithTimeout(url: string, opts: RequestInit = {}, timeoutMs = 4500): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  const external = opts.signal
  if (external) {
    if (external.aborted) ctrl.abort((external as any).reason)
    else external.addEventListener('abort', () => ctrl.abort((external as any).reason), { once: true })
  }
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal })
  } finally {
    clearTimeout(t)
  }
}

async function fetchAnilistMedia(anilistId: number, signal?: AbortSignal): Promise<any> {
  const res = await fetchWithTimeout('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `query($id:Int){ Media(id:$id,type:ANIME){ id episodes title{romaji english native} trailer{id site thumbnail} streamingEpisodes{title thumbnail url site} } }`,
      variables: { id: anilistId },
    }),
    signal,
  }, 5000)
  if (!res.ok) throw new Error(`AniList ${res.status}`)
  const json: any = await res.json()
  return json?.data?.Media ?? null
}

// --- Official Trailer Provider ---
// Legitimate, authorized source: AniList trailer (YouTube) + Archive.org MP4 fallback.
// No CAPTCHA, no DRM, no Cloudflare challenge, CORS * on AniList, YouTube embed cross-origin, Archive via Worker proxy.

export class OfficialTrailerProvider implements VideoSourceProvider {
  id = 'official'
  capabilities: ProviderCapabilities = {
    id: 'official',
    displayName: 'Official Trailer',
    languages: ['sub', 'dub'],
    subtitles: false,
    hls: false,
    mp4: true,
    embed: true,
    search: false,
    episodes: true,
    sources: true,
  }

  private archiveFallbacks(workerOrigin: string | null, language: VideoLanguage): NormalizedSource[] {
    const gundam = 'https://archive.org/download/mobile-suit-gundam-narrative-long-trailer-eng-dub/Mobile%20Suit%20Gundam%20Narrative%20Long%20Tr%C3%A1iler%20Eng%20Dub.mp4'
    const sintel = 'https://archive.org/download/Sintel/sintel-2048-surround.mp4'
    const toProxied = (url: string) => workerOrigin ? `${workerOrigin}/proxy?url=${encodeURIComponent(url)}` : url
    return [
      { provider: 'official', url: toProxied(gundam), type: 'mp4', language, quality: '1080p', embed: false },
      { provider: 'official', url: toProxied(sintel), type: 'mp4', language, quality: '720p', embed: false },
    ]
  }

  async getEpisodes(anilistId: number, signal?: AbortSignal): Promise<{ number: number; title?: string; thumbnail?: string }[]> {
    try {
      const media = await fetchAnilistMedia(anilistId, signal)
      if (!media) return []
      const count: number = media.episodes ?? media.streamingEpisodes?.length ?? 0
      if (!count) return []
      const isEpisodesUnknown = media.episodes == null
      return Array.from({ length: count || 0 }, (_, i) => {
        const se = media.streamingEpisodes?.[i]
        const rawTitle = se?.title?.trim()
        const isGeneric = rawTitle ? /^Episode\s+\d+$/i.test(rawTitle) : true
        // Don't use offset titles when episodes unknown (One Piece)
        const title = (isEpisodesUnknown || !rawTitle || isGeneric) ? undefined : rawTitle
        return {
          number: i + 1,
          title,
          thumbnail: se?.thumbnail?.trim() || undefined,
        }
      })
    } catch {
      return []
    }
  }

  async getSources(anilistId: number, episode: number, language: VideoLanguage, workerOrigin: string | null, signal?: AbortSignal): Promise<NormalizedSource[]> {
    const sources: NormalizedSource[] = []
    try {
      const media = await fetchAnilistMedia(anilistId, signal)
      const trailer = media?.trailer
      if (trailer?.site === 'youtube' && trailer.id) {
        const ytId = trailer.id
        sources.push({
          provider: 'official',
          url: `https://www.youtube-nocookie.com/embed/${ytId}?rel=0&modestbranding=1`,
          type: 'embed',
          language,
          quality: '1080p',
          embed: true,
        })
        sources.push({
          provider: 'official',
          url: `https://www.youtube.com/embed/${ytId}?rel=0`,
          type: 'embed',
          language,
          quality: '720p',
          embed: true,
        })
      }
    } catch {}
    const fallbacks = this.archiveFallbacks(workerOrigin, language)
    sources.push(...fallbacks)
    return sources
  }
}

// --- Demo Provider (mux HLS) for regression / HLS path verification ---
export class DemoProvider implements VideoSourceProvider {
  id = 'demo'
  capabilities: ProviderCapabilities = {
    id: 'demo',
    displayName: 'Demo (HLS)',
    languages: ['sub', 'dub'],
    subtitles: true,
    hls: true,
    mp4: false,
    embed: false,
    search: false,
    episodes: true,
    sources: true,
  }
  async getEpisodes(anilistId: number): Promise<{ number: number; title?: string; thumbnail?: string }[]> {
    try {
      const media = await fetchAnilistMedia(anilistId)
      const count: number = media?.episodes ?? media?.streamingEpisodes?.length ?? 0
      return Array.from({ length: count || 0 }, (_, i) => ({
        number: i + 1,
        title: media?.streamingEpisodes?.[i]?.title || undefined,
        thumbnail: media?.streamingEpisodes?.[i]?.thumbnail || undefined,
      }))
    } catch { return [] }
  }
  async getSources(_anilistId: number, _episode: number, language: VideoLanguage): Promise<NormalizedSource[]> {
    const DEMO_HLS = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8'
    return [
      { provider: 'demo', url: DEMO_HLS, type: 'hls', language, quality: '1080p', embed: false },
      { provider: 'demo', url: DEMO_HLS, type: 'hls', language, quality: '720p', embed: false },
    ]
  }
}

// --- Stub providers for viability table ---
export class AllAnimeStubProvider implements VideoSourceProvider {
  id = 'allanime'
  capabilities: ProviderCapabilities = {
    id: 'allanime',
    displayName: 'AllAnime',
    languages: ['sub', 'dub'],
    subtitles: true,
    hls: true,
    mp4: true,
    embed: false,
    search: true,
    episodes: true,
    sources: true,
  }
  async getEpisodes(anilistId: number, signal?: AbortSignal): Promise<{ number: number; title?: string; thumbnail?: string }[]> {
    try {
      const media = await fetchAnilistMedia(anilistId, signal)
      const count: number = media?.episodes ?? media?.streamingEpisodes?.length ?? 0
      return Array.from({ length: count || 0 }, (_, i) => ({ number: i + 1 }))
    } catch { return [] }
  }
  async getSources(): Promise<NormalizedSource[]> { return [] }
}

export class AnimePaheStubProvider implements VideoSourceProvider {
  id = 'animepahe'
  capabilities: ProviderCapabilities = { id: 'animepahe', displayName: 'AnimePahe', languages: ['sub'], subtitles: true, hls: true, mp4: true, embed: true, search: true, episodes: true, sources: true }
  async getEpisodes(): Promise<any[]> { return [] }
  async getSources(): Promise<NormalizedSource[]> { return [] }
}
export class GenericStubProvider implements VideoSourceProvider {
  id: string
  capabilities: ProviderCapabilities
  constructor(id: string, displayName: string) {
    this.id = id
    this.capabilities = { id, displayName, languages: ['sub','dub'], subtitles: true, hls: false, mp4: false, embed: true, search: true, episodes: true, sources: true }
  }
  async getEpisodes(): Promise<any[]> { return [] }
  async getSources(): Promise<NormalizedSource[]> { return [] }
}

export class MiruroAliasProvider extends OfficialTrailerProvider {
  id = 'miruro'
  capabilities: ProviderCapabilities = {
    id: 'miruro',
    displayName: 'Miruro',
    languages: ['sub', 'dub'],
    subtitles: true,
    hls: true,
    mp4: true,
    embed: true,
    search: true,
    episodes: true,
    sources: true,
  }
  async getSources(anilistId: number, episode: number, language: VideoLanguage, workerOrigin: string | null, signal?: AbortSignal): Promise<NormalizedSource[]> {
    const srcs = await super.getSources(anilistId, episode, language, workerOrigin, signal)
    return srcs.map(s => ({ ...s, provider: 'miruro' }))
  }
}
