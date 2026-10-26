import { useState } from 'react'
import { AnimeCard } from '../components/cards/AnimeCard'
import { FilterSelect } from '../components/ui/FilterSelect'
import type { Anime, AnimeListEntry, AnimeStatus } from '../types/anime'
import { Navigate } from 'react-router-dom'
import { useTracking } from '../contexts/TrackingContext'
import { RowSkeleton } from '../components/ui/Skeleton'
import { useAniList } from '../contexts/AniListContext'
import { useMAL } from '../contexts/MALContext'
import { useDetailOpen } from '../hooks/useDetailOpen'
import { ANILIST_GENRES } from '../lib/genres'
import { pillSolid, pillSoft } from '../components/ui/buttonStyles'

// STATUS = the STOLEN pill row (owner 2026-10-19: "remove all statuses. on
// the anime page, steal the popular/trending/airing and replace that with
// the statuses like all/plan to watch/watching..."). The pill row component
// is Browse's category lane verbatim — same geometry/copy/active fill —
// with statuses as labels, in the owner's listed order. NO Status dropdown
// (statuses appear nowhere as a select; the four browse dropdowns remain).
const statusTabs: { id: AnimeStatus | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'planned', label: 'Plan to Watch' },
  { id: 'watching', label: 'Watching' },
  { id: 'completed', label: 'Completed' },
  { id: 'on_hold', label: 'On Hold' },
  { id: 'dropped', label: 'Dropped' },
]

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

