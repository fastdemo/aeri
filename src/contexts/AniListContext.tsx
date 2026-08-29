import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { getAnilistToken, setAnilistToken, clearAnilistToken, isAnilistTokenExpired } from '../storage/anilist'
import { aniListProvider, type AniListUser } from '../providers/anilist/provider'
import { handleAnilistOAuthCallback, parseManualToken, beginAnilistOAuth, getRedirectUriForDisplay } from '../services/anilist/auth'
import { ProviderError } from '../services/anilist/errors'
import { clearAnilistMemoryCache } from '../services/anilist/client'
import type { AnimeListEntry, AnimeStatus } from '../types/anime'

type Ctx = {
  isAuthenticated: boolean
  token: string | null
  user: AniListUser | null
  animeList: AnimeListEntry[] | null
  loadingUser: boolean
  loadingList: boolean
  error: string | null
  authExpired: boolean
  redirectUri: string
  hasClientId: boolean
  login: () => void
  logout: () => void
  setManualToken: (raw: string) => boolean
  refresh: () => Promise<void>
  updateProgress: (id: string, ep: number) => Promise<void>
  updateStatus: (id: string, status: AnimeStatus) => Promise<void>
  updateRating: (id: string, rating: number) => Promise<void>
}

const AniListContext = createContext<Ctx | null>(null)

export function useAniList() {
  const v = useContext(AniListContext)
  if (!v) throw new Error('useAniList must be inside AniListProvider')
  return v
}

