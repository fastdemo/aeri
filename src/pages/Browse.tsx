import { useMemo, useState } from 'react'
import { AnimeCard } from '../components/cards/AnimeCard'
import { DetailModal } from '../components/detail/DetailModal'
import type { Anime } from '../types/anime'
import { usePopular } from '../hooks/useAnimeMetadata'
import { RowSkeleton } from '../components/ui/Skeleton'

const genres = ['All', 'Action', 'Adventure', 'Drama', 'Fantasy', 'Sci-Fi', 'Comedy', 'Slice of Life']

export function Browse() {
  const [selected, setSelected] = useState<Anime | null>(null)
  const [genre, setGenre] = useState('All')
  const popular = usePopular(24)

  const filtered = useMemo(() => {
    if (!popular.data) return []
    if (genre === 'All') return popular.data
    return popular.data.filter((a) => a.genres.includes(genre))
  }, [popular.data, genre])

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-12">
      <div className="flex flex-wrap items-center gap-2 py-2">
        {genres.map((g) => (
          <button
            key={g}
            onClick={() => setGenre(g)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
              genre === g ? 'bg-white text-black' : 'bg-white/10 text-white/80 hover:bg-white/15 hover:text-white'
            }`}
          >
            {g}
          </button>
        ))}
      </div>

      {popular.loading ? (
        <div className="mt-6">
          <RowSkeleton title="Browse" />
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="aspect-[16/9] animate-pulse rounded bg-white/5" />
            ))}
          </div>
        </div>
      ) : popular.error ? (
        <div className="mt-6 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-6 text-center text-xs text-amber-200/70">
          {popular.error}
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {filtered.map((a) => (
            <div key={a.identity.internalId} className="flex justify-center">
              <AnimeCard anime={a} onSelect={setSelected} />
            </div>
          ))}
        </div>
      )}

      {filtered.length === 0 && !popular.loading && !popular.error && (
        <p className="mt-6 text-center text-sm text-white/50">No titles for “{genre}”.</p>
      )}

      {selected && <DetailModal anime={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
