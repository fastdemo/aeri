import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AnimeCard } from '../components/cards/AnimeCard'
import { DetailModal } from '../components/detail/DetailModal'
import type { Anime } from '../types/anime'
import { useAnimeSearch } from '../hooks/useAnimeMetadata'

export function Search() {
  const [params] = useSearchParams()
  const q = params.get('q') ?? ''
  const [selected, setSelected] = useState<Anime | null>(null)
  useEffect(() => { setSelected(null) }, [params.toString()])

  // Query comes from the URL (navbar search); live results debounced in hook
  const liveQuery = q.trim()
  const { data: results, loading, error } = useAnimeSearch(liveQuery, 24)

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-12">
      <div className="mt-2">
        {!liveQuery ? (
          <p className="text-center text-sm text-[var(--text-faint)]">Type something to search. Try “Frieren” or “Sci-Fi”.</p>
        ) : loading ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="aspect-[16/9] animate-pulse rounded bg-[color-mix(in_srgb,var(--text)_5%,transparent)]" />
            ))}
          </div>
        ) : error ? (
          <div className="text-center">
            <p className="text-sm text-[var(--warn)]">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-3 rounded-full bg-[color-mix(in_srgb,var(--text)_10%,transparent)] px-4 py-1.5 text-xs font-medium text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--text)_15%,transparent)]"
            >
              Retry
            </button>
          </div>
        ) : !results || results.length === 0 ? (
          <p className="text-center text-sm text-[var(--text-muted)]">No results for “{liveQuery}”.</p>
        ) : (
          <>
            <h1 className="mb-1 text-center text-[17px] font-semibold tracking-tight text-[var(--text)]">
              {results.length} result{results.length === 1 ? '' : 's'} for “{liveQuery}”
            </h1>
            <p className="mb-4 text-center text-xs text-[var(--text-faint)]">from AniList.</p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {results.map((a) => (
                <div key={a.identity.internalId} className="min-w-0">
                  <AnimeCard anime={a} onSelect={setSelected} fullWidth />
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {selected && <DetailModal key={selected.identity.internalId} anime={selected} onClose={() => setSelected(null)} onSelectRelated={setSelected} />}
    </div>
  )
}
