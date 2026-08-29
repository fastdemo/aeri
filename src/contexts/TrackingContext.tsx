import React, { createContext, useContext, useMemo } from 'react'
import { useAniList } from './AniListContext'
import { useMAL } from './MALContext'
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

  const updateProgress = async (anime: Anime, ep: number) => {
    const promises: Promise<void>[] = []
    // AniList path: if anime has anilistId or we can resolve via malId mapping
    if (ani.isAuthenticated) {
      const anilistId = anime.identity.anilistId?.toString() ?? (anime.identity.internalId.startsWith('anilist-') ? anime.identity.internalId.replace('anilist-', '') : null)
      // If anime is MAL-only (mal-xxx), we may need to find corresponding anilistId via AniList search? For now, try to use malId to find anilist entry via list already, but if not found, skip AniList
      // If anime has malId and is from MAL, try to find anilistId via existing combined? For now, just try anilistId if present
      if (anilistId) {
        promises.push(ani.updateProgress(anilistId, ep).catch(()=>{}))
      } else if (anime.identity.malId) {
        // Try to search AniList for this MAL id via idMal? Our provider getAnime via anilistId only, not malId. For simplicity, skip AniList if no anilistId
      }
    }
    if (mal.isAuthenticated) {
      // MAL needs malId; if anime has malId use it, else if anilistId has known malId via AniList's idMal, use that
      let malId: string | null = anime.identity.malId ? `mal-${anime.identity.malId}` : null
      if (!malId && anime.identity.anilistId) {
        // Try to find malId from AniList's data: the anime from AniList already has malId if available
        // If this anime came from AniList, its malId may be present in identity
        // If not, we try to use anilistId as malId? Not correct, but fallback to anilistId string for MAL will fail gracefully
        // For now, if no malId, try to use anilistId as malId? Better to skip MAL if no malId
        // Actually MAL update requires malId, not anilistId, so skip if no malId
        malId = null
      }
      if (malId) {
        promises.push(mal.updateProgress(malId, ep).catch(()=>{}))
      } else if (anime.identity.internalId.startsWith('mal-')) {
        promises.push(mal.updateProgress(anime.identity.internalId, ep).catch(()=>{}))
      }
      // If anime is AniList-only but has malId via AniList's idMal, that malId is in identity, so above handles
    }
    // If no provider handled, fallback to whichever authenticated provider can handle via internalId
    if (promises.length === 0) {
      if (ani.isAuthenticated && anime.identity.anilistId) promises.push(ani.updateProgress(`anilist-${anime.identity.anilistId}`, ep).catch(()=>{}))
      if (mal.isAuthenticated && anime.identity.malId) promises.push(mal.updateProgress(`mal-${anime.identity.malId}`, ep).catch(()=>{}))
    }
    await Promise.allSettled(promises)
  }

  const updateStatus = async (anime: Anime, status: AnimeStatus) => {
    const promises: Promise<void>[] = []
    if (ani.isAuthenticated) {
      const anilistId = anime.identity.anilistId?.toString() ?? (anime.identity.internalId.startsWith('anilist-') ? anime.identity.internalId.replace('anilist-', '') : null)
      if (anilistId) promises.push(ani.updateStatus(anilistId, status).catch(()=>{}))
      else if (anime.identity.malId) {
        // No anilistId, skip
      }
    }
    if (mal.isAuthenticated) {
      let malId: string | null = anime.identity.malId ? `mal-${anime.identity.malId}` : null
      if (!malId && anime.identity.internalId.startsWith('mal-')) malId = anime.identity.internalId
      if (malId) promises.push(mal.updateStatus(malId, status).catch(()=>{}))
    }
    if (promises.length === 0) {
      if (ani.isAuthenticated && anime.identity.anilistId) promises.push(ani.updateStatus(`anilist-${anime.identity.anilistId}`, status).catch(()=>{}))
      if (mal.isAuthenticated && anime.identity.malId) promises.push(mal.updateStatus(`mal-${anime.identity.malId}`, status).catch(()=>{}))
    }
    await Promise.allSettled(promises)
  }

  const updateRating = async (anime: Anime, rating: number) => {
    const promises: Promise<void>[] = []
    if (ani.isAuthenticated) {
      const anilistId = anime.identity.anilistId?.toString() ?? (anime.identity.internalId.startsWith('anilist-') ? anime.identity.internalId.replace('anilist-', '') : null)
      if (anilistId) promises.push(ani.updateRating(anilistId, rating).catch(()=>{}))
    }
    if (mal.isAuthenticated) {
      let malId: string | null = anime.identity.malId ? `mal-${anime.identity.malId}` : null
      if (!malId && anime.identity.internalId.startsWith('mal-')) malId = anime.identity.internalId
      if (malId) promises.push(mal.updateRating(malId, rating).catch(()=>{}))
    }
    if (promises.length === 0) {
      if (ani.isAuthenticated && anime.identity.anilistId) promises.push(ani.updateRating(`anilist-${anime.identity.anilistId}`, rating).catch(()=>{}))
      if (mal.isAuthenticated && anime.identity.malId) promises.push(mal.updateRating(`mal-${anime.identity.malId}`, rating).catch(()=>{}))
    }
    await Promise.allSettled(promises)
  }

  const value: UnifiedTracking = {
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
  }

  return <TrackingContext.Provider value={value}>{children}</TrackingContext.Provider>
}
