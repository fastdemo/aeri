import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { getMalToken, setMalTokens, clearMalTokens, isMalTokenExpired } from '../storage/mal'
import { malProvider } from '../providers/mal/provider'
import { handleMalOAuthCallback, parseMalManualToken, getMalRedirectUriForDisplay } from '../services/mal/auth'
import { MalProviderError } from '../services/mal/client'
import { clearMalMemoryCache } from '../services/mal/client'
import type { AnimeListEntry, AnimeStatus } from '../types/anime'
import type { AniListUser } from '../providers/anilist/provider'

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
  login: () => Promise<void>
  logout: () => void
  setManualToken: (raw: string) => boolean
  refresh: () => Promise<void>
  updateProgress: (id: string, ep: number) => Promise<void>
  updateStatus: (id: string, status: AnimeStatus) => Promise<void>
  updateRating: (id: string, rating: number) => Promise<void>
}

const MALContext = createContext<Ctx | null>(null)

export function useMAL() {
  const v = useContext(MALContext)
  if (!v) throw new Error('useMAL must be inside MALProvider')
  return v
}

export function MALProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(() => getMalToken())
  const [user, setUser] = useState<AniListUser | null>(null)
  const [animeList, setAnimeList] = useState<AnimeListEntry[] | null>(null)
  const [loadingUser, setLoadingUser] = useState(false)
  const [loadingList, setLoadingList] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [authExpired, setAuthExpired] = useState(false)

  const isAuthenticated = !!token && !isMalTokenExpired()
  const redirectUri = getMalRedirectUriForDisplay()
  const hasClientId = !!((import.meta as any).env?.VITE_MAL_CLIENT_ID as string | undefined)?.trim()

  const friendly = (e: unknown) => {
    if (e instanceof MalProviderError) {
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
      const u = await malProvider.getUser(t)
      setUser(u)
      setAuthExpired(false)
    } catch (e) {
      if (e instanceof MalProviderError && e.code === 'AUTH') {
        setAuthExpired(true)
        setError(e.message)
        clearMalTokens()
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
      const list = await malProvider.getAnimeList(t)
      setAnimeList(list)
      setAuthExpired(false)
    } catch (e) {
      if (e instanceof MalProviderError && e.code === 'AUTH') {
        setAuthExpired(true)
        setError(e.message)
        clearMalTokens()
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
    const t = getMalToken()
    if (!t) return
    try {
      await loadUser(t)
      await loadList(t)
    } catch {}
  }, [loadUser, loadList])

  useEffect(() => {
    // Handle MAL OAuth callback (code in search)
    const url = new URL(window.location.href)
    if (url.searchParams.has('code')) {
      handleMalOAuthCallback()
        .then((tok) => {
          if (tok) {
            setToken(tok)
            loadUser(tok).then(() => loadList(tok)).catch(()=>{})
          }
        })
        .catch((e) => setError(friendly(e)))
      return
    }
    const existing = getMalToken()
    if (existing) {
      if (isMalTokenExpired()) {
        // try refresh is handled inside client via ensureFreshToken, but we can attempt load
      }
      setToken(existing)
      loadUser(existing).then(() => loadList(existing)).catch(()=>{})
    }
    const onLogout = () => {
      clearMalMemoryCache()
      setUser(null)
      setAnimeList(null)
    }
    window.addEventListener('aeri:mal:logout', onLogout as EventListener)
    return () => window.removeEventListener('aeri:mal:logout', onLogout as EventListener)
  }, [loadUser, loadList])

  const login = useCallback(async () => {
    setError(null)
    if (!hasClientId) {
      setError('MyAnimeList Client ID not configured. Set VITE_MAL_CLIENT_ID or paste token.')
      return
    }
    try {
      const { beginMalOAuth } = await import('../services/mal/auth')
      await beginMalOAuth()
    } catch (e) {
      setError(friendly(e))
    }
  }, [hasClientId])

  const logout = useCallback(() => {
    clearMalTokens()
    clearMalMemoryCache()
    setToken(null)
    setUser(null)
    setAnimeList(null)
    setError(null)
    setAuthExpired(false)
  }, [])

  const setManualToken = useCallback((raw: string): boolean => {
    const parsed = parseMalManualToken(raw)
    if (!parsed) {
      setError('That token doesn’t look valid. Paste your MyAnimeList access token.')
      return false
    }
    setMalTokens(parsed)
    setToken(parsed)
    setError(null)
    setAuthExpired(false)
    loadUser(parsed).then(() => loadList(parsed)).catch(()=>{})
    return true
  }, [loadList, loadUser])

  const optimisticUpdate = useCallback((id: string, patch: Partial<{ progress: number; status: AnimeStatus; score: number }>) => {
    setAnimeList((prev) => {
      if (!prev) return prev
      return prev.map((e) => {
        const aid = e.anime.identity.malId?.toString() ?? e.anime.identity.internalId
        const target = id.replace('mal-', '')
        const entryAid = e.anime.identity.malId?.toString() ?? e.anime.identity.internalId
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
      // For MAL, id may be mal- or anilist- mapped; try to resolve malId
      // If id is anilist-xxx, we need to find malId from current list or via mapping
      let malId = id
      if (id.startsWith('anilist-')) {
        // Try to find corresponding malId via current list's anilist->mal mapping if available
        const found = animeList?.find(e => e.anime.identity.anilistId?.toString() === id.replace('anilist-',''))
        if (found?.anime.identity.malId) malId = `mal-${found.anime.identity.malId}`
        else malId = id // will fail gracefully with NOT_FOUND handled
      }
      await malProvider.updateProgress(malId, ep)
      const t = getMalToken()
      if (t) await loadList(t).catch(()=>{})
    } catch (e) {
      setError(friendly(e))
      const t = getMalToken()
      if (t) await loadList(t).catch(()=>{})
      throw e
    }
  }, [optimisticUpdate, loadList, animeList])

  const updateStatus = useCallback(async (id: string, status: AnimeStatus) => {
    optimisticUpdate(id, { status })
    try {
      let malId = id
      if (id.startsWith('anilist-')) {
        const found = animeList?.find(e => e.anime.identity.anilistId?.toString() === id.replace('anilist-',''))
        if (found?.anime.identity.malId) malId = `mal-${found.anime.identity.malId}`
      }
      await malProvider.updateStatus(malId, status)
      const t = getMalToken()
      if (t) await loadList(t).catch(()=>{})
    } catch (e) {
      setError(friendly(e))
      const t = getMalToken()
      if (t) await loadList(t).catch(()=>{})
      throw e
    }
  }, [optimisticUpdate, loadList, animeList])

  const updateRating = useCallback(async (id: string, rating: number) => {
    optimisticUpdate(id, { score: rating })
    try {
      let malId = id
      if (id.startsWith('anilist-')) {
        const found = animeList?.find(e => e.anime.identity.anilistId?.toString() === id.replace('anilist-',''))
        if (found?.anime.identity.malId) malId = `mal-${found.anime.identity.malId}`
      }
      await malProvider.updateRating(malId, rating)
      const t = getMalToken()
      if (t) await loadList(t).catch(()=>{})
    } catch (e) {
      setError(friendly(e))
      const t = getMalToken()
      if (t) await loadList(t).catch(()=>{})
      throw e
    }
  }, [optimisticUpdate, loadList, animeList])

  const value = useMemo<Ctx>(() => ({
    isAuthenticated, token, user, animeList, loadingUser, loadingList, error, authExpired, redirectUri, hasClientId, login, logout, setManualToken, refresh, updateProgress, updateStatus, updateRating,
  }), [isAuthenticated, token, user, animeList, loadingUser, loadingList, error, authExpired, redirectUri, hasClientId, login, logout, setManualToken, refresh, updateProgress, updateStatus, updateRating])

  return <MALContext.Provider value={value}>{children}</MALContext.Provider>
}
