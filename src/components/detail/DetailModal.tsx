import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Anime, AnimeStatus } from '../../types/anime'
import { EpisodeList } from '../episodes/EpisodeList'
import { useTracking } from '../../contexts/TrackingContext'
import { getSeriesGroup, type AnimeSeriesGroup } from '../../services/anilist/series'
import { getTitleHierarchy } from '../../lib/titles'
import { sanitizeAnimeForDisplay, sanitizeGroup } from '../../lib/episodes'

export function DetailModal({
  anime,
  onClose,
}: {
  anime: Anime
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const { isAuthenticated, combinedList, updateStatus, updateRating, error: trackingError } = useTracking()
  const [syncing, setSyncing] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [showStatusPicker, setShowStatusPicker] = useState(false)
  const [showRatingPicker, setShowRatingPicker] = useState(false)

  // Find entry via combinedList using normalized identity (anilistId or malId or internalId)
  const entry = (() => {
    if (!isAuthenticated || !combinedList) return null
    const malId = anime.identity.malId
    const anilistId = anime.identity.anilistId
    return combinedList.find((e) => {
      if (malId && e.anime.identity.malId === malId) return true
      if (anilistId && e.anime.identity.anilistId === anilistId) return true
      if (e.anime.identity.internalId === anime.identity.internalId) return true
      // Also check cross: if anime has anilistId but entry has malId that matches anime's malId (via AniList's idMal)
      return false
    }) ?? null
  })()

  const currentStatus: AnimeStatus | null = entry?.status ?? anime.listStatus ?? null
  const currentScore = entry?.score ?? null
  const baseAnime = entry?.anime ?? anime

  // Series grouping — abortable, selectedSeason === displayAnime invariant
  const [seriesGroup, setSeriesGroup] = useState<AnimeSeriesGroup | null>(null)
  const [selectedSeasonIdx, setSelectedSeasonIdx] = useState(0)
  const requestIdRef = useRef(0)
  const seriesGroupRef = useRef<AnimeSeriesGroup | null>(null)
  seriesGroupRef.current = seriesGroup
  const selectedIdxRef = useRef(0)
  selectedIdxRef.current = selectedSeasonIdx

  useEffect(() => {
    if (!baseAnime.identity.anilistId) {
      setSeriesGroup(null)
      setSelectedSeasonIdx(0)
      return
    }
    const currentId = baseAnime.identity.anilistId
    const curGroup = seriesGroupRef.current
    if (curGroup) {
      const idxInCurrent = curGroup.seasons.findIndex(s => s.identity.anilistId === currentId)
      if (idxInCurrent >= 0 && idxInCurrent !== selectedIdxRef.current) {
        setSelectedSeasonIdx(idxInCurrent)
      }
    }
    const reqId = ++requestIdRef.current
    const controller = new AbortController()
    getSeriesGroup(currentId, { signal: controller.signal })
      .then(g => {
        if (controller.signal.aborted || reqId !== requestIdRef.current) return
        if (g && g.seasons.length > 1) {
          setSeriesGroup(g)
          const idx = g.seasons.findIndex(s => s.identity.anilistId === currentId)
          setSelectedSeasonIdx(idx >= 0 ? idx : 0)
        } else {
          setSeriesGroup(null)
          setSelectedSeasonIdx(0)
        }
      })
      .catch(e => {
        if ((e as any)?.name === 'AbortError') return
        if (reqId !== requestIdRef.current) return
        setSeriesGroup(null)
        setSelectedSeasonIdx(0)
      })
    return () => controller.abort()
  }, [baseAnime.identity.anilistId])

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

  const meta = [displayAnime.format, displayAnime.year ? String(displayAnime.year) : null, displayAnime.season ? displayAnime.season.charAt(0) + displayAnime.season.slice(1).toLowerCase() : null, !isMovie && displayAnime.episodes ? `${displayAnime.episodes} Episodes` : null, displayAnime.status ? displayAnime.status.charAt(0) + displayAnime.status.slice(1).toLowerCase() : null].filter(Boolean).join(' · ') + ' · HD'

  return (
    <div className="fixed inset-x-0 bottom-0 top-14 z-40 flex items-start justify-center overflow-y-auto bg-black/75 p-2 backdrop-blur-[2px] sm:p-6 lg:p-8">
      <button aria-label="Close" onClick={onClose} className="fixed inset-0 top-14 cursor-default" tabIndex={-1} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={titles.primary}
        tabIndex={-1}
        className="relative my-2 flex max-h-none w-full max-w-[980px] flex-col overflow-visible rounded-xl bg-[#0e0e10] shadow-[0_24px_64px_rgba(0,0,0,0.9)] outline-none sm:my-6"
      >
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 z-20 grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white backdrop-blur hover:bg-black/80"
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
                'linear-gradient(0deg, #0e0e10 6%, rgba(14,14,16,0.85) 18%, rgba(14,14,16,0.35) 42%, transparent 68%)',
            }}
          />
          <div className="absolute left-6 top-6 hidden max-w-[520px] sm:block">
            <h2 className="text-[28px] font-semibold leading-none tracking-tighter text-white drop-shadow">
              {titles.primary}
            </h2>
            {titles.native && <p className="mt-1 text-xs text-white/65">{titles.native}</p>}
            {titles.romaji && <p className="mt-1 text-[11px] tracking-wide text-white/50">{titles.romaji}</p>}
          </div>

          <div className="absolute bottom-0 left-0 right-0 flex flex-wrap items-center gap-2 px-4 pb-4 sm:px-6">
            {displayAnime.progress && (
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/10">
                <div className="h-full bg-[#e50914]" style={{ width: `${displayAnime.progress.percent}%` }} />
              </div>
            )}

            <Link
              to={`/watch/${displayAnime.identity.internalId}/${displayAnime.progress ? displayAnime.progress.episode : 1}`}
              className="inline-flex h-8 items-center gap-1.5 rounded bg-white px-4 text-[13px] font-semibold text-black hover:bg-white/90"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5.14v13.72L19 12z" />
              </svg>
              {displayAnime.progress ? 'Resume' : 'Play'}
            </Link>
            {displayAnime.progress && (
              <span className="text-xs text-white/70">
                {displayAnime.progress.episode} of {displayAnime.episodes ?? '?'} • {displayAnime.progress.percent}% watched
              </span>
            )}

            <div className="ml-auto flex items-center gap-2">
              <div className="relative">
                <button
                  aria-label={currentStatus ? `Status: ${currentStatus}` : 'Add to My List'}
                  onClick={async () => {
                    if (!isAuthenticated) {
                      setLocalError('Connect AniList or MyAnimeList in My List to track.')
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
                  className={`grid h-8 w-8 place-items-center rounded-full border bg-black/30 backdrop-blur hover:bg-white/10 ${currentStatus ? 'border-white/30 text-white bg-white/10' : 'border-white/20 text-white'}`}
                >
                  {syncing === 'status' ? (
                    <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  ) : currentStatus ? (
                    <span className="text-[10px] font-bold">{currentStatus === 'watching' ? '●' : currentStatus === 'completed' ? '✓' : '+'}</span>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 5v14M5 12h14" />
                    </svg>
                  )}
                </button>
                {showStatusPicker && (
                  <div className="absolute right-0 top-9 z-10 w-40 overflow-hidden rounded-lg border border-white/10 bg-[#1c1c1e] shadow-xl">
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
                        className={`flex w-full items-center justify-between px-3 py-2 text-xs hover:bg-white/10 ${currentStatus === s ? 'bg-white/10 text-white' : 'text-white/70'}`}
                      >
                        <span className="capitalize">{s.replace('_', ' ')}</span>
                        {currentStatus === s && <span className="text-[10px]">●</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="relative">
                <button
                  aria-label={currentScore ? `Rated ${currentScore}` : 'Rate'}
                  onClick={() => {
                    if (!isAuthenticated) {
                      setLocalError('Connect AniList or MyAnimeList to rate.')
                      setTimeout(() => setLocalError(null), 2500)
                      return
                    }
                    setShowRatingPicker((v) => !v)
                  }}
                  className={`grid h-8 w-8 place-items-center rounded-full border bg-black/30 backdrop-blur hover:bg-white/10 ${currentScore ? 'border-amber-400/40 text-amber-300' : 'border-white/20 text-white'}`}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill={currentScore ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8">
                    <path d="M12 17 6 21l1.5-6.5L2 9l6.5-.6L12 2l3.5 6.4L22 9l-5.5 5.5L18 21z" />
                  </svg>
                </button>
                {showRatingPicker && (
                  <div className="absolute right-0 top-9 z-10 w-48 rounded-lg border border-white/10 bg-[#1c1c1e] p-3 shadow-xl">
                    <p className="mb-2 text-xs font-medium text-white">Rate</p>
                    <div className="grid grid-cols-5 gap-1">
                      {[2, 4, 6, 8, 10].map((score) => (
                        <button
                          key={score}
                          onClick={async () => {
                            setSyncing('rating')
                            setShowRatingPicker(false)
                            try {
                              await updateRating(displayAnime, score)
                            } catch (e) {
                              setLocalError(e instanceof Error ? e.message : 'Couldn’t save rating')
                            } finally {
                              setSyncing(null)
                            }
                          }}
                          className={`rounded px-2 py-1 text-xs font-medium ${currentScore === score ? 'bg-white text-black' : 'bg-white/10 text-white hover:bg-white/15'}`}
                        >
                          {score}
                        </button>
                      ))}
                    </div>
                    <button
                      onClick={async () => {
                        setSyncing('rating')
                        setShowRatingPicker(false)
                        try {
                          await updateRating(displayAnime, 0)
                        } catch (e) {
                          setLocalError(e instanceof Error ? e.message : 'Couldn’t clear rating')
                        } finally {
                          setSyncing(null)
                        }
                      }}
                      className="mt-2 w-full rounded bg-white/5 py-1 text-xs text-white/60 hover:bg-white/10"
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {(localError || trackingError) && (
          <div className="mx-4 mt-3 rounded border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200/90 sm:mx-6">
            {localError ?? trackingError}
          </div>
        )}
        {isAuthenticated && (currentStatus || currentScore !== null) && (
          <div className="flex flex-wrap gap-2 px-4 pt-3 text-[11px] sm:px-6">
            {currentStatus && (
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-white/70">
                Status: <span className="capitalize text-white">{currentStatus.replace('_', ' ')}</span>
              </span>
            )}
            {currentScore !== null && currentScore > 0 && (
              <span className="rounded-full border border-amber-400/20 bg-amber-500/10 px-2 py-1 text-amber-200/90">
                ★ {currentScore}/10
              </span>
            )}
            {syncing && <span className="px-2 py-1 text-white/50">Syncing…</span>}
          </div>
        )}

        <div className="grid gap-6 px-4 py-5 sm:px-6 lg:grid-cols-[1.7fr_0.9fr]">
          <div className="min-w-0">
            {/* Mobile title hierarchy — visible only when desktop overlay hidden */}
            <div className="mb-3 sm:hidden">
              <h2 className="text-[20px] font-semibold leading-none tracking-tighter text-white">{titles.primary}</h2>
              {titles.native && <p className="mt-1 text-xs text-white/60">{titles.native}</p>}
              {titles.romaji && <p className="mt-1 text-[11px] tracking-wide text-white/50">{titles.romaji}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-white/70">
              <span>{meta}</span>
              {displayAnime.rating && <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold">★ {displayAnime.rating.toFixed(1)}</span>}
            </div>

            {!isMovie && (() => {
              const firstEp = displayAnime.streamingEpisodes?.[0]
              const epNum = displayAnime.progress?.episode ?? 1
              const epTitle = displayAnime.streamingEpisodes?.[epNum - 1]?.title ?? firstEp?.title
              if (!epTitle && !displayAnime.progress) return null
              const sNum = selectedSeasonIdx + 1
              return (
                <p className="mt-2 text-[12px] font-semibold text-white/90">
                  {displayAnime.progress ? `S${sNum}:E${epNum}` : `S${sNum}:E1`} {epTitle ? `· ${epTitle}` : ''}
                </p>
              )
            })()}
            <p className="mt-1 line-clamp-3 text-[13px] leading-6 text-white/70">
              {displayAnime.description || 'No description available.'}
            </p>

            {!isMovie && effectiveGroup && (
              <div className="mt-4 flex items-center gap-2">
                <span className="text-xs text-white/50">Season</span>
                <div className="relative">
                  <select
                    value={String(selectedSeasonIdx)}
                    onChange={e => setSelectedSeasonIdx(Number(e.target.value))}
                    aria-label="Select season"
                    className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 pr-8 text-xs font-medium text-white focus:border-white/20 focus:outline-none"
                  >
                    {effectiveGroup.seasons.map((s, idx) => {
                        const parts = [`Season ${idx + 1}`]
                        if (s.year) parts.push(String(s.year))
                        if (s.episodes) parts.push(`${s.episodes} eps`)
                        return (
                          <option key={s.identity.anilistId ? `anilist:${s.identity.anilistId}` : s.identity.internalId} value={String(idx)} className="bg-[#141416]">
                            {parts.join(' • ')}
                          </option>
                        )
                      })}
                  </select>
                  <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-white/40">▼</span>
                </div>
                <span className="text-xs text-white/30">{effectiveGroup.totalSeasons} seasons</span>
              </div>
            )}

            {!isMovie && (
              <>
                <h3 className="mt-6 text-[14px] font-semibold text-white">Episodes</h3>
                <div className="mt-3">
                  <EpisodeList key={displayKey} anime={displayAnime} seasonNumber={selectedSeasonIdx + 1} />
                </div>
              </>
            )}
          </div>

          <div className="space-y-3 border-t border-white/10 pt-4 lg:border-t-0 lg:pt-0">
            {displayAnime.genres.length > 0 && (
              <div className="text-xs leading-5">
                <span className="text-white/50">Genres: </span>
                <span className="text-white/80">{displayAnime.genres.join(', ')}</span>
              </div>
            )}
            {displayAnime.studios && displayAnime.studios.length > 0 && (
              <div className="text-xs leading-5">
                <span className="text-white/50">Studios: </span>
                <span className="text-white/80">{displayAnime.studios.join(', ')}</span>
              </div>
            )}
            {displayAnime.format && (
              <div className="text-xs leading-5">
                <span className="text-white/50">Format: </span>
                <span className="text-white/80">{displayAnime.format}</span>
              </div>
            )}
            {displayAnime.status && (
              <div className="text-xs leading-5">
                <span className="text-white/50">Status: </span>
                <span className="text-white/80">{displayAnime.status}</span>
              </div>
            )}
            {displayAnime.year && (
              <div className="text-xs leading-5">
                <span className="text-white/50">Year: </span>
                <span className="text-white/80">{displayAnime.year}{displayAnime.season ? ` • ${displayAnime.season.charAt(0) + displayAnime.season.slice(1).toLowerCase()}` : ''}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
