import React, { createContext, useContext, useMemo, useCallback, useEffect, useState } from 'react'
import { useAniList } from './AniListContext'
import { useMAL } from './MALContext'
import {
  isSyncEnabled,
  getTrackingProvider,
  setTrackingProvider as persistTrackingProvider,
  getPreferences,
  type TrackingProviderId,
} from '../storage/preferences'
import { enrichMalEntriesWithAnilist } from '../services/mal/enrichment'
import type { Anime, AnimeListEntry, AnimeStatus } from '../types/anime'

type UnifiedTracking = {
  // Active tracker (exactly one account drives reads + writes; both may stay
  // connected). AniList remains the metadata backbone regardless.
  trackingProvider: TrackingProviderId | null
  setTrackingProvider: (p: TrackingProviderId) => void
  isAuthenticated: boolean
  isAniListAuthenticated: boolean
  isMALAuthenticated: boolean
  // Active tracker's list. MAL entries are progressively upgraded to AniList
  // display metadata (never shown as raw MAL); AniList entries are used as-is.
  combinedList: AnimeListEntry[] | null
  loading: boolean
  error: string | null
  authExpired: boolean
  updateProgress: (anime: Anime, ep: number) => Promise<void>
  updateStatus: (anime: Anime, status: AnimeStatus) => Promise<void>
  updateRating: (anime: Anime, rating: number) => Promise<void>
}

const TrackingContext = createContext<UnifiedTracking | null>(null)

export function useTracking() {
  const v = useContext(TrackingContext)
  if (!v) throw new Error('useTracking must be inside TrackingProvider')
  return v
}

