import { useEffect, useState } from 'react'
import type { Anime } from '../types/anime'
import { anilistMetadataProvider } from '../providers/metadata/anilistMetadata'
import { ProviderError } from '../services/anilist/errors'
import { deduplicateBySeries } from '../services/anilist/series'

type State<T> = { data: T | null; loading: boolean; error: string | null }

function useData<T>(fetcher: (signal: AbortSignal) => Promise<T>, deps: any[], options?: { dedupe?: boolean }): State<T> {
  const [state, setState] = useState<State<T>>({ data: null, loading: true, error: null })
  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    // Preserve data while revalidating (stale-while-revalidate)
    setState(s => ({ data: s.data, loading: true, error: null }))
    fetcher(controller.signal)
      .then(d => {
        if (cancelled || controller.signal.aborted) return
        // Optionally dedupe for series
        const data = options?.dedupe && Array.isArray(d) ? deduplicateBySeries(d as any) as any : d
        setState({ data, loading: false, error: null })
      })
      .catch(e => {
        if (cancelled || controller.signal.aborted || (e as any)?.name === 'AbortError') return
        const msg = e instanceof ProviderError ? e.message : e instanceof Error ? e.message : 'Something went wrong.'
        if (!cancelled) setState(s => ({ data: s.data, loading: false, error: msg }))
      })
    return () => {
      cancelled = true
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return state
}

export function useTrending(perPage = 12): State<Anime[]> {
  return useData<Anime[]>(signal => anilistMetadataProvider.getTrending(perPage, signal), [perPage])
}

export function usePopular(perPage = 12): State<Anime[]> {
  return useData<Anime[]>(signal => anilistMetadataProvider.getPopular(perPage, signal), [perPage])
}

export function useAiring(perPage = 12): State<Anime[]> {
  return useData<Anime[]>(signal => anilistMetadataProvider.getAiring(perPage, signal), [perPage])
}

export function useNewReleases(perPage = 12): State<Anime[]> {
  return useData<Anime[]>(signal => anilistMetadataProvider.getNewReleases(perPage, signal), [perPage])
}

export function useUpcoming(perPage = 12): State<Anime[]> {
  return useData<Anime[]>(signal => anilistMetadataProvider.getUpcoming(perPage, signal), [perPage])
}

export function useFinished(perPage = 12): State<Anime[]> {
  return useData<Anime[]>(signal => anilistMetadataProvider.getFinished(perPage, signal), [perPage])
}

export type BrowseState = { data: Anime[] | null; loading: boolean; error: string | null; hasNextPage: boolean; page: number }
export function useBrowse(params: { sort?: string; status?: string; genre?: string; seasonYear?: number; season?: string; format?: string; perPage?: number; page?: number }): BrowseState & { loadMore: () => void } {
  const { sort, status, genre, seasonYear, season, format, perPage = 24 } = params
  const [state, setState] = useState<BrowseState>({ data: null, loading: true, error: null, hasNextPage: false, page: 1 })
  const [page, setPage] = useState(1)

  // Reset page when filters change
  useEffect(() => { setPage(1) }, [sort, status, genre, seasonYear, season, format, perPage])

  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false
    setState(s => ({ ...s, loading: true, error: null }))
    const p = params.page ?? page
    anilistMetadataProvider.browse({ sort: sort as any, status: status as any, genre, seasonYear, season: season as any, format: format as any, perPage, page: p }, controller.signal)
      .then(res => {
        if (cancelled || controller.signal.aborted) return
        setState(prev => ({
          data: p === 1 ? res.data : [...(prev.data ?? []), ...res.data],
          loading: false,
          error: null,
          hasNextPage: res.hasNextPage,
          page: res.pageInfo.currentPage,
        }))
      })
      .catch(e => {
        if (cancelled || controller.signal.aborted || (e as any)?.name === 'AbortError') return
        const msg = e instanceof ProviderError ? e.message : e instanceof Error ? e.message : 'Something went wrong.'
        if (!cancelled) setState(s => ({ ...s, loading: false, error: msg }))
      })
    return () => { cancelled = true; controller.abort() }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, status, genre, seasonYear, season, format, perPage, page])

  const loadMore = () => { if (state.hasNextPage && !state.loading) setPage(p => p + 1) }
  return { ...state, loadMore }
}

export function useAnimeSearch(query: string, perPage = 12): State<Anime[]> {
  const [state, setState] = useState<State<Anime[]>>({ data: null, loading: false, error: null })
  useEffect(() => {
    if (!query.trim()) {
      setState({ data: [], loading: false, error: null })
      return
    }
    const controller = new AbortController()
    let cancelled = false
    const t = setTimeout(() => {
      setState(s => ({ data: s.data, loading: true, error: null }))
      anilistMetadataProvider.search(query.trim(), perPage, controller.signal)
        .then(d => {
          if (cancelled || controller.signal.aborted) return
          const deduped = deduplicateBySeries(d)
          setState({ data: deduped, loading: false, error: null })
        })
        .catch(e => {
          if (cancelled || controller.signal.aborted || (e as any)?.name === 'AbortError') return
          const msg = e instanceof ProviderError ? e.message : e instanceof Error ? e.message : 'Search failed'
          if (!cancelled) setState(s => ({ data: s.data, loading: false, error: msg }))
        })
    }, 300)
    return () => { clearTimeout(t); cancelled = true; controller.abort() }
  }, [query, perPage])
  return state
}

export function useAnimeDetail(id: string | undefined): State<Anime> {
  const [state, setState] = useState<State<Anime>>({ data: null, loading: !!id, error: null })
  useEffect(() => {
    if (!id) { setState({ data: null, loading: false, error: null }); return }
    const controller = new AbortController()
    let cancelled = false
    setState(s => ({ data: s.data, loading: true, error: null }))
    anilistMetadataProvider.getAnime(id, controller.signal)
      .then(d => { if (!cancelled && !controller.signal.aborted) setState({ data: d, loading: false, error: null }) })
      .catch(e => {
        if (cancelled || controller.signal.aborted || (e as any)?.name === 'AbortError') return
        const msg = e instanceof ProviderError ? e.message : e instanceof Error ? e.message : 'Not found'
        if (!cancelled) setState(s => ({ data: s.data, loading: false, error: msg }))
      })
    return () => { cancelled = true; controller.abort() }
  }, [id])
  return state
}
