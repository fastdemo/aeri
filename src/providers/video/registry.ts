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
import { officialProvider } from './official'
import { customProvider } from './custom'
import { getPreferences, getEffectiveVideoApiUrl } from '../../storage/preferences'
import { fetchWithTimeout } from './base'

// Priority order: official trailer is first (honest, no fake), custom endpoint (user self-hosted full-episode) is second when configured, then miruro alias, then stubs.
// Mock is last for episode list only (no video)
export const videoProviders: VideoProvider[] = [
  officialProvider,
  customProvider,
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

function getEnabledProviders(): VideoProvider[] {
  try {
    const prefs = getPreferences()
    const enabled = prefs.enabledProviders
    if (!enabled) return primaryVideoProviders
    return primaryVideoProviders.filter(p => enabled[p.id] !== false)
  } catch { return primaryVideoProviders }
}

function getOrderedProviders(list: VideoProvider[]): VideoProvider[] {
  try {
    const prefs = getPreferences()
    const order = prefs.providerOrder
    if (!order || !Array.isArray(order) || order.length === 0) return list
    const map = new Map(list.map(p => [p.id, p] as const))
    const ordered: VideoProvider[] = []
    for (const id of order) {
      const p = map.get(id)
      if (p) { ordered.push(p); map.delete(id) }
    }
    for (const p of map.values()) ordered.push(p)
    return ordered
  } catch { return list }
}

export async function checkProviderHealth(signal?: AbortSignal): Promise<Record<string, 'available' | 'unavailable'>> {
  const effective = getEffectiveVideoApiUrl()
  const envBase = (import.meta as any).env.VITE_VIDEO_API_URL as string | undefined
  const trimmedEnv = envBase?.trim().replace(/\/$/, '')
  const hasWorker = !!(effective || trimmedEnv)
  if (hasWorker) {
    const baseToCheck = effective || trimmedEnv!
    try {
      const res = await fetchWithTimeout(`${baseToCheck}/health`, {}, 4000, signal)
      if (res.ok) {
        const baseMap: Record<string, 'available' | 'unavailable'> = { official: 'available', custom: effective ? 'available' : 'unavailable', miruro: 'available', demo: 'available', allanime: 'unavailable', animepahe: 'unavailable', anikoto: 'unavailable', megaplay: 'unavailable', animeparadise: 'unavailable', anineko: 'unavailable' }
        return baseMap
      }
    } catch {}
    return { official: 'available', custom: effective ? 'unavailable' : 'unavailable', miruro: hasWorker ? 'available' : 'unavailable' } as any
  }
  return { official: 'available', custom: 'unavailable', miruro: 'unavailable', allanime: 'unavailable', animepahe: 'unavailable', anikoto: 'unavailable', megaplay: 'unavailable', animeparadise: 'unavailable', anineko: 'unavailable', demo: 'available' }
}

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

  const enabled = getOrderedProviders(getEnabledProviders())
  const results = await Promise.allSettled(
    enabled.map(p => withTimeout(p.getEpisodes(anime, signal)).catch(() => [] as VideoEpisode[]))
  )
  for (let i = 0; i < enabled.length; i++) {
    const r = results[i]
    if (r.status === 'fulfilled' && r.value.length > 0) {
      return { episodes: r.value, providerId: enabled[i].id }
    }
  }
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
  bypassCache?: boolean
}

export async function resolveSourcesWithFallback(
  episode: VideoEpisode,
  options?: ResolveSourcesOptions,
): Promise<{ sources: VideoSourceEnhanced[]; tried: string[] }> {
  if (options?.signal?.aborted) return { sources: [], tried: [] }
  if (options?.bypassCache) {
    try {
      const { clearVideoMemoryCache } = await import('./base')
      clearVideoMemoryCache()
    } catch {}
    try {
      const lang = options.preferredLanguage ?? 'sub'
      const possibleKeys = [
        `video:official:sources:${episode.providerEpisodeId}:${lang}`,
        `video:miruro:sources:${episode.providerEpisodeId}:${lang}`,
        `video:custom:sources:${episode.providerEpisodeId}:${lang}`,
        `video:custom:episodes:${episode.animeId}`,
      ]
      for (const k of possibleKeys) {
        try { const { deleteCache } = await import('../../storage/db'); await deleteCache(k) } catch {}
      }
    } catch {}
  }
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
  const preferredId = options?.preferredProvider
  const enabledOrdered = getOrderedProviders(getEnabledProviders())
  // Ensure preferred is valid and enabled
  const preferred = preferredId ? getProviderById(preferredId) : getProviderById(episode.provider)
  const ordered: VideoProvider[] = []
  if (preferred && preferred.id !== 'mock' && enabledOrdered.some(p => p.id === preferred.id)) {
    ordered.push(preferred)
  }
  for (const p of enabledOrdered) {
    if (!ordered.some(o => o.id === p.id)) ordered.push(p)
  }

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
      // For accurate tried list, only push tried for providers that actually were attempted; we already pushed first.
      // For remaining, we will collect after race — push all remaining as tried since we do parallel attempt.
      const results = await Promise.allSettled(
        remaining.map(p => withTimeout(p.getSources(episode, { preferredLanguage, signal: options?.signal })).catch(() => [] as VideoSourceEnhanced[])),
      )
      // Mark remaining as tried after the parallel attempt started
      for (const p of remaining) tried.push(p.id)
      for (let i = 0; i < remaining.length; i++) {
        const r = results[i]
        if (r.status === 'fulfilled' && r.value.length > 0) {
          const filtered = preferredLanguage ? r.value.filter(s => !s.language || s.language === preferredLanguage) : r.value
          const toReturn = filtered.length ? filtered : r.value
          if (toReturn.length > 0) return { sources: toReturn, tried }
        }
      }
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
