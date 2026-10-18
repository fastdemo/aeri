import React, { createContext, useContext, useMemo, useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
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
  /** Remove the entry from the list entirely ("–" in the Status pill). */
  removeEntry: (anime: Anime) => Promise<void>
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
  const navigate = useNavigate()
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

  // When the last account disconnects, reset the tracker pick and leave to
  // Home (My List / Settings account UI assume a signed-in user). Only fires
  // on the connected → disconnected transition, never on first load.
  const anyConnected = ani.isAuthenticated || mal.isAuthenticated
  const wasConnectedRef = useRef(anyConnected)
  useEffect(() => {
    const was = wasConnectedRef.current
    wasConnectedRef.current = anyConnected
    if (was && !anyConnected) {
      persistTrackingProvider(null)
      setExplicitTracker(null)
      try {
        // Leave protected surfaces when the last account disconnects. The
        // pathname check runs on window because this context sits inside
        // the router but only needs the current entry.
        if (window.location.pathname !== '/') navigate('/')
      } catch {}
    }
  }, [anyConnected, navigate])

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
  // isManga derives from the object's own format/mediaType (never the
  // route): manga chapters route to manga endpoints + manga vocabulary.
  // removeEntry shares the same id-resolution as the writers below (never
  // raw internalId: AniList needs the numeric anilist id, MAL the mal id).
  const resolveAnilistId = (anime: Anime): string | null =>
    anime.identity.anilistId?.toString()
    ?? (anime.identity.internalId.startsWith('anilist-') ? anime.identity.internalId.replace('anilist-', '') : null)
  const resolveMalId = (anime: Anime): string | null =>
    anime.identity.malId ? `mal-${anime.identity.malId}`
    : (anime.identity.internalId.startsWith('mal-') ? anime.identity.internalId : null)
  const isMangaObj = (anime: Anime) =>
    anime.identity.mediaType === 'MANGA' ||
    ['MANGA', 'NOVEL', 'ONE_SHOT'].includes((anime.format ?? '').toUpperCase())
  const updateProgress = useCallback(async (anime: Anime, ep: number) => {
    const isManga = isMangaObj(anime)
    if (active === 'anilist' && ani.isAuthenticated && isSyncEnabled('anilist', 'progress')) {
      const anilistId = anime.identity.anilistId?.toString() ?? (anime.identity.internalId.startsWith('anilist-') ? anime.identity.internalId.replace('anilist-', '') : null)
      if (anilistId) { await ani.updateProgress(anilistId, ep).catch(() => {}); return }
      if (anime.identity.anilistId) { await ani.updateProgress(`anilist-${anime.identity.anilistId}`, ep).catch(() => {}); return }
    }
    if (active === 'mal' && mal.isAuthenticated && isSyncEnabled('mal', 'progress')) {
      const malId = anime.identity.malId ? `mal-${anime.identity.malId}` : (anime.identity.internalId.startsWith('mal-') ? anime.identity.internalId : null)
      if (malId) { await mal.updateProgress(malId, ep, isManga).catch(() => {}); return }
      if (anime.identity.malId) { await mal.updateProgress(`mal-${anime.identity.malId}`, ep, isManga).catch(() => {}); return }
    }
  }, [active, ani.isAuthenticated, ani.updateProgress, mal.isAuthenticated, mal.updateProgress])

  const updateStatus = useCallback(async (anime: Anime, status: AnimeStatus) => {
    const isManga = isMangaObj(anime)
    // DATE STAMPS (owner rule 2026-10-18): flipping a title to watching
    // stamps its start date with today; completing stamps its finish date.
    // Detected as a real TRANSITION against the current list copy — a
    // no-op re-save of the same status never rewrites stored dates.
    const selfManga = isManga
    const prevStatus = (combinedList ?? []).find((e) => {
      if (selfManga !== ['MANGA', 'NOVEL', 'ONE_SHOT'].includes((e.anime.format ?? '').toUpperCase())) return false
      if (anime.identity.malId && e.anime.identity.malId === anime.identity.malId) return true
      if (anime.identity.anilistId && e.anime.identity.anilistId === anime.identity.anilistId) return true
      return e.anime.identity.internalId === anime.identity.internalId
    })?.status ?? null
    const dates: { start?: string; finish?: string } = {}
    if (prevStatus !== status) {
      const now = new Date()
      const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      if (status === 'watching') dates.start = today
      if (status === 'completed') dates.finish = today
    }
    if (active === 'anilist' && ani.isAuthenticated && isSyncEnabled('anilist', 'status')) {
      const anilistId = anime.identity.anilistId?.toString() ?? (anime.identity.internalId.startsWith('anilist-') ? anime.identity.internalId.replace('anilist-', '') : null)
      if (anilistId) { await ani.updateStatus(anilistId, status, undefined, dates).catch(() => {}); return }
      if (anime.identity.anilistId) { await ani.updateStatus(`anilist-${anime.identity.anilistId}`, status, undefined, dates).catch(() => {}); return }
    }
    if (active === 'mal' && mal.isAuthenticated && isSyncEnabled('mal', 'status')) {
      const malId = anime.identity.malId ? `mal-${anime.identity.malId}` : (anime.identity.internalId.startsWith('mal-') ? anime.identity.internalId : null)
      if (malId) { await mal.updateStatus(malId, status, isManga, dates).catch(() => {}); return }
      if (anime.identity.malId) { await mal.updateStatus(`mal-${anime.identity.malId}`, status, isManga, dates).catch(() => {}); return }
    }
  }, [active, ani.isAuthenticated, ani.updateStatus, mal.isAuthenticated, mal.updateStatus, combinedList])

  const updateRating = useCallback(async (anime: Anime, rating: number) => {
    const isManga = isMangaObj(anime)
    if (active === 'anilist' && ani.isAuthenticated && isSyncEnabled('anilist', 'rating')) {
      const anilistId = anime.identity.anilistId?.toString() ?? (anime.identity.internalId.startsWith('anilist-') ? anime.identity.internalId.replace('anilist-', '') : null)
      if (anilistId) { await ani.updateRating(anilistId, rating).catch(() => {}); return }
      if (anime.identity.anilistId) { await ani.updateRating(`anilist-${anime.identity.anilistId}`, rating).catch(() => {}); return }
    }
    if (active === 'mal' && mal.isAuthenticated && isSyncEnabled('mal', 'rating')) {
      const malId = anime.identity.malId ? `mal-${anime.identity.malId}` : (anime.identity.internalId.startsWith('mal-') ? anime.identity.internalId : null)
      if (malId) { await mal.updateRating(malId, rating, isManga).catch(() => {}); return }
      if (anime.identity.malId) { await mal.updateRating(`mal-${anime.identity.malId}`, rating, isManga).catch(() => {}); return }
    }
  }, [active, ani.isAuthenticated, ani.updateRating, mal.isAuthenticated, mal.updateRating])

  const removeEntry = useCallback(async (anime: Anime) => {
    const isManga = isMangaObj(anime)
    if (active === 'anilist' && ani.isAuthenticated && isSyncEnabled('anilist', 'status')) {
      const anilistId = resolveAnilistId(anime)
      if (anilistId) { await ani.removeEntry(anilistId).catch(() => {}); return }
    }
    if (active === 'mal' && mal.isAuthenticated && isSyncEnabled('mal', 'status')) {
      const malId = resolveMalId(anime) ?? (anime.identity.malId ? `mal-${anime.identity.malId}` : null)
      if (malId) { await mal.removeEntry(malId, isManga).catch(() => {}); return }
    }
  }, [active, ani.isAuthenticated, ani.removeEntry, mal.isAuthenticated, mal.removeEntry])

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
    removeEntry,
  }), [trackingProvider, setTrackingProvider, isAuthenticated, ani.isAuthenticated, mal.isAuthenticated, combinedList, loading, error, authExpired, updateProgress, updateStatus, updateRating, removeEntry])

  return <TrackingContext.Provider value={value}>{children}</TrackingContext.Provider>
}
