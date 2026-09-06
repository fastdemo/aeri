import { useState, useEffect, useRef } from 'react'
import { AnimeCard } from '../components/cards/AnimeCard'
import { DetailModal } from '../components/detail/DetailModal'
import type { Anime } from '../types/anime'
import { useBrowse } from '../hooks/useAnimeMetadata'
import { useLocation } from 'react-router-dom'
import { ANILIST_GENRES } from '../lib/genres'
const categories = [
  { id: 'popular', label: 'Popular', sort: 'POPULARITY_DESC' as const },
  { id: 'trending', label: 'Trending', sort: 'TRENDING_DESC' as const },
  { id: 'airing', label: 'Airing', sort: 'POPULARITY_DESC' as const, status: 'RELEASING' as const },
  { id: 'upcoming', label: 'Upcoming', sort: 'POPULARITY_DESC' as const, status: 'NOT_YET_RELEASED' as const },
  { id: 'finished', label: 'Finished', sort: 'END_DATE_DESC' as const, status: 'FINISHED' as const },
] as const

const genres = ['All', ...ANILIST_GENRES]
type YearPreset = { label: string; year?: number; from?: number; to?: number }
const yearPresets: YearPreset[] = [
  { label: 'All Years' },
  ...Array.from({ length: 2026 - 2000 + 1 }, (_, i) => ({ label: String(2026 - i), year: 2026 - i })),
  { label: "'90s", from: 1990, to: 1999 },
  { label: "'80s & earlier", to: 1989 },
]
const seasons = ['All', 'WINTER', 'SPRING', 'SUMMER', 'FALL'] as const
const formats = ['All', 'TV', 'MOVIE', 'OVA', 'ONA', 'SPECIAL', 'MUSIC'] as const
const formatLabels: Record<string, string> = { All: 'All Formats', TV: 'TV', MOVIE: 'Movie', OVA: 'OVA', ONA: 'ONA', SPECIAL: 'Special', MUSIC: 'Music' }

