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
}

export interface VideoProvider {
  id: string
  name: string
  capabilities: ProviderCapabilities
  // Resolve provider anime ID from Aeri Anime (via AniList/MAL id or title)
  resolveAnimeId(anime: Anime): Promise<string | null>
  // Get episodes for anime
  getEpisodes(anime: Anime): Promise<VideoEpisode[]>
  // Get sources for episode
  getSources(episode: VideoEpisode): Promise<VideoSourceEnhanced[]>
}

// Re-export for convenience
export type { Anime, Episode, VideoSource }
