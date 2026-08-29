import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AnimeCard } from '../components/cards/AnimeCard'
import { DetailModal } from '../components/detail/DetailModal'
import { mockAnime } from '../data/mockAnime'
import type { Anime } from '../types/anime'
import { useAniList } from '../contexts/AniListContext'
import { aniListProvider } from '../providers/anilist/provider'

export function Search() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const [selected, setSelected] = useState<Anime | null>(null)
  const [input, setInput] = useState(q)
  const { isAuthenticated } = useAniList()
  const [debouncedQ, setDebouncedQ] = useState(q)
  const [remoteResults, setRemoteResults] = useState<Anime[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  // debounce 300ms
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 300)
    return () => clearTimeout(t)
  }, [q])

  // AniList search when authenticated and debounced query present
  useEffect(() => {
    if (!isAuthenticated || !debouncedQ.trim()) {
      setRemoteResults(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setErr(null)
    aniListProvider
      .search(debouncedQ.trim())
      .then((res) => {
        if (!cancelled) setRemoteResults(res)
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : 'Search failed')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isAuthenticated, debouncedQ])

  const mockResults = useMemo(() => {
    if (!q.trim()) return []
    const lower = q.toLowerCase()
    return mockAnime.filter(
      (a) =>
        a.title.romaji.toLowerCase().includes(lower) ||
        (a.title.english?.toLowerCase().includes(lower) ?? false) ||
        (a.title.native?.includes(q) ?? false) ||
        a.genres.join(' ').toLowerCase().includes(lower),
    )
  }, [q])

  const results = isAuthenticated && debouncedQ.trim() ? (remoteResults ?? []) : mockResults

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (input.trim()) setParams({ q: input.trim() })
  }

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-12">
      <form onSubmit={onSubmit} className="mx-auto flex max-w-[720px] gap-2">
        <div className="relative flex-1">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Search titles, genres, studios"
            aria-label="Search"
            className="h-10 w-full rounded-full border border-white/10 bg-white/[0.08] pl-10 pr-4 text-sm text-white placeholder:text-white/50 focus:border-white/20 focus:outline-none"
          />
          <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
        </div>
        <button type="submit" className="rounded-full bg-white px-6 text-sm font-semibold text-black hover:bg-white/90">
          Search
        </button>
      </form>

      <div className="mt-8">
        {!q ? (
          <p className="text-center text-sm text-white/50">Type something to search. Try “Frieren” or “Sci-Fi”.</p>
        ) : loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="aspect-[16/9] animate-pulse rounded bg-white/5" />
            ))}
          </div>
        ) : err ? (
          <p className="text-center text-sm text-amber-200/80">{err}</p>
        ) : results.length === 0 ? (
          <p className="text-center text-sm text-white/60">No results for “{q}”.</p>
        ) : (
          <>
            <p className="mb-3 text-xs text-white/50">
              {results.length} results for “{q}”{isAuthenticated ? ' • AniList' : ''}
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {results.map((a) => (
                <AnimeCard key={a.identity.internalId} anime={a} onSelect={setSelected} />
              ))}
            </div>
          </>
        )}
      </div>

      {selected && <DetailModal anime={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