export function MyList() {
  const [status, setStatus] = useState<AnimeStatus | 'all'>('all')
  const [genre, setGenre] = useState('All')
  const [yearKey, setYearKey] = useState('All Years')
  const [season, setSeason] = useState('All')
  const [format, setFormat] = useState('All')
  const { isAuthenticated, trackingProvider, combinedList, loading, error, authExpired } = useTracking()
  const ani = useAniList()
  const mal = useMAL()
  // Card taps push detail URLs — the floating card is an overlay route on
  // top of this page, not local component state.
  const openDetail = useDetailOpen()
  // Same header language as the Anime/Manga browse tabs: title + 1-line
  // "Discover … • <tracker>" description (text-xs faint). The tracker is
  // the active provider (AniList/MyAnimeList) — metadata is AniList either
  // way, so the suffix names the active tracker exactly like Home rows do.
  const trackerName = trackingProvider === 'anilist' ? 'AniList' : trackingProvider === 'mal' ? 'MyAnimeList' : 'AniList'

  // Production: real list only when authenticated; unauth shows empty with CTA (no fake anime).
  // Most recently active first (entries without activity timestamps keep provider order at the end).
  // MY LIST RULE: anime only (manga has its own surfaces — reader, profile).
  const isAnimeEntry = (e: AnimeListEntry) => {
    const mt = e.anime.identity.mediaType
    if (mt) return mt === 'ANIME'
    return !['MANGA', 'NOVEL', 'ONE_SHOT'].includes((e.anime.format ?? '').toUpperCase())
  }
  const animeOnly = isAuthenticated && combinedList ? combinedList.filter(isAnimeEntry) : []
  const byRecent = (a: AnimeListEntry, b: AnimeListEntry) => (b.updatedAt ?? -1) - (a.updatedAt ?? -1)
  // FILTERS — the browse-dropdown set, client-side over the loaded list:
  // status (tracker canon), genre/year/season/format read the entry record
  // itself. Entries missing a field (thin MAL list copies) match ALLs only —
  // the honest degenerate form, same as the season rule on Browse.
  const yearPreset = yearPresets.find(y => y.label === yearKey) ?? yearPresets[0]
  const filtered: Anime[] = (() => {
    const entries = [...animeOnly]
      .filter(e => (status === 'all' ? true : e.status === status))
      .filter(e => (genre === 'All' ? true : e.anime.genres.includes(genre)))
      .filter(e => {
        if (yearPreset.year != null) return e.anime.year === yearPreset.year
        if (yearPreset.from != null || yearPreset.to != null) {
          const y = e.anime.year
          if (y == null) return false
          return (yearPreset.from ?? -Infinity) <= y && y <= (yearPreset.to ?? Infinity)
        }
        return true
      })
      .filter(e => (season === 'All' ? true : e.anime.season?.toUpperCase() === season))
      .filter(e => (format === 'All' ? true : e.anime.format?.toUpperCase() === format))
      .sort(byRecent)
    return entries.map(e => e.anime)
  })()
  if (!isAuthenticated) {
    return <Navigate to="/" replace />
  }

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-12">
      <h1 className="text-[18px] font-semibold tracking-tight text-[var(--text)]">My List</h1>
      <p className="text-xs text-[var(--text-faint)]">Your tracked anime in one place • {trackerName}</p>

      {isAuthenticated && loading && (
        <div className="mt-6">
          <RowSkeleton title="Loading your list" />
        </div>
      )}
      {isAuthenticated && !loading && (error || authExpired) && (
        <div className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--text)]/[0.03] px-4 py-6 text-center">
          <p className="text-sm text-[var(--text)]">{error || 'Session expired'}</p>
          {authExpired ? (
            <p className="mt-1 text-xs text-[var(--text-faint)]">A session expired. Reconnect above.</p>
          ) : (
            <div className="mt-3 flex justify-center gap-2">
              <button onClick={() => ani.refresh().catch(()=>{})} className="rounded-full bg-[color-mix(in_srgb,var(--text)_10%,transparent)] px-4 py-1.5 text-xs font-medium text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--text)_15%,transparent)]">
                Retry AniList
              </button>
              <button onClick={() => mal.refresh().catch(()=>{})} className="rounded-full bg-[color-mix(in_srgb,var(--text)_10%,transparent)] px-4 py-1.5 text-xs font-medium text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--text)_15%,transparent)]">
                Retry MAL
              </button>
            </div>
          )}
        </div>
      )}

      {/* Filter row = THE ANIME LANE (owner 2026-10-19, "remove all
          statuses. on the anime page, steal the popular/trending/airing
          and replace that with the statuses like all/plan to watch/
          watching"): Browse's category-pills lane verbatim — same pill
          geometry/copy/active fill — with STATUSES as the labels (owner's
          order). Wide: pills LEFT, the four browse dropdowns RIGHT
          (justify-between, as Browse). Narrow: one joined swipeable
          scroller, nothing clips. Statuses exist ONLY as pills — the
          status dropdown is REMOVED (by owner request). */}
      <div className="mt-4 hidden min-w-0 flex-nowrap items-center justify-between gap-4 py-0.5 lg:flex">
        <div className="flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto no-scrollbar">
          {statusTabs.map(t => (
            <button
              key={t.id}
              onClick={() => setStatus(t.id)}
              className={`shrink-0 ${status === t.id ? pillSolid : pillSoft}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex shrink-0 flex-nowrap items-center gap-2">
          {[
            { value: genre, set: (v: string) => setGenre(v), label: 'Genre', options: [{ label: 'All Genres', value: 'All' }, ...genres.slice(1).map(g => ({ label: g, value: g }))] },
            { value: yearKey, set: (v: string) => setYearKey(v), label: 'Year', options: yearPresets.map(y => ({ label: y.label, value: y.label })) },
            { value: season, set: (v: string) => setSeason(v as any), label: 'Season', options: [{ label: 'All Seasons', value: 'All' }, ...seasons.slice(1).map(s => ({ label: s.charAt(0) + s.slice(1).toLowerCase(), value: s }))] },
            { value: format, set: (v: string) => setFormat(v as any), label: 'Format', options: formats.map(f => ({ label: formatLabels[f] ?? f, value: f })) },
          ].map(f => (
            <FilterSelect
              key={f.label}
              value={f.value}
              onChange={f.set}
              ariaLabel={`Filter by ${f.label}`}
              options={f.options}
            />
          ))}

          {(genre !== 'All' || yearKey !== 'All Years' || season !== 'All' || format !== 'All') && (
            <button
              onClick={() => { setGenre('All'); setYearKey('All Years'); setSeason('All'); setFormat('All') }}
              className={`${pillSoft} shrink-0`}
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="mt-4 flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto no-scrollbar py-0.5 lg:hidden">
        {statusTabs.map(t => (
          <button
            key={t.id}
            onClick={() => setStatus(t.id)}
            className={`shrink-0 ${status === t.id ? pillSolid : pillSoft}`}
          >
            {t.label}
          </button>
        ))}

        {[
          { value: genre, set: (v: string) => setGenre(v), label: 'Genre', options: [{ label: 'All Genres', value: 'All' }, ...genres.slice(1).map(g => ({ label: g, value: g }))] },
          { value: yearKey, set: (v: string) => setYearKey(v), label: 'Year', options: yearPresets.map(y => ({ label: y.label, value: y.label })) },
          { value: season, set: (v: string) => setSeason(v as any), label: 'Season', options: [{ label: 'All Seasons', value: 'All' }, ...seasons.slice(1).map(s => ({ label: s.charAt(0) + s.slice(1).toLowerCase(), value: s }))] },
          { value: format, set: (v: string) => setFormat(v as any), label: 'Format', options: formats.map(f => ({ label: formatLabels[f] ?? f, value: f })) },
        ].map(f => (
          <FilterSelect
            key={`m-${f.label}`}
            value={f.value}
            onChange={f.set}
            ariaLabel={`Filter by ${f.label}`}
            options={f.options}
          />
        ))}

        {(genre !== 'All' || yearKey !== 'All Years' || season !== 'All' || format !== 'All') && (
          <button
            onClick={() => { setGenre('All'); setYearKey('All Years'); setSeason('All'); setFormat('All') }}
            className={`${pillSoft} shrink-0`}
          >
            Clear
          </button>
        )}
      </div>

      {!isAuthenticated ? (
        <div className="mt-8 rounded-lg border border-[var(--border)] bg-[var(--text)]/[0.02] px-6 py-10 text-center">
          <p className="text-sm font-medium text-[var(--text)]">Your list is empty</p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-[var(--text-faint)]">
            Sign in with AniList above to see your anime list, track progress, and keep Continue Watching in sync. Your data stays in your browser and AniList.
          </p>
        </div>
      ) : !loading ? (
        <>
          {/* THE ANIME-PAGE GRID, verbatim: same columns/gaps/classes as
              Browse and every card the DEFAULT variant (owner 2026-10-19:
              "steal like how anime cards are displayed like in the anime
              page, not like continue watching. same size and stuff") —
              no continue-style caption/progress strip here; progress
              lives in the preview card. Anime List is anime-kind only. */}
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {filtered.map((a) => (
              <div key={a.identity.internalId} className="min-w-0">
                <AnimeCard anime={a} onSelect={openDetail} fullWidth />
              </div>
            ))}
          </div>
          {filtered.length === 0 && !loading && !error && (
            <div className="mt-8 rounded-lg border border-[var(--border)] bg-[var(--text)]/[0.02] px-6 py-10 text-center">
              <p className="text-sm text-[var(--text-faint)]">Nothing here yet.</p>
              <p className="mt-1 text-xs text-[var(--text-faint)]">
                {status !== 'all' || genre !== 'All' || yearKey !== 'All Years' || season !== 'All' || format !== 'All'
                  ? 'No titles match these filters — Clear returns everything.'
                  : 'Add titles from Anime or Search, or update status in the detail view.'}
              </p>
            </div>
          )}
        </>
      ) : null}

    </div>
  )
}
