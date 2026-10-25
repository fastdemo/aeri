import React, { createContext, useContext, useMemo, useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAniList } from './AniListContext'
import { useMAL } from './MALContext'
import {
  isSyncEnabled,
  isIncognitoEnabled,
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
  /**
   * Tracker progress write. `manual` marks USER-INITIATED edits (progress
   * stepper, QuickMenu "Mark as watched") — those still sync while
   * Incognito is on. Automatic writes (watch/read flows, episode/chapter
   * clicks) omit it and are suppressed by Incognito.
   */
  updateProgress: (anime: Anime, ep: number, opts?: { manual?: boolean }) => Promise<void>
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

  // MAL tracker (owner 2026-10-20 "anilist for metadata, ALWAYS. no mal
  // metadata" + 2026-10-21 show-everything rule): the combined list renders
  // AniList-backed records and entries the batch PROVED have no AniList
  // record (`noAniListRecord` — stable MAL identity, nothing to flip to)
  // while the batch is in flight. The enrichment array stays RESIDENT
  // across re-fires (never reset to raw MAL): every fresh pass re-commits
  // AniList-backed records, so a re-render can never regress a card to its
  // MAL-titled/MAL-art state — that regression WAS the "identity crisis".
  // Still-hidden: only entries whose lookups haven't answered yet (a
  // throttle turn); they appear without a reload when a later pass (or the
  // resident context's own retry ladder) resolves them. MAL remains the
  // tracker-write source — never a rendering source for mapped entries.
  const [enrichedMalList, setEnrichedMalList] = useState<AnimeListEntry[] | null>(null)
  useEffect(() => {
    if (trackingProvider !== 'mal' || !mal.animeList) return
    const ctrl = new AbortController()
    let cancelled = false
    const commit = (all: AnimeListEntry[]) => {
      if (cancelled) return
      setEnrichedMalList(all.filter((e) => e.anime.identity.anilistId != null || e.noAniListRecord === true))
    }
    enrichMalEntriesWithAnilist(mal.animeList, {
      signal: ctrl.signal,
      onBatch: commit,
    }).then(commit).catch(() => {})
    return () => { cancelled = true; ctrl.abort() }
  }, [trackingProvider, mal.animeList])

  const combinedList = trackingProvider === 'mal'
    ? (enrichedMalList ?? [])
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

  // DATE STAMPS (owner rules 2026-10-18 + 2026-10-23): setting a title to
  // WATCHING always stamps today's start date; COMPLETED always stamps
  // today's finish date. The 10-23 tightening makes this unconditional —
  // entries auto-created by a progress write used to land in watching with
  // NO start date, and re-selecting Watching (same status) used to be a
  // no-op, leaving the tracker dateless forever.
  const updateStatus = useCallback(async (anime: Anime, status: AnimeStatus) => {
    const isManga = isMangaObj(anime)
    const dates: { start?: string; finish?: string } = {}
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    if (status === 'watching') dates.start = today
    if (status === 'completed') dates.finish = today
    if (active === 'anilist' && ani.isAuthenticated && isSyncEnabled('anilist', 'status')) {
      const anilistId = anime.identity.anilistId?.toString() ?? (anime.identity.internalId.startsWith('anilist-') ? anime.identity.internalId.replace('anilist-', '') : null)
      if (anilistId) { await ani.updateStatus(anilistId, status, isManga, dates).catch(() => {}); return }
      if (anime.identity.anilistId) { await ani.updateStatus(`anilist-${anime.identity.anilistId}`, status, isManga, dates).catch(() => {}); return }
    }
    if (active === 'mal' && mal.isAuthenticated && isSyncEnabled('mal', 'status')) {
      const malId = anime.identity.malId ? `mal-${anime.identity.malId}` : (anime.identity.internalId.startsWith('mal-') ? anime.identity.internalId : null)
      if (malId) { await mal.updateStatus(malId, status, isManga, dates).catch(() => {}); return }
      if (anime.identity.malId) { await mal.updateStatus(`mal-${anime.identity.malId}`, status, isManga, dates).catch(() => {}); return }
    }
  }, [active, ani.isAuthenticated, ani.updateStatus, mal.isAuthenticated, mal.updateStatus])

  // Current list status for this record, if it is already in the active
  // tracker's list. Used only to avoid re-stamping COMPLETED on every
  // rewatch of a finale (explicit user status changes always stamp).
  const currentListStatus = useCallback((anime: Anime): AnimeStatus | null => {
    const isManga = isMangaObj(anime)
    return (combinedList ?? []).find((e) => {
      if (isManga !== ['MANGA', 'NOVEL', 'ONE_SHOT'].includes((e.anime.format ?? '').toUpperCase())) return false
      if (anime.identity.malId && e.anime.identity.malId === anime.identity.malId) return true
      if (anime.identity.anilistId && e.anime.identity.anilistId === anime.identity.anilistId) return true
      return e.anime.identity.internalId === anime.identity.internalId
    })?.status ?? null
  }, [combinedList])

  const updateProgress = useCallback(async (anime: Anime, ep: number, opts?: { manual?: boolean }) => {
    // INCOGNITO GATE (owner 2026-10-23): automatic progress writes from
    // watching/reading never reach the tracker while incognito is on.
    // Manual, user-initiated edits pass `{ manual: true }` and still sync.
    if (!opts?.manual && isIncognitoEnabled()) return
    const isManga = isMangaObj(anime)
    let wrote = false
    if (active === 'anilist' && ani.isAuthenticated && isSyncEnabled('anilist', 'progress')) {
      const anilistId = anime.identity.anilistId?.toString() ?? (anime.identity.internalId.startsWith('anilist-') ? anime.identity.internalId.replace('anilist-', '') : null)
      // `wrote` flips ONLY after the provider call resolves: a failed
      // progress write must not be followed by a completed-status write.
      if (anilistId) { try { await ani.updateProgress(anilistId, ep, isManga); wrote = true } catch { /* no write */ } }
      else if (anime.identity.anilistId) { try { await ani.updateProgress(`anilist-${anime.identity.anilistId}`, ep, isManga); wrote = true } catch { /* no write */ } }
    } else if (active === 'mal' && mal.isAuthenticated && isSyncEnabled('mal', 'progress')) {
      const malId = anime.identity.malId ? `mal-${anime.identity.malId}` : (anime.identity.internalId.startsWith('mal-') ? anime.identity.internalId : null)
      if (malId) { try { await mal.updateProgress(malId, ep, isManga); wrote = true } catch { /* no write */ } }
      else if (anime.identity.malId) { try { await mal.updateProgress(`mal-${anime.identity.malId}`, ep, isManga); wrote = true } catch { /* no write */ } }
    }
    // AUTO-COMPLETE (owner 2026-10-23): reaching 100% of a KNOWN total
    // flips the entry to completed — which stamps the finish date. An
    // unknown total (airing show, ongoing manga) or a malformed count means
    // NO status write at all: incomplete data must never fake completion.
    // Already-completed entries are left alone so a finale rewatch cannot
    // rewrite the stored finish date.
    const total = isManga ? anime.chapters : anime.episodes
    if (wrote && total != null && Number.isFinite(total) && total > 0 && ep >= total && currentListStatus(anime) !== 'completed') {
      await updateStatus(anime, 'completed')
    }
  }, [active, ani.isAuthenticated, ani.updateProgress, mal.isAuthenticated, mal.updateProgress, updateStatus, currentListStatus])

  const updateRating = useCallback(async (anime: Anime, rating: number) => {
    const isManga = isMangaObj(anime)
    if (active === 'anilist' && ani.isAuthenticated && isSyncEnabled('anilist', 'rating')) {
      const anilistId = anime.identity.anilistId?.toString() ?? (anime.identity.internalId.startsWith('anilist-') ? anime.identity.internalId.replace('anilist-', '') : null)
      if (anilistId) { await ani.updateRating(anilistId, rating, isManga).catch(() => {}); return }
      if (anime.identity.anilistId) { await ani.updateRating(`anilist-${anime.identity.anilistId}`, rating, isManga).catch(() => {}); return }
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
      if (anilistId) { await ani.removeEntry(anilistId, isManga).catch(() => {}); return }
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
