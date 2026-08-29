import type { Anime, Episode, VideoSource } from '../../types/anime'

export type VideoLanguage = 'sub' | 'dub'
export type VideoType = 'hls' | 'mp4' | 'embed' | 'mock'

export interface SubtitleTrack {
  language: string
  label: string
  url: string
  type?: string // 'vtt' | 'srt'
}

export interface VideoEpisode {
  id: string
  animeId: string
  number: number
  title?: string
  thumbnail?: string
  duration?: number
  language?: VideoLanguage
  provider: string
  providerEpisodeId: string
  availableLanguages?: VideoLanguage[]
}

export interface VideoSourceEnhanced extends VideoSource {
  provider: string
  language?: VideoLanguage
  subtitles?: SubtitleTrack[]
  embed?: boolean // true if url is an embed iframe src, false if direct video
  headers?: Record<string, string>
}

export interface ProviderCapabilities {
  id: string
  name: string
  displayName: string
  languages: VideoLanguage[]
  subtitles: boolean
  embed: boolean
  directVideo: boolean
  search: boolean
  episodes: boolean
  sources: boolean
  // Additional capability flags for new abstraction
  hls?: boolean
  mp4?: boolean
}

export interface ProviderAnimeMatch {
  providerId: string
  providerAnimeId: string
  title?: string
}

export interface SourceOptions {
  preferredLanguage?: VideoLanguage
  signal?: AbortSignal
}

export interface VideoProvider {
  id: string
  name: string
  capabilities: ProviderCapabilities
  // Resolve provider anime ID from Aeri Anime (via AniList/MAL id or title)
  resolveAnimeId(anime: Anime): Promise<string | null>
  // Optional: resolve with metadata (for future aggregators like Miruro that need mapping)
  resolveAnime?(anime: Anime): Promise<ProviderAnimeMatch | null>
  // Get episodes for anime
  getEpisodes(anime: Anime): Promise<VideoEpisode[]>
  // Get sources for episode (now with options)
  getSources(episode: VideoEpisode, options?: SourceOptions): Promise<VideoSourceEnhanced[]>
}

// Re-export for convenience
export type { Anime, Episode, VideoSource }
