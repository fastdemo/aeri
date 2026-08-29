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
  // Phase 7.1: Parallel discovery with bounded timeout — previously sequential would make Watch wait 6×3.5s = 21s
  // Now all real providers are queried concurrently, each with its own 3.5s fetch timeout (via fetchWithTimeout),
  // plus a registry-level 4s safety timeout. Fastest valid result wins in priority order.
  // If a provider is known to be permanently CORS-blocked, we still try it but with short timeout so no-source
  // resolves in ~3.5s total, not tens of seconds, and Watch shell/episode list renders immediately.
  const timeoutMs = 4000
  const withTimeout = <T,>(p: Promise<T>): Promise<T> =>
    Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('registry timeout')), timeoutMs))]) as Promise<T>

  const results = await Promise.allSettled(
    primaryVideoProviders.map(p => withTimeout(p.getEpisodes(anime)).catch(() => [] as VideoEpisode[]))
  )
  // Priority order: first provider with eps.length > 0 wins
  for (let i = 0; i < primaryVideoProviders.length; i++) {
    const r = results[i]
    if (r.status === 'fulfilled' && r.value.length > 0) {
      return { episodes: r.value, providerId: primaryVideoProviders[i].id }
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
  // Phase 7.1: Parallel source discovery — previously sequential would wait for each provider's 3.5s timeout
  // Now we try preferred provider first (if known) then remaining in parallel, bounded at 4s total.
  // No provider caches huge video files; only the selected episode's source is fetched, deduplicated.
  const tried: string[] = []
  const preferred = getProviderById(episode.provider)
  const timeoutMs = 4000
  const withTimeout = <T,>(p: Promise<T>): Promise<T> =>
    Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('registry timeout')), timeoutMs))]) as Promise<T>

  if (preferred && preferred.id !== 'mock') {
    tried.push(preferred.id)
    try {
      const srcs = await withTimeout(preferred.getSources(episode))
      if (srcs.length > 0) return { sources: srcs, tried }
    } catch {}
  }
  const remaining = primaryVideoProviders.filter(p => !tried.includes(p.id))
  if (remaining.length > 0) {
    const results = await Promise.allSettled(
      remaining.map(p => {
        tried.push(p.id)
        return withTimeout(p.getSources(episode)).catch(() => [] as VideoSourceEnhanced[])
      })
    )
    for (let i = 0; i < remaining.length; i++) {
      const r = results[i]
      if (r.status === 'fulfilled' && r.value.length > 0) {
        return { sources: r.value, tried }
      }
    }
  }
  return { sources: [], tried }
}

export function getProviderCapabilities() {
  return videoProviders.map(p => p.capabilities)
}
