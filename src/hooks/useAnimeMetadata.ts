import { useEffect, useState } from 'react'
import type { Anime } from '../types/anime'
import { anilistMetadataProvider } from '../providers/metadata/anilistMetadata'
import { ProviderError } from '../services/anilist/errors'

type State<T> = { data: T | null; loading: boolean; error: string | null }

export function useTrending(perPage = 12): State<Anime[]> {
  const [state, setState] = useState<State<Anime[]>>({ data: null, loading: true, error: null })
  useEffect(() => {
    let cancelled = false
    setState({ data: null, loading: true, error: null })
    anilistMetadataProvider.getTrending(perPage)
      .then(d => { if (!cancelled) setState({ data: d, loading: false, error: null }) })
      .catch(e => {
        const msg = e instanceof ProviderError ? e.message : e instanceof Error ? e.message : 'Something went wrong.'
        if (!cancelled) setState({ data: null, loading: false, error: msg })
      })
    return () => { cancelled = true }
  }, [perPage])
  return state
}

export function usePopular(perPage = 12): State<Anime[]> {
  const [state, setState] = useState<State<Anime[]>>({ data: null, loading: true, error: null })
  useEffect(() => {
    let cancelled = false
    setState({ data: null, loading: true, error: null })
    anilistMetadataProvider.getPopular(perPage)
      .then(d => { if (!cancelled) setState({ data: d, loading: false, error: null }) })
      .catch(e => {
        const msg = e instanceof ProviderError ? e.message : e instanceof Error ? e.message : 'Something went wrong.'
        if (!cancelled) setState({ data: null, loading: false, error: msg })
      })
    return () => { cancelled = true }
  }, [perPage])
  return state
}

export function useAiring(perPage = 12): State<Anime[]> {
  const [state, setState] = useState<State<Anime[]>>({ data: null, loading: true, error: null })
  useEffect(() => {
    let cancelled = false
    setState({ data: null, loading: true, error: null })
    anilistMetadataProvider.getAiring(perPage)
      .then(d => { if (!cancelled) setState({ data: d, loading: false, error: null }) })
      .catch(e => {
        const msg = e instanceof ProviderError ? e.message : e instanceof Error ? e.message : 'Something went wrong.'
        if (!cancelled) setState({ data: null, loading: false, error: msg })
      })
    return () => { cancelled = true }
  }, [perPage])
  return state
}

export function useNewReleases(perPage = 12): State<Anime[]> {
  const [state, setState] = useState<State<Anime[]>>({ data: null, loading: true, error: null })
  useEffect(() => {
    let cancelled = false
    setState({ data: null, loading: true, error: null })
    anilistMetadataProvider.getNewReleases(perPage)
      .then(d => { if (!cancelled) setState({ data: d, loading: false, error: null }) })
      .catch(e => {
        const msg = e instanceof ProviderError ? e.message : e instanceof Error ? e.message : 'Something went wrong.'
        if (!cancelled) setState({ data: null, loading: false, error: msg })
      })
    return () => { cancelled = true }
  }, [perPage])
  return state
}

export function useUpcoming(perPage = 12): State<Anime[]> {
  const [state, setState] = useState<State<Anime[]>>({ data: null, loading: true, error: null })
  useEffect(() => {
    let cancelled = false
    setState({ data: null, loading: true, error: null })
    anilistMetadataProvider.getUpcoming(perPage)
      .then(d => { if (!cancelled) setState({ data: d, loading: false, error: null }) })
      .catch(e => {
        const msg = e instanceof ProviderError ? e.message : e instanceof Error ? e.message : 'Something went wrong.'
        if (!cancelled) setState({ data: null, loading: false, error: msg })
      })
    return () => { cancelled = true }
  }, [perPage])
  return state
}

export function useFinished(perPage = 12): State<Anime[]> {
  const [state, setState] = useState<State<Anime[]>>({ data: null, loading: true, error: null })
  useEffect(() => {
    let cancelled = false
    setState({ data: null, loading: true, error: null })
    anilistMetadataProvider.getFinished(perPage)
      .then(d => { if (!cancelled) setState({ data: d, loading: false, error: null }) })
      .catch(e => {
        const msg = e instanceof ProviderError ? e.message : e instanceof Error ? e.message : 'Something went wrong.'
        if (!cancelled) setState({ data: null, loading: false, error: msg })
      })
    return () => { cancelled = true }
  }, [perPage])
  return state
}

export type BrowseState = { data: Anime[] | null; loading: boolean; error: string | null; hasNextPage: boolean; page: number }
export function useBrowse(params: { sort?: string; status?: string; genre?: string; seasonYear?: number; season?: string; format?: string; perPage?: number; page?: number }): BrowseState & { loadMore: () => void } {
  const { sort, status, genre, seasonYear, season, format, perPage = 24 } = params
  const [state, setState] = useState<BrowseState>({ data: null, loading: true, error: null, hasNextPage: false, page: 1 })
  const [page, setPage] = useState(1)

  // Reset page when filters change
  useEffect(() => { setPage(1) }, [sort, status, genre, seasonYear, season, format, perPage])

  useEffect(() => {
    let cancelled = false
    setState(s => ({ ...s, loading: true, error: null }))
    const p = params.page ?? page
    anilistMetadataProvider.browse({ sort: sort as any, status: status as any, genre, seasonYear, season: season as any, format: format as any, perPage, page: p })
      .then(res => {
        if (cancelled) return
        setState(prev => ({
          data: p === 1 ? res.data : [...(prev.data ?? []), ...res.data],
          loading: false,
          error: null,
          hasNextPage: res.hasNextPage,
          page: res.pageInfo.currentPage,
        }))
      })
      .catch(e => {
        const msg = e instanceof ProviderError ? e.message : e instanceof Error ? e.message : 'Something went wrong.'
        if (!cancelled) setState(s => ({ ...s, loading: false, error: msg }))
      })
    return () => { cancelled = true }
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
    let cancelled = false
    const t = setTimeout(() => {
      setState({ data: null, loading: true, error: null })
      anilistMetadataProvider.search(query.trim(), perPage)
        .then(d => { if (!cancelled) setState({ data: d, loading: false, error: null }) })
        .catch(e => {
          const msg = e instanceof ProviderError ? e.message : e instanceof Error ? e.message : 'Search failed'
          if (!cancelled) setState({ data: null, loading: false, error: msg })
        })
    }, 300)
    return () => { clearTimeout(t); cancelled = true }
  }, [query, perPage])
  return state
}

export function useAnimeDetail(id: string | undefined): State<Anime> {
  const [state, setState] = useState<State<Anime>>({ data: null, loading: !!id, error: null })
  useEffect(() => {
    if (!id) { setState({ data: null, loading: false, error: null }); return }
    let cancelled = false
    setState({ data: null, loading: true, error: null })
    anilistMetadataProvider.getAnime(id)
      .then(d => { if (!cancelled) setState({ data: d, loading: false, error: null }) })
      .catch(e => {
        const msg = e instanceof ProviderError ? e.message : e instanceof Error ? e.message : 'Not found'
        if (!cancelled) setState({ data: null, loading: false, error: msg })
      })
    return () => { cancelled = true }
  }, [id])
  return state
}
