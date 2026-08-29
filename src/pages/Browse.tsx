import { useState, useEffect } from 'react'
import { AnimeCard } from '../components/cards/AnimeCard'
import { DetailModal } from '../components/detail/DetailModal'
import type { Anime } from '../types/anime'
import { useBrowse } from '../hooks/useAnimeMetadata'
import { useLocation } from 'react-router-dom'

const categories = [
  { id: 'popular', label: 'Popular', sort: 'POPULARITY_DESC' as const },
  { id: 'trending', label: 'Trending', sort: 'TRENDING_DESC' as const },
  { id: 'airing', label: 'Airing', sort: 'POPULARITY_DESC' as const, status: 'RELEASING' as const },
  { id: 'upcoming', label: 'Upcoming', sort: 'POPULARITY_DESC' as const, status: 'NOT_YET_RELEASED' as const },
  { id: 'finished', label: 'Finished', sort: 'END_DATE_DESC' as const, status: 'FINISHED' as const },
] as const

const genres = ['All', 'Action', 'Adventure', 'Drama', 'Fantasy', 'Sci-Fi', 'Comedy', 'Slice of Life', 'Romance', 'Mystery']
const years = ['All', '2025', '2024', '2023', '2022', '2021', '2020']
const seasons = ['All', 'WINTER', 'SPRING', 'SUMMER', 'FALL'] as const
const formats = ['All', 'TV', 'MOVIE', 'OVA', 'SPECIAL'] as const

export function Browse() {
  const [selected, setSelected] = useState<Anime | null>(null)
  const [category, setCategory] = useState<(typeof categories)[number]['id']>('popular')
  const location = useLocation()
  useEffect(() => { setSelected(null) }, [location.pathname, location.hash, location.search])
  const [genre, setGenre] = useState('All')
  const [year, setYear] = useState('All')
  const [season, setSeason] = useState<(typeof seasons)[number]>('All')
  const [format, setFormat] = useState<(typeof formats)[number]>('All')

  const cat = categories.find(c => c.id === category)!

  const browse = useBrowse({
    sort: cat.sort,
    status: (cat as any).status,
    genre: genre === 'All' ? undefined : genre,
    seasonYear: year === 'All' ? undefined : Number(year),
    season: season === 'All' ? undefined : season,
    format: format === 'All' ? undefined : format,
    perPage: 24,
  })

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-12">
      <h1 className="text-[18px] font-semibold tracking-tight text-white">Browse</h1>
      <p className="text-xs text-white/50">Discover anime by category and filters • AniList</p>

      {/* Category tabs */}
      <div className="mt-4 flex gap-2 overflow-x-auto no-scrollbar">
        {categories.map(c => (
          <button
            key={c.id}
            onClick={() => setCategory(c.id)}
            className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
              category === c.id ? 'bg-white text-black' : 'bg-white/10 text-white/70 hover:bg-white/15 hover:text-white'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Filters — compact, Netflix-like minimal */}
      <div className="mt-3 flex flex-wrap gap-2">
        <select
          value={genre}
          onChange={e => setGenre(e.target.value)}
          aria-label="Filter by genre"
          className="min-h-[36px] rounded-full border border-white/10 bg-white/[0.06] px-3 py-2 text-xs text-white focus:border-white/20 focus:outline-none sm:min-h-[40px]"
        >
          <option className="bg-[#141416]" value="All">All Genres</option>
          {genres.slice(1).map(g => (
            <option key={g} className="bg-[#141416]" value={g}>{g}</option>
          ))}
        </select>

        <select
          value={year}
          onChange={e => setYear(e.target.value)}
          aria-label="Filter by year"
          className="min-h-[36px] rounded-full border border-white/10 bg-white/[0.06] px-3 py-2 text-xs text-white focus:border-white/20 focus:outline-none sm:min-h-[40px]"
        >
          {years.map(y => (
            <option key={y} className="bg-[#141416]" value={y}>{y === 'All' ? 'All Years' : y}</option>
          ))}
        </select>

        <select
          value={season}
          onChange={e => setSeason(e.target.value as any)}
          aria-label="Filter by season"
          className="min-h-[36px] rounded-full border border-white/10 bg-white/[0.06] px-3 py-2 text-xs text-white focus:border-white/20 focus:outline-none sm:min-h-[40px]"
        >
          <option className="bg-[#141416]" value="All">All Seasons</option>
          <option className="bg-[#141416]" value="WINTER">Winter</option>
          <option className="bg-[#141416]" value="SPRING">Spring</option>
          <option className="bg-[#141416]" value="SUMMER">Summer</option>
          <option className="bg-[#141416]" value="FALL">Fall</option>
        </select>

        <select
          value={format}
          onChange={e => setFormat(e.target.value as any)}
          aria-label="Filter by format"
          className="min-h-[36px] rounded-full border border-white/10 bg-white/[0.06] px-3 py-2 text-xs text-white focus:border-white/20 focus:outline-none sm:min-h-[40px]"
        >
          <option className="bg-[#141416]" value="All">All Formats</option>
          <option className="bg-[#141416]" value="TV">TV</option>
          <option className="bg-[#141416]" value="MOVIE">Movie</option>
          <option className="bg-[#141416]" value="OVA">OVA</option>
          <option className="bg-[#141416]" value="SPECIAL">Special</option>
        </select>

        {(genre !== 'All' || year !== 'All' || season !== 'All' || format !== 'All') && (
          <button
            onClick={() => { setGenre('All'); setYear('All'); setSeason('All'); setFormat('All') }}
            className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white/70 hover:bg-white/15 hover:text-white"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Results */}
      {browse.loading && !browse.data ? (
        <div className="mt-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="aspect-[16/9] animate-pulse rounded bg-white/5" />
            ))}
          </div>
          <p className="sr-only">Loading</p>
        </div>
      ) : browse.error && !browse.data ? (
        <div className="mt-6 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-6 text-center">
          <p className="text-sm text-amber-200/80">{browse.error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-3 rounded-full bg-white/10 px-4 py-1.5 text-xs font-medium text-white hover:bg-white/15"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {(browse.data ?? []).map(a => (
              <div key={a.identity.internalId} className="min-w-0">
                <AnimeCard anime={a} onSelect={setSelected} fullWidth />
              </div>
            ))}
          </div>

          {browse.data && browse.data.length === 0 && (
            <p className="mt-12 text-center text-sm text-white/50">No titles match your filters.</p>
          )}

          {browse.hasNextPage && browse.data && browse.data.length > 0 && (
            <div className="mt-6 flex justify-center">
              <button
                onClick={browse.loadMore}
                disabled={browse.loading}
                className="rounded-full bg-white px-6 py-2 text-sm font-semibold text-black hover:bg-white/90 disabled:opacity-50"
              >
                {browse.loading ? 'Loading…' : 'Load more'}
              </button>
            </div>
          )}

          {browse.loading && browse.data && browse.data.length > 0 && (
            <p className="mt-4 text-center text-xs text-white/40">Loading more…</p>
          )}
        </>
      )}

      {selected && <DetailModal anime={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