// Column count mirrors the grid classes below (2 / sm:3 / md:4 / lg:5 / xl:6).
// Used ONLY for display slicing — fetching is a fixed 30 (theoretical max:
// 6 cols x 5 rows) so resizing never refetches, it just re-slices locally.
function useGridColumns(): number {
  const get = () => {
    if (typeof window === 'undefined') return 5
    const w = window.innerWidth
    if (w >= 1280) return 6
    if (w >= 1024) return 5
    if (w >= 768) return 4
    if (w >= 640) return 3
    return 2
  }
  const [cols, setCols] = useState(get)
  useEffect(() => {
    const onResize = () => setCols(get())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return cols
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

const PAGE_SIZE = 30 // theoretical max: 6 cols x 5 full rows

export function Browse() {
  const [selected, setSelected] = useState<Anime | null>(null)
  const [category, setCategory] = useState<(typeof categories)[number]['id']>('popular')
  const location = useLocation()
  useEffect(() => { setSelected(null) }, [location.pathname, location.hash, location.search])
  const [genre, setGenre] = useState('All')
  const [yearKey, setYearKey] = useState('All Years')
  const [season, setSeason] = useState<(typeof seasons)[number]>('All')
  const [format, setFormat] = useState<(typeof formats)[number]>('All')

  const cat = categories.find(c => c.id === category)!

  const cols = useGridColumns()
  const yearPreset = yearPresets.find(y => y.label === yearKey) ?? yearPresets[0]

  const browse = useBrowse({
    sort: cat.sort,
    status: (cat as any).status,
    genre: genre === 'All' ? undefined : genre,
    seasonYear: yearPreset.year,
    yearFrom: yearPreset.from,
    yearTo: yearPreset.to,
    season: season === 'All' ? undefined : season,
    format: format === 'All' ? undefined : format,
    perPage: PAGE_SIZE,
  })

  // Shuffle page 1 once per filter set so refreshes vary; Load-more appends
  // keep server order after the shuffled head. Display only complete rows.
  const sigKey = [cat.sort, (cat as any).status ?? '', genre, yearKey, season, format].join('|')
  const shuffledRef = useRef<{ sig: string; from: string; first: Anime[] }>({ sig: '', from: '', first: [] })
  const rawData = browse.data ?? []
  const headIds = rawData.slice(0, PAGE_SIZE).map(a => a.identity.internalId).join(',')
  if (rawData.length > 0 && (shuffledRef.current.sig !== sigKey || shuffledRef.current.from !== headIds)) {
    shuffledRef.current = { sig: sigKey, from: headIds, first: shuffle(rawData.slice(0, PAGE_SIZE)) }
  }
  const headLen = Math.min(PAGE_SIZE, rawData.length)
  const ordered = [...shuffledRef.current.first.slice(0, headLen), ...rawData.slice(PAGE_SIZE)]
  const visibleCount = ordered.length - (ordered.length % cols)
  const visible = ordered.slice(0, visibleCount)

  // Infinite scroll: when the sentinel nears the viewport, load the next page.
  // Re-subscribes on loading/page changes so the closure always sees fresh
  // state (a stale `loading=false` closure would double-increment the page
  // and skip results). loadMore itself also guards while fetching.
  const sentinelRef = useRef<HTMLDivElement>(null)
  const loadMoreRef = useRef(browse.loadMore)
  loadMoreRef.current = browse.loadMore
  const sentinelActive = browse.hasNextPage && !browse.loading
  useEffect(() => {
    const el = sentinelRef.current
    if (!el || !sentinelActive) return
    const io = new IntersectionObserver(
      (ents) => {
        if (ents.some((e) => e.isIntersecting)) loadMoreRef.current()
      },
      { rootMargin: '800px' },
    )
    io.observe(el)
    return () => io.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sentinelActive, browse.data?.length, browse.page])

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-12">
      <h1 className="text-[18px] font-semibold tracking-tight text-white">Anime</h1>
      <p className="text-xs text-white/50">Discover anime by category and filters • AniList</p>

      {/* Categories (left) + filters (right) on one row */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto no-scrollbar">
          {categories.map(c => (
            <button
              key={c.id}
              onClick={() => setCategory(c.id)}
              className={`whitespace-nowrap rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${
                category === c.id ? 'border-white bg-white text-black' : 'border-transparent bg-white/10 text-white/70 hover:bg-white/15 hover:text-white'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">
          {[
            { value: genre, set: (v: string) => setGenre(v), label: 'Genre', options: [{ label: 'All Genres', value: 'All' }, ...genres.slice(1).map(g => ({ label: g, value: g }))] },
            { value: yearKey, set: (v: string) => setYearKey(v), label: 'Year', options: yearPresets.map(y => ({ label: y.label, value: y.label })) },
            { value: season, set: (v: string) => setSeason(v as any), label: 'Season', options: [{ label: 'All Seasons', value: 'All' }, ...seasons.slice(1).map(s => ({ label: s.charAt(0) + s.slice(1).toLowerCase(), value: s }))] },
            { value: format, set: (v: string) => setFormat(v as any), label: 'Format', options: formats.map(f => ({ label: formatLabels[f] ?? f, value: f })) },
          ].map(f => (
            <div key={f.label} className="relative">
              <select
                value={f.value}
                onChange={e => f.set(e.target.value)}
                aria-label={`Filter by ${f.label}`}
                className="appearance-none rounded-full border border-white/10 bg-white/[0.06] py-1.5 pl-3.5 pr-8 text-xs font-medium text-white focus:border-white/20 focus:outline-none"
              >
                {f.options.map(o => (
                  <option key={o.value} className="bg-[#141416]" value={o.value}>{o.label}</option>
                ))}
              </select>
              <svg aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-white/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </div>
          ))}

          {(genre !== 'All' || yearKey !== 'All Years' || season !== 'All' || format !== 'All') && (
            <button
              onClick={() => { setGenre('All'); setYearKey('All Years'); setSeason('All'); setFormat('All') }}
              className="rounded-full border border-transparent bg-white/10 px-3.5 py-1.5 text-xs font-medium text-white/70 hover:bg-white/15 hover:text-white"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Results */}
      {browse.loading && !browse.data ? (
        <div className="mt-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {Array.from({ length: cols * 5 }).map((_, i) => (
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
            {visible.map(a => (
              <div key={a.identity.internalId} className="min-w-0">
                <AnimeCard anime={a} onSelect={setSelected} fullWidth />
              </div>
            ))}
          </div>

          {browse.data && browse.data.length === 0 && (
            <p className="mt-12 text-center text-sm text-white/50">No titles match your filters.</p>
          )}

          {browse.hasNextPage && browse.data && browse.data.length > 0 && (
            <div ref={sentinelRef} className="mt-6 flex min-h-[48px] items-center justify-center" aria-hidden={!browse.loading}>
              {browse.loading ? (
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-white" role="status" aria-label="Loading more" />
              ) : (
                <span className="text-xs text-white/30">Scroll for more</span>
              )}
            </div>
          )}

          {browse.loading && browse.data && browse.data.length > 0 && browse.hasNextPage && (
            <p className="mt-2 text-center text-xs text-white/40">Loading more…</p>
          )}
        </>
      )}

      {selected && <DetailModal anime={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
