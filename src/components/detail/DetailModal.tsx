import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Anime, AnimeStatus } from '../../types/anime'
import { EpisodeList, getEpisodes } from '../episodes/EpisodeList'
import { useTracking } from '../../contexts/TrackingContext'
import { useSeriesGroup } from '../../hooks/useSeriesGroup'
import { displayRating, formatRating } from '../../lib/rating'
import { getTitleHierarchy } from '../../lib/titles'
import { sanitizeAnimeForDisplay, sanitizeGroup, getDisplayEpisodeNumber } from '../../lib/episodes'
import { formatLabel, statusLabel } from '../../lib/mediaLabels'

function ScoreBadge({ anime, trackingProvider }: { anime: Anime; trackingProvider?: 'anilist' | 'mal' | null }) {
  const text = formatRating(displayRating(anime, trackingProvider))
  if (!text) return null
  return (
    <span className="inline-flex items-center gap-1 rounded bg-[color-mix(in_srgb,var(--text)_10%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text)]">
      <span className="text-[var(--text)]">★</span> {text}
    </span>
  )
}

export function DetailModal({
  anime,
  onClose,
}: {
  anime: Anime
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const { isAuthenticated, combinedList, updateStatus, error: trackingError, trackingProvider } = useTracking()
  const [syncing, setSyncing] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [showStatusPicker, setShowStatusPicker] = useState(false)

  // Base entry: prop-only match, available before grouping resolves
  const baseEntry = (() => {
    if (!isAuthenticated || !combinedList) return null
    const malId = anime.identity.malId
    const anilistId = anime.identity.anilistId
    return combinedList.find((e) => {
      if (malId && e.anime.identity.malId === malId) return true
      if (anilistId && e.anime.identity.anilistId === anilistId) return true
      if (e.anime.identity.internalId === anime.identity.internalId) return true
      return false
    }) ?? null
  })()

  const currentScore = baseEntry?.score ?? null
  const baseAnime = baseEntry?.anime ?? anime

  // Series grouping — starts at mount from the card's id (parallel with the
  // modal's own open), not after any other fetch. Season UI stays in a stable
  // placeholder until the model is ready, so nothing pops in mid-animation.
  const routeAnilistId = baseAnime.identity.anilistId ?? null
  const { group: seriesGroup, ready: groupReady } = useSeriesGroup(routeAnilistId)

  // Modal opens on Season 1; picking another season swaps the displayed
  // season in place (same group, no route change inside the modal).
  const [selectedSeasonIdx, setSelectedSeasonIdx] = useState(0)
  const effectiveGroupRaw = useMemo(() => {
    if (!seriesGroup || seriesGroup.seasons.length <= 1) return null
    if (!baseAnime.identity.anilistId) return seriesGroup
    const contains = seriesGroup.seasons.some(s => s.identity.anilistId === baseAnime.identity.anilistId)
    return contains ? seriesGroup : null
  }, [seriesGroup, baseAnime.identity.anilistId])
  const effectiveGroup = useMemo(() => {
    if (!effectiveGroupRaw) return null
    return sanitizeGroup(effectiveGroupRaw)
  }, [effectiveGroupRaw])
  const displayAnime = useMemo(() => {
    if (effectiveGroup) {
      return effectiveGroup.seasons[selectedSeasonIdx] ?? baseAnime
    }
    return sanitizeAnimeForDisplay(baseAnime, null, null)
  }, [effectiveGroup, selectedSeasonIdx, baseAnime])
  const displayKey = displayAnime.identity.anilistId ? `anilist:${displayAnime.identity.anilistId}` : displayAnime.identity.internalId
  const titles = getTitleHierarchy(displayAnime, effectiveGroup)
  const isMovie = displayAnime.format?.toUpperCase() === 'MOVIE'
  const isMangaKind = ['MANGA', 'NOVEL', 'ONE_SHOT'].includes(displayAnime.format?.toUpperCase() ?? '')

  // Tracking entry: the displayed season's own entry only (see below).
  // Tracking, per displayed season — never cross-season numbers. A season-2
  // view must not show season-1's "26 of 7": progress/resume/bar come ONLY
  // from the displayed season's own entry. Status falls back across the
  // franchise so the badge still informs when this season is untouched.
  const entry = useMemo(() => {
    if (!isAuthenticated || !combinedList) return null
    const id = displayAnime.identity
    return combinedList.find((e) => {
      if (id.malId && e.anime.identity.malId === id.malId) return true
      if (id.anilistId && e.anime.identity.anilistId === id.anilistId) return true
      return e.anime.identity.internalId === id.internalId
    }) ?? null
  }, [isAuthenticated, combinedList, displayAnime])
  const trackedStatus = entry?.status ?? baseEntry?.status ?? displayAnime.listStatus ?? null
  const currentStatus: AnimeStatus | null = trackedStatus
  const numEp = entry?.progress ?? 0
  const hasWatched = numEp > 0
  const resumeEp = numEp
  // Finished entries always render a full bar even when no percent survived mapping
  const barPercent = (() => {
    if (!entry) return 0
    const p = entry.anime.progress?.percent
    if (typeof p === 'number' && p > 0) return Math.min(100, p)
    if (entry.status === 'completed') return 100
    return 0
  })()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Body lock — must not delay navigation. Save/restore overflow synchronously on mount/unmount;
  // hashchange/popstate will unmount this modal AFTER route has already changed (HashRouter push is sync).
  useEffect(() => {
    const prevBody = document.body.style.overflow
    const prevHtml = document.documentElement.style.overflow
    // Prevent background scroll without creating a stacking context that captures pointer events
    document.body.style.overflow = 'hidden'
    // iOS: also lock html to prevent rubber-band scroll from swallowing hashchange
    // but keep pointer events on fixed header (z-50) unaffected — overflow hidden does not intercept clicks
    return () => {
      document.body.style.overflow = prevBody
      document.documentElement.style.overflow = prevHtml
    }
  }, [])

  useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  // Close on any navigation — must not prevent HashRouter's hashchange.
  // Listeners are passive; they only react AFTER route has changed.
  // Use ref so we don't re-subscribe on every onClose identity change (avoids flicker that could swallow click).
  const onCloseRef = useRef(onClose)
  useEffect(() => { onCloseRef.current = onClose }, [onClose])
  useEffect(() => {
    const close = () => onCloseRef.current()
    window.addEventListener('hashchange', close, { passive: true } as any)
    window.addEventListener('popstate', close, { passive: true } as any)
    window.addEventListener('aeri:navigate' as any, close, { passive: true } as any)
    return () => {
      window.removeEventListener('hashchange', close)
      window.removeEventListener('popstate', close)
      window.removeEventListener('aeri:navigate' as any, close)
    }
  }, [])

  const metaParts = [formatLabel(displayAnime.format), displayAnime.year ? String(displayAnime.year) : null, displayAnime.season ? displayAnime.season.charAt(0) + displayAnime.season.slice(1).toLowerCase() : null, !isMovie && !isMangaKind && displayAnime.episodes ? `${displayAnime.episodes} Episodes` : null, isMangaKind && displayAnime.chapters ? `${displayAnime.chapters} Chapters` : null, isMangaKind && displayAnime.volumes ? `${displayAnime.volumes} Volumes` : null, statusLabel(displayAnime.status)].filter(Boolean).join(' • ')

  return (
    <div className="fixed inset-x-0 bottom-0 top-14 z-40 flex items-start justify-center overflow-y-auto bg-[color-mix(in_srgb,var(--bg)_75%,transparent)] p-2 backdrop-blur-[2px] anim-fade-in sm:p-6 lg:p-8">
      <button aria-label="Close" onClick={onClose} className="fixed inset-0 top-14 cursor-default" tabIndex={-1} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={titles.primary}
        tabIndex={-1}
        className="relative my-2 flex max-h-none w-full max-w-[980px] flex-col overflow-visible rounded-xl bg-[var(--bg-soft)] shadow-[0_24px_64px_var(--shadow)] outline-none anim-pop-in-center sm:my-6"
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 z-20 grid h-8 w-8 place-items-center rounded-full bg-[color-mix(in_srgb,var(--bg)_60%,transparent)] text-[var(--text)] backdrop-blur hover:bg-[color-mix(in_srgb,var(--bg)_80%,transparent)]"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>

        <div className="relative h-[360px] w-full overflow-hidden rounded-t-xl sm:h-[420px]">
          <img src={displayAnime.backdropImage || anime.backdropImage} alt="" className="h-full w-full object-cover" loading="eager" />
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(180deg, color-mix(in srgb, var(--bg) 55%, transparent) 0%, transparent 22%, transparent 55%, color-mix(in srgb, var(--bg) 45%, transparent) 78%, var(--bg) 100%)',
            }}
          />
          <div className="absolute left-6 top-6 hidden max-w-[520px] sm:block">
            <h2 className="text-[28px] font-semibold leading-none tracking-tighter text-[var(--text)] drop-shadow">
              {titles.primary}
            </h2>
            {titles.native && <p className="mt-1 text-xs text-[var(--text-muted)]">{titles.native}</p>}
            {titles.romaji && <p className="mt-1 text-[11px] tracking-wide text-[var(--text-faint)]">{titles.romaji}</p>}
          </div>

          <div className="absolute bottom-0 left-0 right-0 flex flex-wrap items-center gap-2 px-4 pb-4 sm:px-6">
            {barPercent > 0 && (
              <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-[color-mix(in_srgb,var(--text)_15%,transparent)]">
                <div className="h-full bg-[var(--text)] shadow-[0_0_8px_var(--shadow)]" style={{ width: `${barPercent}%` }} />
              </div>
            )}

            <Link
              to={`/watch/${displayAnime.identity.internalId}/${hasWatched ? resumeEp : 1}`}
              className="inline-flex h-8 items-center gap-1.5 rounded bg-[var(--text)] px-4 text-[13px] font-semibold text-[var(--on-text)] hover:bg-[color-mix(in_srgb,var(--text)_90%,transparent)]"
              style={isMangaKind ? { display: 'none' } : undefined}
              aria-hidden={isMangaKind || undefined}
              tabIndex={isMangaKind ? -1 : undefined}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5.14v13.72L19 12z" />
              </svg>
              {hasWatched ? 'Resume' : 'Play'}
            </Link>
            {isMangaKind && (displayAnime.chapters || displayAnime.volumes) ? (
              <span className="inline-flex h-8 items-center rounded bg-[color-mix(in_srgb,var(--text)_10%,transparent)] px-4 text-[13px] font-medium text-[var(--text-muted)]">
                {[displayAnime.chapters ? `${displayAnime.chapters} chapters` : null, displayAnime.volumes ? `${displayAnime.volumes} volumes` : null].filter(Boolean).join(' • ')}
              </span>
            ) : null}
            {hasWatched && (
              <span className="text-xs text-[var(--text-muted)]">
                {resumeEp}{displayAnime.episodes && displayAnime.episodes > 0 ? ` of ${displayAnime.episodes}` : ''} • {barPercent}% watched
              </span>
            )}

            <div className="ml-auto flex items-center gap-2">
              <div className="relative">
                <button
                  aria-label={currentStatus ? `Status: ${currentStatus}` : 'Add to My List'}
                  onClick={async () => {
                    if (!isAuthenticated) {
                      setLocalError('Sign in with AniList or connect MyAnimeList in Settings to track.')
                      setTimeout(() => setLocalError(null), 2500)
                      return
                    }
                    if (!currentStatus) {
                      setSyncing('status')
                      try {
                        await updateStatus(displayAnime, 'watching')
                      } catch (e) {
                        setLocalError(e instanceof Error ? e.message : 'Couldn’t update status')
                      } finally {
                        setSyncing(null)
                      }
                    } else {
                      setShowStatusPicker((v) => !v)
                    }
                  }}
                  className={`grid h-8 w-8 place-items-center rounded-full border bg-[color-mix(in_srgb,var(--bg)_30%,transparent)] backdrop-blur hover:bg-[color-mix(in_srgb,var(--text)_10%,transparent)] ${currentStatus ? 'border-[var(--border-strong)] text-[var(--text)] bg-[color-mix(in_srgb,var(--text)_10%,transparent)]' : 'border-[var(--border-strong)] text-[var(--text)]'}`}
                >
                  {syncing === 'status' ? (
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--border-strong)] border-t-[var(--text)]" />
                  ) : currentStatus ? (
                    <span className="text-[10px] font-bold">{currentStatus === 'watching' ? '●' : currentStatus === 'completed' ? '✓' : '+'}</span>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  )}
                </button>
                {showStatusPicker && (
                  <div className="absolute right-0 top-9 z-10 w-40 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] shadow-xl anim-pop-in">
                    {(['watching', 'completed', 'planned', 'on_hold', 'dropped'] as AnimeStatus[]).map((s) => (
                      <button
                        key={s}
                        onClick={async () => {
                          setSyncing('status')
                          setShowStatusPicker(false)
                          try {
                            await updateStatus(displayAnime, s)
                          } catch (e) {
                            setLocalError(e instanceof Error ? e.message : 'Couldn’t update status')
                          } finally {
                            setSyncing(null)
                          }
                        }}
                        className={`flex w-full items-center justify-between px-3 py-2 text-xs hover:bg-[color-mix(in_srgb,var(--text)_10%,transparent)] ${currentStatus === s ? 'bg-[color-mix(in_srgb,var(--text)_10%,transparent)] text-[var(--text)]' : 'text-[var(--text-muted)]'}`}
                      >
                        <span className="capitalize">{s.replace('_', ' ')}</span>
                        {currentStatus === s && <span className="text-[10px]">●</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {(localError || trackingError) && (
          <div className="mx-4 mt-3 rounded border border-[var(--warn)] bg-[var(--warn)] px-3 py-2 text-xs text-[var(--warn)] sm:mx-6">
            {localError ?? trackingError}
          </div>
        )}
        {isAuthenticated && (currentStatus || currentScore !== null) && (
          <div className="flex flex-wrap gap-2 px-4 pt-3 text-[11px] sm:px-6">
            {currentStatus && (
              <span className="rounded-full border border-[var(--border)] bg-[color-mix(in_srgb,var(--text)_5%,transparent)] px-2 py-1 text-[var(--text-muted)]">
                Status: <span className="capitalize text-[var(--text)]">{currentStatus.replace('_', ' ')}</span>
              </span>
            )}
            {currentScore !== null && currentScore > 0 && (
              <span className="rounded-full border border-[var(--border)] bg-[color-mix(in_srgb,var(--text)_5%,transparent)] px-2 py-1 text-[var(--text)]">
                <span className="text-[var(--text)]">★</span> {currentScore}/10
              </span>
            )}
            {syncing && <span className="px-2 py-1 text-[var(--text-faint)]">Syncing…</span>}
          </div>
        )}

        <div className="grid gap-6 px-4 py-5 sm:px-6 lg:grid-cols-[1.7fr_0.9fr]">
          <div className="min-w-0">
            {/* Mobile title hierarchy — visible only when desktop overlay hidden */}
            <div className="mb-3 sm:hidden">
              <h2 className="text-[20px] font-semibold leading-none tracking-tighter text-[var(--text)]">{titles.primary}</h2>
              {titles.native && <p className="mt-1 text-xs text-[var(--text-muted)]">{titles.native}</p>}
              {titles.romaji && <p className="mt-1 text-[11px] tracking-wide text-[var(--text-faint)]">{titles.romaji}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-muted)]">
              <span>{metaParts}</span>
              <ScoreBadge anime={displayAnime} trackingProvider={trackingProvider} />
            </div>

            {!isMovie && !isMangaKind && (() => {
              // Use the normalized episode map (same source as EpisodeList) so
              // titles/numbers respect season offsets — never raw array index.
              const norm = getEpisodes(displayAnime).map(e => ({
                ...e,
                displayNumber: getDisplayEpisodeNumber(displayAnime, e.number, effectiveGroup, selectedSeasonIdx),
              }))
              const epNum = numEp > 0 ? numEp : (displayAnime.progress?.episode ?? 1)
              const target = norm.find(e => e.number === epNum) ?? norm[0]
              if (!target) return null
              const epTitle = target.title
              if (!epTitle && !hasWatched && !displayAnime.progress) return null
              const sNum = selectedSeasonIdx + 1
              return (
                <p className="mt-2 text-[12px] font-semibold text-[var(--text)]">
                  S{sNum}:E{target.displayNumber} {epTitle ? `• ${epTitle}` : ''}
                </p>
              )
            })()}
            <p className="mt-1 line-clamp-3 text-[13px] leading-6 text-[var(--text-muted)]">
              {displayAnime.description || 'No description available.'}
            </p>

            {!isMovie && !isMangaKind && !groupReady && (
              <div className="mt-4" aria-label="Loading seasons">
                <div className="h-[30px] w-32 animate-pulse rounded-full bg-[color-mix(in_srgb,var(--text)_5%,transparent)]" />
              </div>
            )}
            {!isMovie && !isMangaKind && groupReady && effectiveGroup && (
              <div className="mt-4 flex items-center gap-2">
                <div className="relative">
                  <select
                    value={String(selectedSeasonIdx)}
                    onChange={e => setSelectedSeasonIdx(Number(e.target.value))}
                    aria-label="Select season"
                    className="appearance-none rounded-full border border-[var(--border)] bg-[var(--text)]/[0.06] px-3 py-1.5 pr-8 text-xs font-medium text-[var(--text)] focus:border-[var(--border-strong)] focus:outline-none"
                  >
                    {effectiveGroup.seasons.map((s, idx) => (
                      <option key={s.identity.anilistId ? `anilist:${s.identity.anilistId}` : s.identity.internalId} value={String(idx)} className="bg-[var(--surface)]">
                        Season {idx + 1}
                      </option>
                    ))}
                  </select>
                  <svg aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--text-faint)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </div>
              </div>
            )}

            {!isMovie && !isMangaKind && (
              <>
                <h3 className="mt-6 text-[14px] font-semibold text-[var(--text)]">Episodes</h3>
                <div className="mt-3">
                  <EpisodeList key={displayKey} anime={displayAnime} seasonNumber={selectedSeasonIdx + 1} />
                </div>
              </>
            )}
          </div>

          <div className="space-y-3 border-t border-[var(--border)] pt-4 lg:border-t-0 lg:pt-0">
            {displayAnime.genres.length > 0 && (
              <div className="text-xs leading-5">
                <span className="text-[var(--text-faint)]">Genres: </span>
                <span className="text-[var(--text)]">{displayAnime.genres.join(', ')}</span>
              </div>
            )}
            {displayAnime.studios && displayAnime.studios.length > 0 && (
              <div className="text-xs leading-5">
                <span className="text-[var(--text-faint)]">Studios: </span>
                <span className="text-[var(--text)]">{displayAnime.studios.join(', ')}</span>
              </div>
            )}
            {formatLabel(displayAnime.format) && (
              <div className="text-xs leading-5">
                <span className="text-[var(--text-faint)]">Format: </span>
                <span className="text-[var(--text)]">{formatLabel(displayAnime.format)}</span>
              </div>
            )}
            {statusLabel(displayAnime.status) && (
              <div className="text-xs leading-5">
                <span className="text-[var(--text-faint)]">Status: </span>
                <span className="text-[var(--text)]">{statusLabel(displayAnime.status)}</span>
              </div>
            )}
            {displayAnime.year && (
              <div className="text-xs leading-5">
                <span className="text-[var(--text-faint)]">Year: </span>
                <span className="text-[var(--text)]">{displayAnime.year}{displayAnime.season ? ` • ${displayAnime.season.charAt(0) + displayAnime.season.slice(1).toLowerCase()}` : ''}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
