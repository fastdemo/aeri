import type { Anime } from '../../types/anime'
import type { VideoProvider, VideoEpisode, VideoSourceEnhanced } from './types'
import { mockVideoProvider } from './mock'
import { allAnimeProvider } from './allanime'
import { animePaheProvider } from './animepahe'
import { aniKotoProvider } from './anikoto'
import { megaPlayProvider } from './megaplay'
import { animeParadiseProvider } from './animeparadise'
import { aniNekoProvider } from './anineko'

// Priority order determined from actual browser CORS testing 2026-08-29:
// - AllAnime: CORS header present for https://fastdemo.github.io but query requires exact schema; most promising if query fixed
// - MegaPlay: CORS * but returns HTML error, not JSON
// - Others: CORS blocked or DNS fail
// For now, all real providers return no-source on static Pages; mock is last for episode list only (no video)
// Priority: try real providers first (for future if they become browser-compatible), then mock for episodes

export const videoProviders: VideoProvider[] = [
  allAnimeProvider,
  animePaheProvider,
  aniKotoProvider,
  megaPlayProvider,
  animeParadiseProvider,
  aniNekoProvider,
  mockVideoProvider,
]

export const primaryVideoProviders = videoProviders.filter(p => p.id !== 'mock')

export function getProviderById(id: string): VideoProvider | undefined {
  return videoProviders.find(p => p.id === id)
}

export async function resolveEpisodesWithFallback(anime: Anime): Promise<{ episodes: VideoEpisode[]; providerId: string | null }> {
  // Try each real provider in order; isolate failures so one provider failing doesn't crash Watch
  for (const provider of primaryVideoProviders) {
    try {
      const eps = await provider.getEpisodes(anime)
      if (eps.length > 0) return { episodes: eps, providerId: provider.id }
    } catch {
      // isolated, continue
    }
  }
  // Fallback to mock for episode list (ensures episode navigation still works even without video)
  try {
    const eps = await mockVideoProvider.getEpisodes(anime)
    return { episodes: eps, providerId: 'mock' }
  } catch {
    return { episodes: [], providerId: null }
  }
}

export async function resolveSourcesWithFallback(episode: VideoEpisode): Promise<{ sources: VideoSourceEnhanced[]; tried: string[] }> {
  const tried: string[] = []
  // If episode already knows its provider, try that first
  const preferred = getProviderById(episode.provider)
  if (preferred && preferred.id !== 'mock') {
    tried.push(preferred.id)
    try {
      const srcs = await preferred.getSources(episode)
      if (srcs.length > 0) return { sources: srcs, tried }
    } catch {}
  }
  // Try remaining real providers
  for (const provider of primaryVideoProviders) {
    if (tried.includes(provider.id)) continue
    tried.push(provider.id)
    try {
      // Need to map episode to provider's episode id — for now we try with same episode number
      // Real mapping would use resolveAnimeId + episode number; for stub we just try
      const srcs = await provider.getSources(episode)
      if (srcs.length > 0) return { sources: srcs, tried }
    } catch {}
  }
  return { sources: [], tried }
}

export function getProviderCapabilities() {
  return videoProviders.map(p => p.capabilities)
}
