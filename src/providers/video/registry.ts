import type { Anime } from '../../types/anime'
import type { VideoProvider, VideoEpisode, VideoSourceEnhanced, VideoLanguage } from './types'
import { mockVideoProvider } from './mock'
import { allAnimeProvider } from './allanime'
import { animePaheProvider } from './animepahe'
import { aniKotoProvider } from './anikoto'
import { megaPlayProvider } from './megaplay'
import { animeParadiseProvider } from './animeparadise'
import { aniNekoProvider } from './anineko'
import { miruroProvider } from './miruro'

// Priority order determined from actual browser CORS testing 2026-08-29:
// Miruro (if VITE_VIDEO_API_URL set) is first — it's the only path to real HLS on GH Pages via Worker/VPS
// AllAnime: CORS header present for https://fastdemo.github.io but sources need backend (clock + crypto)
// Others: CORS blocked/DNS fail — kept for future if they become browser-compatible
// Mock is last for episode list only (no video)
export const videoProviders: VideoProvider[] = [
  miruroProvider,
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

export async function resolveEpisodesWithFallback(anime: Anime, signal?: AbortSignal): Promise<{ episodes: VideoEpisode[]; providerId: string | null }> {
  if (signal?.aborted) return { episodes: [], providerId: null }
  const timeoutMs = 4000
  const withTimeout = <T,>(p: Promise<T>): Promise<T> =>
    Promise.race([
      p,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error('registry timeout')), timeoutMs)),
      ...(signal ? [new Promise<T>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError')), { once: true }))] : []),
    ]) as Promise<T>

  const results = await Promise.allSettled(
    primaryVideoProviders.map(p => withTimeout(p.getEpisodes(anime, signal)).catch(() => [] as VideoEpisode[]))
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

export interface ResolveSourcesOptions {
  preferredProvider?: string | null
  preferredLanguage?: VideoLanguage
  signal?: AbortSignal
}

export async function resolveSourcesWithFallback(
  episode: VideoEpisode,
  options?: ResolveSourcesOptions,
): Promise<{ sources: VideoSourceEnhanced[]; tried: string[] }> {
  if (options?.signal?.aborted) return { sources: [], tried: [] }
  const tried: string[] = []
  const timeoutMs = 4000
  const signal = options?.signal
  const withTimeout = <T,>(p: Promise<T>): Promise<T> =>
    Promise.race([
      p,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error('registry timeout')), timeoutMs)),
      ...(signal ? [new Promise<T>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError')), { once: true }))] : []),
    ]) as Promise<T>

  const preferredLanguage = options?.preferredLanguage

  // Build priority: preferred provider first if valid, then remaining in registry order
  const preferredId = options?.preferredProvider
  const preferred = preferredId ? getProviderById(preferredId) : getProviderById(episode.provider)
  const ordered: VideoProvider[] = []
  if (preferred && preferred.id !== 'mock' && primaryVideoProviders.some(p => p.id === preferred.id)) {
    ordered.push(preferred)
  }
  for (const p of primaryVideoProviders) {
    if (!ordered.some(o => o.id === p.id)) ordered.push(p)
  }

  // Try in priority order but with parallel batching to avoid 20s wait: first try preferred alone with timeout,
  // then remaining in parallel. Use options.language filtering.
  if (ordered.length > 0) {
    const first = ordered[0]
    tried.push(first.id)
    try {
      const srcs = await withTimeout(first.getSources(episode, { preferredLanguage, signal: options?.signal }))
      const filtered = preferredLanguage ? srcs.filter(s => !s.language || s.language === preferredLanguage) : srcs
      const toReturn = filtered.length ? filtered : srcs
      if (toReturn.length > 0) return { sources: toReturn, tried }
    } catch {}
    const remaining = ordered.slice(1)
    if (remaining.length > 0) {
      const results = await Promise.allSettled(
        remaining.map(p => {
          tried.push(p.id)
          return withTimeout(p.getSources(episode, { preferredLanguage, signal: options?.signal })).catch(() => [] as VideoSourceEnhanced[])
        }),
      )
      for (let i = 0; i < remaining.length; i++) {
        const r = results[i]
        if (r.status === 'fulfilled' && r.value.length > 0) {
          const filtered = preferredLanguage ? r.value.filter(s => !s.language || s.language === preferredLanguage) : r.value
          const toReturn = filtered.length ? filtered : r.value
          if (toReturn.length > 0) return { sources: toReturn, tried }
        }
      }
      // If no filtered match, return first available unfiltered as fallback
      for (let i = 0; i < remaining.length; i++) {
        const r = results[i]
        if (r.status === 'fulfilled' && r.value.length > 0) {
          return { sources: r.value, tried }
        }
      }
    }
  }
  return { sources: [], tried }
}

export function getProviderCapabilities() {
  return videoProviders.map(p => p.capabilities)
}
