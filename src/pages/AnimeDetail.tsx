import { useMemo } from 'react'
import { useParams, Link, Navigate } from 'react-router-dom'
import { EpisodeList } from '../components/episodes/EpisodeList'
import { useTracking } from '../contexts/TrackingContext'
import { displayRating, formatRating } from '../lib/rating'
import { useAnimeDetail } from '../hooks/useAnimeMetadata'
import { useRelatedEntries } from '../hooks/useRelatedEntries'
import { RelatedEntries } from '../components/related/RelatedEntries'
import { getTitleHierarchy } from '../lib/titles'
import { sanitizeAnimeForDisplay } from '../lib/episodes'
import { formatLabel, statusLabel } from '../lib/mediaLabels'

export function AnimeDetail() {
  const { id } = useParams<{ id: string }>()
  const { combinedList, trackingProvider, isAuthenticated } = useTracking()
  const animeList = combinedList

  // Signed-out users go home: media pages are members-only (Play links here
  // also bounce home, so a signed-out deep link never strands on a dead page).
  // Rendered AFTER all hooks (Rules of Hooks) via early return below.

  // Try to resolve from the active tracker's list first (real, with progress)
  const fromList = id
    ? animeList?.find(
        (e) =>
          e.anime.identity.internalId === id ||
          e.anime.identity.anilistId?.toString() === id ||
          e.anime.identity.malId?.toString() === id ||
          `anilist-${e.anime.identity.anilistId}` === id ||
          `mal-${e.anime.identity.malId}` === id
      )?.anime
    : null

  const realId = (() => {
    if (!id) return undefined
    if (id.startsWith('anilist-') || /^\d+$/.test(id)) return id
    if (fromList?.identity.anilistId) return `anilist-${fromList.identity.anilistId}`
    // Legacy slug like 'frieren' no longer resolves to mock — show not found instead of fake content
    return id
  })()

  const { data: remote, loading, error } = useAnimeDetail(realId)

  // Prefer real remote data when available, else fromList (no mock fallback in production)
  const anime = remote ?? fromList

  // Each route id IS one AniList entry — no group resolution, no season
  // selection. The displayed anime is exactly the routed entry.
  const displayAnime = useMemo(() => {
    if (!anime) return null as any
    // sanitize standalone anime (sort, filter trailers, fix reverse, discard out-of-range)
    return sanitizeAnimeForDisplay(anime)
  }, [anime])
  const titles = useMemo(() => {
    if (!displayAnime) return { primary: '' } as any
    return getTitleHierarchy(displayAnime)
  }, [displayAnime])
  const backdrop = displayAnime ? (displayAnime.backdropImage || displayAnime.coverImage || '') : ''
  const displayKey = displayAnime ? (displayAnime.identity.anilistId ? `anilist:${displayAnime.identity.anilistId}` : displayAnime.identity.internalId) : 'none'
  const isMovie = displayAnime ? displayAnime.format?.toUpperCase() === 'MOVIE' : false
  const isMangaKind = displayAnime ? ['MANGA', 'NOVEL', 'ONE_SHOT'].includes(displayAnime.format?.toUpperCase() ?? '') : false

  if (!isAuthenticated) {
    return <Navigate to="/" replace />
  }
  if (loading && !anime) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-16">
        <div className="h-[420px] animate-pulse rounded-xl bg-[color-mix(in_srgb,var(--text)_5%,transparent)]" />
        <div className="mt-6 h-20 animate-pulse rounded bg-[color-mix(in_srgb,var(--text)_5%,transparent)]" />
      </div>
    )
  }
  if (error && !anime) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-16 text-center">
        <p className="text-[var(--warn)]">{error}</p>
        <Link to="/" className="mt-4 inline-block text-sm text-[var(--text-muted)] underline">Back</Link>
      </div>
    )
  }
  if (!anime || !displayAnime) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-16 text-center">
        <p className="text-[var(--text)]">Anime not found.</p>
        <Link to="/" className="mt-4 inline-block text-sm text-[var(--text-muted)] underline">Back</Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[1200px] px-4 pb-12 sm:px-6 lg:px-12">
      <div className="relative overflow-hidden rounded-xl bg-[var(--surface)]">
        <div className="relative h-[420px] w-full overflow-hidden bg-[var(--surface-elevated)]">
          <img
            src={backdrop}
            alt=""
            className="h-full w-full object-cover"
            loading="eager"
            decoding="async"
            onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
          />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, color-mix(in srgb, var(--bg) 55%, transparent) 0%, transparent 24%, transparent 55%, color-mix(in srgb, var(--bg) 45%, transparent) 78%, var(--bg) 100%)' }} />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, color-mix(in srgb, var(--bg) 85%, transparent) 0%, transparent 62%)' }} />
          <div className="absolute bottom-0 left-0 p-6 sm:p-8">
            <h1 className="text-2xl font-semibold text-[var(--text)]">{titles.primary}</h1>
            {titles.native && (
              <p className="text-xs text-[var(--text-muted)]">{titles.native}</p>
            )}
            {titles.romaji && (
              <p className="text-xs text-[var(--text-faint)]">{titles.romaji}</p>
            )}
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              {[displayAnime.year, formatLabel(displayAnime.format), !isMovie && !isMangaKind && displayAnime.episodes ? `${displayAnime.episodes} episodes` : null, isMangaKind && displayAnime.chapters ? `${displayAnime.chapters} chapters` : null, isMangaKind && displayAnime.volumes ? `${displayAnime.volumes} volumes` : null].filter(Boolean).join(' • ')}
              {(() => { const r = formatRating(displayRating(displayAnime, trackingProvider)); return r ? ` • ${r}` : '' })()}
            </p>
            <div className="mt-3 flex gap-2">
              {isMangaKind ? (
                (displayAnime.chapters || displayAnime.volumes) ? (
                  <span className="rounded-full bg-[color-mix(in_srgb,var(--text)_10%,transparent)] px-5 py-2 text-sm font-medium text-[var(--text-muted)]">
                    {[displayAnime.chapters ? `${displayAnime.chapters} chapters` : null, displayAnime.volumes ? `${displayAnime.volumes} volumes` : null].filter(Boolean).join(' • ')}
                  </span>
                ) : null
              ) : (
                <Link to={`/watch/${displayAnime.identity.internalId}/1`} className="rounded-full bg-[var(--text)] px-5 py-2 text-sm font-semibold text-[var(--on-text)]">Play</Link>
              )}
              <Link to="/" className="rounded-full bg-[color-mix(in_srgb,var(--text)_15%,transparent)] px-5 py-2 text-sm font-medium text-[var(--text)] backdrop-blur">Back to Home</Link>
            </div>
          </div>
        </div>
        <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[1.6fr_0.8fr]">
          <div>
            <p className="text-sm leading-6 text-[var(--text-muted)]">{displayAnime.description || 'No description available.'}</p>

            {!isMovie && !isMangaKind && (
              <div className="mt-6">
                <EpisodeList key={displayKey} anime={displayAnime} />
              </div>
            )}
          </div>
          <div className="space-y-3 text-xs leading-5">
            <div><span className="text-[var(--text-faint)]">Genres: </span><span className="text-[var(--text)]">{displayAnime.genres.join(', ') || '—'}</span></div>
            <div><span className="text-[var(--text-faint)]">Studios: </span><span className="text-[var(--text)]">{displayAnime.studios?.join(', ') || '—'}</span></div>
            <div><span className="text-[var(--text-faint)]">Status: </span><span className="text-[var(--text)]">{statusLabel(displayAnime.status) ?? '—'}</span></div>
            <div><span className="text-[var(--text-faint)]">Format: </span><span className="text-[var(--text)]">{formatLabel(displayAnime.format) ?? '—'}</span></div>
            {displayAnime.identity.malId && <div><span className="text-[var(--text-faint)]">MAL ID: </span><span className="text-[var(--text)]">{displayAnime.identity.malId}</span></div>}
            {loading && <p className="text-[var(--text-faint)]">Loading metadata…</p>}
            {error && <p className="text-[var(--warn)]">{error}</p>}
            {/* Related Shows / Manga live inside the sidebar column so no
                dead space sits between the metadata and the related rows. */}
            {!isMangaKind && displayAnime.identity.anilistId && (
              <AnimeRelatedEntries anilistId={displayAnime.identity.anilistId} relations={displayAnime.relations} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function AnimeRelatedEntries({ anilistId, relations }: { anilistId: number; relations: import('../types/anime').Anime['relations'] }) {
  const { entries, loading } = useRelatedEntries(anilistId, relations)
  return <RelatedEntries entries={entries} loading={loading} />
}
