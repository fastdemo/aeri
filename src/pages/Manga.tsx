import { useState, useEffect, useRef } from 'react'
import { AnimeCard } from '../components/cards/AnimeCard'
import { DetailModal } from '../components/detail/DetailModal'
import type { Anime } from '../types/anime'
import { useMangaBrowse } from '../hooks/useAnimeMetadata'
import { useLocation } from 'react-router-dom'
import { ANILIST_GENRES } from '../lib/genres'
import { useTracking } from '../contexts/TrackingContext'
import { SignInModal } from '../components/auth/SignInModal'

const categories = [
  { id: 'popular', label: 'Popular', sort: 'POPULARITY_DESC' as const },
  { id: 'trending', label: 'Trending', sort: 'TRENDING_DESC' as const },
  { id: 'publishing', label: 'Publishing', sort: 'POPULARITY_DESC' as const, status: 'RELEASING' as const },
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
const formats = ['All', 'MANGA', 'NOVEL', 'ONE_SHOT'] as const
const formatLabels: Record<string, string> = { All: 'All Formats', MANGA: 'Manga', NOVEL: 'Novel', ONE_SHOT: 'One-shot' }

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

const PAGE_SIZE = 30

export function Manga() {
  const [selected, setSelected] = useState<Anime | null>(null)
  const [signInOpen, setSignInOpen] = useState(false)
  const { isAuthenticated } = useTracking()
  const [category, setCategory] = useState<(typeof categories)[number]['id']>('popular')
  const location = useLocation()
  useEffect(() => { setSelected(null) }, [location.pathname, location.hash, location.search])
  const [genre, setGenre] = useState('All')
  const [yearKey, setYearKey] = useState('All Years')
  const [format, setFormat] = useState<(typeof formats)[number]>('All')

  const cat = categories.find(c => c.id === category)!

  const cols = useGridColumns()
  const yearPreset = yearPresets.find(y => y.label === yearKey) ?? yearPresets[0]

  const browse = useMangaBrowse({
    sort: cat.sort,
    status: (cat as any).status,
    genre: genre === 'All' ? undefined : genre,
    seasonYear: yearPreset.year,
    yearFrom: yearPreset.from,
    yearTo: yearPreset.to,
    format: format === 'All' ? undefined : format,
    perPage: PAGE_SIZE,
  })

  const sigKey = [category, cat.sort, (cat as any).status ?? '', genre, yearKey, format].join('|')
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
      <h1 className="text-[18px] font-semibold tracking-tight text-[var(--text)]">Manga</h1>
      <p className="text-xs text-[var(--text-faint)]">Discover manga by category and filters • AniList</p>

      {/* One strip: categories + filters share a single horizontal scroller,
          right-aligned. Wide screens show everything at once; narrow screens
          swipe through it as one unit — nothing clips, wraps, or overlaps. */}
      <div className="mt-4 flex min-w-0 justify-end py-0.5">
      <div className="flex min-w-0 max-w-full flex-nowrap items-center gap-2 overflow-x-auto no-scrollbar">
        {categories.map(c => (
          <button
            key={c.id}
            onClick={() => setCategory(c.id)}
            className={`shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${
              category === c.id ? 'border-[var(--border-strong)] bg-[var(--text)] text-[var(--on-text)]' : 'border-transparent bg-[color-mix(in_srgb,var(--text)_10%,transparent)] text-[var(--text-muted)] hover:bg-[color-mix(in_srgb,var(--text)_15%,transparent)] hover:text-[var(--text)]'
            }`}
          >
            {c.label}
          </button>
        ))}

        {[
          { value: genre, set: (v: string) => setGenre(v), label: 'Genre', options: [{ label: 'All Genres', value: 'All' }, ...genres.slice(1).map(g => ({ label: g, value: g }))] },
          { value: yearKey, set: (v: string) => setYearKey(v), label: 'Year', options: yearPresets.map(y => ({ label: y.label, value: y.label })) },
          { value: format, set: (v: string) => setFormat(v as any), label: 'Format', options: formats.map(f => ({ label: formatLabels[f] ?? f, value: f })) },
        ].map(f => (
          <div key={f.label} className="relative shrink-0">
              <select
                value={f.value}
                onChange={e => f.set(e.target.value)}
                aria-label={`Filter by ${f.label}`}
                className="max-w-[130px] appearance-none truncate rounded-full border border-[var(--border)] bg-[var(--bg-soft)] py-1.5 pl-3.5 pr-8 text-xs font-medium text-[var(--text)] focus:border-[var(--border-strong)] focus:outline-none"
              >
                {f.options.map(o => (
                  <option key={o.value} className="bg-[var(--surface)]" value={o.value}>{o.label}</option>
                ))}
              </select>
              <svg aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--text-faint)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </div>
          ))}

          {(genre !== 'All' || yearKey !== 'All Years' || format !== 'All') && (
            <button
              onClick={() => { setGenre('All'); setYearKey('All Years'); setFormat('All') }}
              className="shrink-0 rounded-full border border-transparent bg-[color-mix(in_srgb,var(--text)_10%,transparent)] px-3.5 py-1.5 text-xs font-medium text-[var(--text-muted)] hover:bg-[color-mix(in_srgb,var(--text)_15%,transparent)] hover:text-[var(--text)]"
            >
              Clear
            </button>
          )}
      </div>
      </div>

      {browse.loading && !browse.data ? (
        <div className="mt-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {Array.from({ length: cols * 5 }).map((_, i) => (
              <div key={i} className="aspect-[16/9] animate-pulse rounded bg-[color-mix(in_srgb,var(--text)_5%,transparent)]" />
            ))}
          </div>
          <p className="sr-only">Loading</p>
        </div>
      ) : browse.error && !browse.data ? (
        <div className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--text)]/[0.03] px-4 py-6 text-center">
          <p className="text-sm text-[var(--warn)]">{browse.error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-3 rounded-full bg-[color-mix(in_srgb,var(--text)_10%,transparent)] px-4 py-1.5 text-xs font-medium text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--text)_15%,transparent)]"
          >
            Retry
          </button>
        </div>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {visible.map(a => (
              <div key={a.identity.internalId} className="min-w-0">
                <AnimeCard anime={a} onSelect={(picked) => { if (!isAuthenticated) setSignInOpen(true); else setSelected(picked) }} fullWidth />
              </div>
            ))}
          </div>

          {browse.data && browse.data.length === 0 && (
            <p className="mt-12 text-center text-sm text-[var(--text-faint)]">No titles match your filters.</p>
          )}

          {browse.hasNextPage && browse.data && browse.data.length > 0 && (
            <div ref={sentinelRef} className="mt-6 flex min-h-[48px] items-center justify-center" aria-hidden={!browse.loading}>
              {browse.loading ? (
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--border-strong)] border-t-[var(--text)]" role="status" aria-label="Loading more" />
              ) : (
                <span className="text-xs text-[color-mix(in_srgb,var(--text)_30%,transparent)]">Scroll for more</span>
              )}
            </div>
          )}

          {browse.loading && browse.data && browse.data.length > 0 && browse.hasNextPage && (
            <p className="mt-2 text-center text-xs text-[var(--text-faint)]">Loading more…</p>
          )}
        </>
      )}

      {selected && <DetailModal key={selected.identity.internalId} anime={selected} onClose={() => setSelected(null)} />}
      {signInOpen && <SignInModal onClose={() => setSignInOpen(false)} />}
    </div>
  )
}
