import React, { createContext, useContext, useMemo, useCallback } from 'react'
import { useAniList } from './AniListContext'
import { useMAL } from './MALContext'
import { isSyncEnabled } from '../storage/preferences'
import type { Anime, AnimeListEntry, AnimeStatus } from '../types/anime'

type UnifiedTracking = {
  isAuthenticated: boolean
  isAniListAuthenticated: boolean
  isMALAuthenticated: boolean
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

// Dedup logic: prefer AniList metadata (richer banner), but keep malId
function dedupAndMerge(anilist: AnimeListEntry[] | null, mal: AnimeListEntry[] | null): AnimeListEntry[] | null {
  if (!anilist && !mal) return null
  if (!anilist) return mal
  if (!mal) return anilist

  const map = new Map<string, AnimeListEntry>()
  const keyFor = (e: AnimeListEntry) => {
    const malId = e.anime.identity.malId
    if (malId) return `mal-${malId}`
    const aid = e.anime.identity.anilistId
    if (aid) return `anilist-${aid}`
    return e.anime.identity.internalId
  }

  // Insert AniList first (richer)
  for (const e of anilist) {
    const k = keyFor(e)
    map.set(k, e)
  }
  // Merge MAL: if key exists, merge
  for (const m of mal) {
    const k = keyFor(m)
    const existing = map.get(k)
    if (existing) {
      // Same anime in both: merge identities, keep AniList's Anime but add malId if missing
      const mergedAnime: Anime = {
        ...existing.anime,
        identity: {
          ...existing.anime.identity,
          malId: existing.anime.identity.malId ?? m.anime.identity.malId,
          anilistId: existing.anime.identity.anilistId ?? m.anime.identity.anilistId,
        },
        // Keep progress/status from more recent? For now keep AniList's, but also ensure mal progress isn't lost if higher
        // Choose max progress
        progress: (m.progress > existing.progress) ? m.anime.progress : existing.anime.progress,
        listStatus: existing.status, // keep AniList status as primary
      }
      // If MAL has different status, we keep AniList but note - no overwrite without explicit rule
      // For now, keep existing entry but with merged identity
      map.set(k, {
        ...existing,
        anime: mergedAnime,
        // Keep score from whichever is non-zero? Prefer AniList
      })
    } else {
      // New MAL-only entry: check if AniList entry has same malId via different key? Already handled via mal- key
      // Also try title dedup as fallback if no ids?
      map.set(k, m)
    }
  }

  // Also try secondary dedup by malId if an AniList entry's malId matches MAL entry's malId but keys differed (e.g., anilist entry key was anilist-xxx but mal is mal-yyy where yyy == anilist's malId)
  // Our keyFor already uses malId when present, so anilist entry with malId will be keyed as mal-xxx, same as MAL entry, so dedup works.
  return Array.from(map.values())
}

export function TrackingProvider({ children }: { children: React.ReactNode }) {
  const ani = useAniList()
  const mal = useMAL()

  const combinedList = useMemo(() => dedupAndMerge(ani.animeList, mal.animeList), [ani.animeList, mal.animeList])

  const isAuthenticated = ani.isAuthenticated || mal.isAuthenticated
  const loading = ani.loadingList || mal.loadingList
  const error = ani.error || mal.error
  const authExpired = ani.authExpired || mal.authExpired

  const updateProgress = useCallback(async (anime: Anime, ep: number) => {
    const promises: Promise<void>[] = []
    if (ani.isAuthenticated && isSyncEnabled('anilist', 'progress')) {
      const anilistId = anime.identity.anilistId?.toString() ?? (anime.identity.internalId.startsWith('anilist-') ? anime.identity.internalId.replace('anilist-', '') : null)
      if (anilistId) promises.push(ani.updateProgress(anilistId, ep).catch(()=>{}))
    }
    if (mal.isAuthenticated && isSyncEnabled('mal', 'progress')) {
      let malId: string | null = anime.identity.malId ? `mal-${anime.identity.malId}` : null
      if (!malId && anime.identity.internalId.startsWith('mal-')) malId = anime.identity.internalId
      if (malId) promises.push(mal.updateProgress(malId, ep).catch(()=>{}))
    }
    if (promises.length === 0) {
      if (ani.isAuthenticated && isSyncEnabled('anilist', 'progress') && anime.identity.anilistId) promises.push(ani.updateProgress(`anilist-${anime.identity.anilistId}`, ep).catch(()=>{}))
      if (mal.isAuthenticated && isSyncEnabled('mal', 'progress') && anime.identity.malId) promises.push(mal.updateProgress(`mal-${anime.identity.malId}`, ep).catch(()=>{}))
    }
    await Promise.allSettled(promises)
  }, [ani.isAuthenticated, ani.updateProgress, mal.isAuthenticated, mal.updateProgress])

  const updateStatus = useCallback(async (anime: Anime, status: AnimeStatus) => {
    const promises: Promise<void>[] = []
    if (ani.isAuthenticated && isSyncEnabled('anilist', 'status')) {
      const anilistId = anime.identity.anilistId?.toString() ?? (anime.identity.internalId.startsWith('anilist-') ? anime.identity.internalId.replace('anilist-', '') : null)
      if (anilistId) promises.push(ani.updateStatus(anilistId, status).catch(()=>{}))
    }
    if (mal.isAuthenticated && isSyncEnabled('mal', 'status')) {
      let malId: string | null = anime.identity.malId ? `mal-${anime.identity.malId}` : null
      if (!malId && anime.identity.internalId.startsWith('mal-')) malId = anime.identity.internalId
      if (malId) promises.push(mal.updateStatus(malId, status).catch(()=>{}))
    }
    if (promises.length === 0) {
      if (ani.isAuthenticated && isSyncEnabled('anilist', 'status') && anime.identity.anilistId) promises.push(ani.updateStatus(`anilist-${anime.identity.anilistId}`, status).catch(()=>{}))
      if (mal.isAuthenticated && isSyncEnabled('mal', 'status') && anime.identity.malId) promises.push(mal.updateStatus(`mal-${anime.identity.malId}`, status).catch(()=>{}))
    }
    await Promise.allSettled(promises)
  }, [ani.isAuthenticated, ani.updateStatus, mal.isAuthenticated, mal.updateStatus])

  const updateRating = useCallback(async (anime: Anime, rating: number) => {
    const promises: Promise<void>[] = []
    if (ani.isAuthenticated && isSyncEnabled('anilist', 'rating')) {
      const anilistId = anime.identity.anilistId?.toString() ?? (anime.identity.internalId.startsWith('anilist-') ? anime.identity.internalId.replace('anilist-', '') : null)
      if (anilistId) promises.push(ani.updateRating(anilistId, rating).catch(()=>{}))
    }
    if (mal.isAuthenticated && isSyncEnabled('mal', 'rating')) {
      let malId: string | null = anime.identity.malId ? `mal-${anime.identity.malId}` : null
      if (!malId && anime.identity.internalId.startsWith('mal-')) malId = anime.identity.internalId
      if (malId) promises.push(mal.updateRating(malId, rating).catch(()=>{}))
    }
    if (promises.length === 0) {
      if (ani.isAuthenticated && isSyncEnabled('anilist', 'rating') && anime.identity.anilistId) promises.push(ani.updateRating(`anilist-${anime.identity.anilistId}`, rating).catch(()=>{}))
      if (mal.isAuthenticated && isSyncEnabled('mal', 'rating') && anime.identity.malId) promises.push(mal.updateRating(`mal-${anime.identity.malId}`, rating).catch(()=>{}))
    }
    await Promise.allSettled(promises)
  }, [ani.isAuthenticated, ani.updateRating, mal.isAuthenticated, mal.updateRating])

  const value: UnifiedTracking = useMemo(() => ({
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
  }), [isAuthenticated, ani.isAuthenticated, mal.isAuthenticated, combinedList, loading, error, authExpired, updateProgress, updateStatus, updateRating])

  return <TrackingContext.Provider value={value}>{children}</TrackingContext.Provider>
}