export function TrackingProvider({ children }: { children: React.ReactNode }) {
  const ani = useAniList()
  const mal = useMAL()
  const [explicitTracker, setExplicitTracker] = useState<TrackingProviderId | null>(() => {
    try { return getPreferences().trackingProvider ?? null } catch { return null }
  })

  // Resolved active tracker: explicit pick wins when that account is
  // connected, else AniList when connected, else MAL (see preferences).
  // explicitTracker state exists only to re-render on switch; the rule itself
  // lives in getTrackingProvider (persist is written before the state bump).
  const trackingProvider: TrackingProviderId | null = useMemo(
    () => getTrackingProvider(ani.isAuthenticated, mal.isAuthenticated),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [explicitTracker, ani.isAuthenticated, mal.isAuthenticated],
  )

  const setTrackingProvider = useCallback((p: TrackingProviderId) => {
    persistTrackingProvider(p)
    setExplicitTracker(p)
  }, [])

  // Raw list from the active tracker only — the other account (if connected)
  // stays signed in but is never merged in, so the two services can never
  // contradict each other on screen or diverge via fan-out writes.
  const rawList = trackingProvider === 'anilist' ? ani.animeList
    : trackingProvider === 'mal' ? mal.animeList
    : null

  // MAL tracker: upgrade entries to AniList display metadata in the
  // background (cached; failures keep MAL fallbacks per entry).
  const [enrichedMalList, setEnrichedMalList] = useState<AnimeListEntry[] | null>(null)
  useEffect(() => {
    setEnrichedMalList(null)
    if (trackingProvider !== 'mal' || !mal.animeList) return
    const ctrl = new AbortController()
    let cancelled = false
    enrichMalEntriesWithAnilist(mal.animeList, {
      signal: ctrl.signal,
      onBatch: (next) => { if (!cancelled) setEnrichedMalList(next) },
    }).then((final) => {
      if (!cancelled) setEnrichedMalList(final)
    }).catch(() => {})
    return () => { cancelled = true; ctrl.abort() }
  }, [trackingProvider, mal.animeList])

  const combinedList = trackingProvider === 'mal'
    ? (enrichedMalList ?? rawList)
    : rawList

  const isAuthenticated = trackingProvider !== null
  const loading = trackingProvider === 'anilist' ? ani.loadingList
    : trackingProvider === 'mal' ? mal.loadingList
    : false
  const error = trackingProvider === 'anilist' ? ani.error
    : trackingProvider === 'mal' ? mal.error
    : null
  const authExpired = trackingProvider === 'anilist' ? ani.authExpired
    : trackingProvider === 'mal' ? mal.authExpired
    : false

  const active = trackingProvider
  const updateProgress = useCallback(async (anime: Anime, ep: number) => {
    if (active === 'anilist' && ani.isAuthenticated && isSyncEnabled('anilist', 'progress')) {
      const anilistId = anime.identity.anilistId?.toString() ?? (anime.identity.internalId.startsWith('anilist-') ? anime.identity.internalId.replace('anilist-', '') : null)
      if (anilistId) { await ani.updateProgress(anilistId, ep).catch(() => {}); return }
      if (anime.identity.anilistId) { await ani.updateProgress(`anilist-${anime.identity.anilistId}`, ep).catch(() => {}); return }
    }
    if (active === 'mal' && mal.isAuthenticated && isSyncEnabled('mal', 'progress')) {
      const malId = anime.identity.malId ? `mal-${anime.identity.malId}` : (anime.identity.internalId.startsWith('mal-') ? anime.identity.internalId : null)
      if (malId) { await mal.updateProgress(malId, ep).catch(() => {}); return }
      if (anime.identity.malId) { await mal.updateProgress(`mal-${anime.identity.malId}`, ep).catch(() => {}); return }
    }
  }, [active, ani.isAuthenticated, ani.updateProgress, mal.isAuthenticated, mal.updateProgress])

  const updateStatus = useCallback(async (anime: Anime, status: AnimeStatus) => {
    if (active === 'anilist' && ani.isAuthenticated && isSyncEnabled('anilist', 'status')) {
      const anilistId = anime.identity.anilistId?.toString() ?? (anime.identity.internalId.startsWith('anilist-') ? anime.identity.internalId.replace('anilist-', '') : null)
      if (anilistId) { await ani.updateStatus(anilistId, status).catch(() => {}); return }
      if (anime.identity.anilistId) { await ani.updateStatus(`anilist-${anime.identity.anilistId}`, status).catch(() => {}); return }
    }
    if (active === 'mal' && mal.isAuthenticated && isSyncEnabled('mal', 'status')) {
      const malId = anime.identity.malId ? `mal-${anime.identity.malId}` : (anime.identity.internalId.startsWith('mal-') ? anime.identity.internalId : null)
      if (malId) { await mal.updateStatus(malId, status).catch(() => {}); return }
      if (anime.identity.malId) { await mal.updateStatus(`mal-${anime.identity.malId}`, status).catch(() => {}); return }
    }
  }, [active, ani.isAuthenticated, ani.updateStatus, mal.isAuthenticated, mal.updateStatus])

  const updateRating = useCallback(async (anime: Anime, rating: number) => {
    if (active === 'anilist' && ani.isAuthenticated && isSyncEnabled('anilist', 'rating')) {
      const anilistId = anime.identity.anilistId?.toString() ?? (anime.identity.internalId.startsWith('anilist-') ? anime.identity.internalId.replace('anilist-', '') : null)
      if (anilistId) { await ani.updateRating(anilistId, rating).catch(() => {}); return }
      if (anime.identity.anilistId) { await ani.updateRating(`anilist-${anime.identity.anilistId}`, rating).catch(() => {}); return }
    }
    if (active === 'mal' && mal.isAuthenticated && isSyncEnabled('mal', 'rating')) {
      const malId = anime.identity.malId ? `mal-${anime.identity.malId}` : (anime.identity.internalId.startsWith('mal-') ? anime.identity.internalId : null)
      if (malId) { await mal.updateRating(malId, rating).catch(() => {}); return }
      if (anime.identity.malId) { await mal.updateRating(`mal-${anime.identity.malId}`, rating).catch(() => {}); return }
    }
  }, [active, ani.isAuthenticated, ani.updateRating, mal.isAuthenticated, mal.updateRating])

  const value: UnifiedTracking = useMemo(() => ({
    trackingProvider,
    setTrackingProvider,
    isAuthenticated,
    isAniListAuthenticated: ani.isAuthenticated,
    isMALAuthenticated: mal.isAuthenticated,
    combinedList,
    loading,
    error,
    authExpired,
    updateProgress,
    updateStatus,
    updateRating,
  }), [trackingProvider, setTrackingProvider, isAuthenticated, ani.isAuthenticated, mal.isAuthenticated, combinedList, loading, error, authExpired, updateProgress, updateStatus, updateRating])

  return <TrackingContext.Provider value={value}>{children}</TrackingContext.Provider>
}
