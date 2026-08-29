export interface AnimeIdentity {
  internalId: string
  anilistId?: number
  malId?: number
}

export type AnimeStatus = 'watching' | 'completed' | 'planned' | 'on_hold' | 'dropped'

export interface Anime {
  identity: AnimeIdentity
  title: {
    romaji: string
    english?: string
    native?: string
  }
  description: string
  coverImage: string
  backdropImage: string
  bannerImage?: string
  year?: number
  season?: string
  episodes?: number
  duration?: number
  status?: string
  rating?: number
  genres: string[]
  studios?: string[]
  format?: string
  popularity?: number
  streamingEpisodes?: { title?: string; thumbnail?: string; url?: string; site?: string }[]
  isAdult?: boolean
  progress?: {
    episode: number
    percent: number // 0-100
  }
  inList?: boolean
  listStatus?: AnimeStatus
}

export interface Episode {
  id: string
  animeId: string
  number: number
  title: string
  thumbnail?: string
  duration?: number
  description?: string
}

export interface VideoSource {
  url: string
  quality: string
  type: string
}

export interface AnimeListEntry {
  anime: Anime
  status: AnimeStatus
  progress: number
  score?: number
}
