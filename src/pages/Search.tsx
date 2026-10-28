import { useSearchParams } from 'react-router-dom'
import { AnimeCard } from '../components/cards/AnimeCard'
import { CardSkeleton } from '../components/ui/Skeleton'
import type { Anime } from '../types/anime'
import { useAnimeSearch } from '../hooks/useAnimeMetadata'
import { useDetailOpen } from '../hooks/useDetailOpen'

export function Search() {
  const [params] = useSearchParams()
  const q = params.get('q') ?? ''
  // Card taps push detail URLs — the floating card is an overlay route on
  // top of the results page.
  const openDetail = useDetailOpen()

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
              <CardSkeleton key={i} fullWidth flat />
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
            {/* Header/description mirror the Anime tab's header block:
                left-aligned 18px title + 12px faint subline, same classes
                as Browse's h1/p. */}
            <h1 className="text-[18px] font-semibold tracking-tight text-[var(--text)]">
              {results.length} result{results.length === 1 ? '' : 's'} for “{liveQuery}”
            </h1>
            <p className="text-xs text-[var(--text-faint)]">Fetched from AniList.</p>
            <div className="mt-4">
            {(() => {
              const isMangaFmt = (f?: string | null) => ['MANGA', 'NOVEL', 'ONE_SHOT'].includes((f ?? '').toUpperCase())
              const isOvaFmt = (f?: string | null) => ['OVA', 'ONA', 'SPECIAL', 'MUSIC'].includes((f ?? '').toUpperCase())
              const animeRes = results.filter(a => !isMangaFmt(a.format) && !isOvaFmt(a.format))
              const mangaRes = results.filter(a => isMangaFmt(a.format))
              const ovaRes = results.filter(a => isOvaFmt(a.format))
              const renderGrid = (list: Anime[]) => (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                  {list.map((a) => (
                    <div key={a.identity.internalId} className="min-w-0">
                      <AnimeCard anime={a} onSelect={openDetail} mediaKind={isMangaFmt(a.format) ? 'manga' : 'anime'} fullWidth />
                    </div>
                  ))}
                </div>
              )
              return (
                <>
                  {animeRes.length > 0 && (
                    <section aria-label="Anime results" className="mb-6">
                      <h2 className="mb-2 text-[13px] font-semibold text-[var(--text)]">Anime</h2>
                      {renderGrid(animeRes)}
                    </section>
                  )}
                  {mangaRes.length > 0 && (
                    <section aria-label="Manga results" className="mb-6">
                      <h2 className="mb-2 text-[13px] font-semibold text-[var(--text)]">Manga</h2>
                      {renderGrid(mangaRes)}
                    </section>
                  )}
                  {ovaRes.length > 0 && (
                    <section aria-label="OVA results" className="mb-6">
                      <h2 className="mb-2 text-[13px] font-semibold text-[var(--text)]">OVAs</h2>
                      {renderGrid(ovaRes)}
                    </section>
                  )}
                </>
              )
            })()}
            </div>
          </>
        )}
      </div>

    </div>
  )
}