export function AniListProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() => getAnilistToken())
  const [user, setUser] = useState<AniListUser | null>(null)
  const [animeList, setAnimeList] = useState<AnimeListEntry[] | null>(null)
  const [loadingUser, setLoadingUser] = useState(false)
  const [loadingList, setLoadingList] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [authExpired, setAuthExpired] = useState(false)

  const isAuthenticated = !!token && !isAnilistTokenExpired()
  const redirectUri = getRedirectUriForDisplay()
  const hasClientId = !!(import.meta.env.VITE_ANILIST_CLIENT_ID as string | undefined)?.trim()

  const friendly = (e: unknown) => {
    if (e instanceof ProviderError) {
      if (e.code === 'AUTH') return e.message
      if (e.code === 'NETWORK') return e.message
      if (e.code === 'NOT_FOUND') return e.message
      return e.message
    }
    return e instanceof Error ? e.message : 'Something went wrong.'
  }

  const loadUser = useCallback(async (t: string) => {
    setLoadingUser(true)
    setError(null)
    setAuthExpired(false)
    try {
      const u = await aniListProvider.getUser(t)
      setUser(u)
      setAuthExpired(false)
    } catch (e) {
      if (e instanceof ProviderError && e.code === 'AUTH') {
        setAuthExpired(true)
        setError(e.message)
        clearAnilistToken()
        setToken(null)
        setUser(null)
      } else {
        setError(friendly(e))
      }
      throw e
    } finally {
      setLoadingUser(false)
    }
  }, [])

  const loadList = useCallback(async (t: string) => {
    setLoadingList(true)
    setError(null)
    try {
      const list = await aniListProvider.getAnimeList(t)
      setAnimeList(list)
      setAuthExpired(false)
    } catch (e) {
      if (e instanceof ProviderError && e.code === 'AUTH') {
        setAuthExpired(true)
        setError(e.message)
        clearAnilistToken()
        setToken(null)
        setAnimeList(null)
        setUser(null)
      } else {
        setError(friendly(e))
      }
      throw e
    } finally {
      setLoadingList(false)
    }
  }, [])

  const refresh = useCallback(async () => {
    const t = getAnilistToken()
    if (!t) return
    try {
      await loadUser(t)
      await loadList(t)
    } catch {}
  }, [loadUser, loadList])

  // Initial: handle OAuth callback hash, then load if token exists
  useEffect(() => {
    const handled = handleAnilistOAuthCallback()
    if (handled) {
      setToken(handled)
      // proceed to load
      loadUser(handled).then(() => loadList(handled)).catch(() => {})
      return
    }
    const existing = getAnilistToken()
    if (existing) {
      if (isAnilistTokenExpired()) {
        setAuthExpired(true)
        setError('AniList session expired. Please reconnect.')
        clearAnilistToken()
        setToken(null)
        return
      }
      setToken(existing)
      loadUser(existing).then(() => loadList(existing)).catch(() => {})
    }
    const onLogout = () => {
      clearAnilistMemoryCache()
      setUser(null)
      setAnimeList(null)
    }
    window.addEventListener('aeri:anilist:logout', onLogout as EventListener)
    return () => window.removeEventListener('aeri:anilist:logout', onLogout as EventListener)
  }, [loadUser, loadList])

  const login = useCallback(() => {
    setError(null)
    if (hasClientId) {
      try {
        beginAnilistOAuth()
      } catch (e) {
        setError(friendly(e))
      }
    } else {
      // No client — UI should show manual token entry; we set error to guide
      setError('AniList Client ID not configured. Paste your access token below or set VITE_ANILIST_CLIENT_ID.')
    }
  }, [hasClientId])

  const logout = useCallback(() => {
    clearAnilistToken()
    clearAnilistMemoryCache()
    setToken(null)
    setUser(null)
    setAnimeList(null)
    setError(null)
    setAuthExpired(false)
  }, [])

  const setManualToken = useCallback((raw: string): boolean => {
    const parsed = parseManualToken(raw)
    if (!parsed) {
      setError('That token doesn’t look valid. Paste the full access token from AniList.')
      return false
    }
    setAnilistToken(parsed)
    setToken(parsed)
    setError(null)
    setAuthExpired(false)
    // trigger load
    loadUser(parsed).then(() => loadList(parsed)).catch(() => {})
    return true
  }, [loadList, loadUser])

  const optimisticUpdate = useCallback((id: string, patch: Partial<{ progress: number; status: AnimeStatus; score: number }>) => {
    setAnimeList((prev) => {
      if (!prev) return prev
      return prev.map((e) => {
        const aid = e.anime.identity.anilistId?.toString() ?? e.anime.identity.internalId
        const target = id.startsWith('anilist-') ? id.replace('anilist-', '') : id
        const entryAid = e.anime.identity.anilistId?.toString() ?? e.anime.identity.internalId
        if (entryAid !== target && aid !== id) return e
        const nextAnime = { ...e.anime }
        if (patch.progress !== undefined) {
          const episodes = nextAnime.episodes ?? 0
          const percent = episodes > 0 ? Math.round((patch.progress / episodes) * 100) : 50
          nextAnime.progress = { episode: patch.progress, percent }
        }
        if (patch.status !== undefined) nextAnime.listStatus = patch.status
        return {
          ...e,
          progress: patch.progress ?? e.progress,
          status: (patch.status ?? e.status) as AnimeStatus,
          score: patch.score ?? e.score,
          anime: nextAnime,
        }
      })
    })
  }, [])

  const updateProgress = useCallback(async (id: string, ep: number) => {
    optimisticUpdate(id, { progress: ep })
    try {
      await aniListProvider.updateProgress(id, ep)
      const t = getAnilistToken()
      if (t) await loadList(t).catch(() => {})
    } catch (e) {
      setError(friendly(e))
      // revert by reloading
      const t = getAnilistToken()
      if (t) await loadList(t).catch(() => {})
      throw e
    }
  }, [optimisticUpdate, loadList])

  const updateStatus = useCallback(async (id: string, status: AnimeStatus) => {
    optimisticUpdate(id, { status })
    try {
      await aniListProvider.updateStatus(id, status)
      const t = getAnilistToken()
      if (t) await loadList(t).catch(() => {})
    } catch (e) {
      setError(friendly(e))
      const t = getAnilistToken()
      if (t) await loadList(t).catch(() => {})
      throw e
    }
  }, [optimisticUpdate, loadList])

  const updateRating = useCallback(async (id: string, rating: number) => {
    optimisticUpdate(id, { score: rating })
    try {
      await aniListProvider.updateRating(id, rating)
      const t = getAnilistToken()
      if (t) await loadList(t).catch(() => {})
    } catch (e) {
      setError(friendly(e))
      const t = getAnilistToken()
      if (t) await loadList(t).catch(() => {})
      throw e
    }
  }, [optimisticUpdate, loadList])

  const value = useMemo<Ctx>(() => ({
    isAuthenticated,
    token,
    user,
    animeList,
    loadingUser,
    loadingList,
    error,
    authExpired,
    redirectUri,
    hasClientId,
    login,
    logout,
    setManualToken,
    refresh,
    updateProgress,
    updateStatus,
    updateRating,
  }), [isAuthenticated, token, user, animeList, loadingUser, loadingList, error, authExpired, redirectUri, hasClientId, login, logout, setManualToken, refresh, updateProgress, updateStatus, updateRating])

  return <AniListContext.Provider value={value}>{children}</AniListContext.Provider>
}
