import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AnimeCard } from '../components/cards/AnimeCard'
import { DetailModal } from '../components/detail/DetailModal'
import type { Anime } from '../types/anime'
import { useAnimeSearch } from '../hooks/useAnimeMetadata'

export function Search() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const [selected, setSelected] = useState<Anime | null>(null)
  const [input, setInput] = useState(q)
  const location = params // use params as location dependency
  useEffect(() => { setSelected(null) }, [location.toString()])

  // Live search while typing (debounced 300ms inside hook)
  const liveQuery = input.trim()
  const { data: results, loading, error } = useAnimeSearch(liveQuery, 12)

  // Keep input in sync with URL on navigation (back/forward) and update URL on submit
  useEffect(() => { setInput(q) }, [q])

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (input.trim()) setParams({ q: input.trim() })
    else setParams({})
  }

  // Update URL as user types (debounced via hook, but keep URL for deep link/share)
  useEffect(() => {
    const t = setTimeout(() => {
      const trimmed = input.trim()
      if (trimmed !== q) {
        if (trimmed) setParams({ q: trimmed }, { replace: true })
        else if (q) setParams({}, { replace: true })
      }
    }, 400)
    return () => clearTimeout(t)
  }, [input, q, setParams])

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
        {!liveQuery ? (
          <p className="text-center text-sm text-white/50">Type something to search. Try “Frieren” or “Sci-Fi”.</p>
        ) : loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="aspect-[16/9] animate-pulse rounded bg-white/5" />
            ))}
          </div>
        ) : error ? (
          <div className="text-center">
            <p className="text-sm text-amber-200/80">{error}</p>
            <button
              onClick={() => setInput(liveQuery)}
              className="mt-3 rounded-full bg-white/10 px-4 py-1.5 text-xs font-medium text-white hover:bg-white/15"
            >
              Retry
            </button>
          </div>
        ) : !results || results.length === 0 ? (
          <p className="text-center text-sm text-white/60">No results for “{liveQuery}”.</p>
        ) : (
          <>
            <p className="mb-3 text-xs text-white/50">
              {results.length} results for “{liveQuery}” • AniList
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
