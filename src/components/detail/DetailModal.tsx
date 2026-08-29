import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Anime, AnimeStatus } from '../../types/anime'
import { EpisodeList } from '../episodes/EpisodeList'
import { useTracking } from '../../contexts/TrackingContext'

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
  const displayAnime = entry?.anime ?? anime

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  const meta = [anime.format, anime.year ? String(anime.year) : null, anime.season ? anime.season.charAt(0) + anime.season.slice(1).toLowerCase() : null, anime.episodes ? `${anime.episodes} Episodes` : null, anime.status ? anime.status.charAt(0) + anime.status.slice(1).toLowerCase() : null].filter(Boolean).join(' · ') + ' · HD'

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/75 p-2 backdrop-blur-[2px] sm:p-6 lg:p-8">
      <button aria-label="Close" onClick={onClose} className="fixed inset-0 cursor-default" tabIndex={-1} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={anime.title.english ?? anime.title.romaji}
        tabIndex={-1}
        className="relative my-2 flex max-h-none w-full max-w-[980px] flex-col overflow-hidden rounded-xl bg-[#0e0e10] shadow-[0_24px_64px_rgba(0,0,0,0.9)] outline-none sm:my-6"
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

        <div className="relative h-[360px] w-full overflow-hidden sm:h-[420px]">
          <img src={anime.backdropImage} alt="" className="h-full w-full object-cover" loading="eager" />
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(0deg, #0e0e10 6%, rgba(14,14,16,0.85) 18%, rgba(14,14,16,0.35) 42%, transparent 68%)',
            }}
          />
          <div className="absolute left-6 top-6 hidden sm:block">
            <p className="text-[11px] font-bold tracking-[0.24em] text-[#e50914]">AERI</p>
            <h2 className="mt-3 max-w-[520px] text-[28px] font-semibold leading-none tracking-tighter text-white drop-shadow">
              {anime.title.english ?? anime.title.romaji}
            </h2>
            {anime.title.native && <p className="mt-1 text-xs text-white/60">{anime.title.native}</p>}
          </div>

          <div className="absolute bottom-0 left-0 right-0 flex flex-wrap items-center gap-2 px-4 pb-4 sm:px-6">
            {displayAnime.progress && (
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/10">
                <div className="h-full bg-[#e50914]" style={{ width: `${displayAnime.progress.percent}%` }} />
              </div>
            )}

            <Link
              to={`/watch/${anime.identity.internalId}/${displayAnime.progress ? displayAnime.progress.episode : 1}`}
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
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-white/70">
              <span>{meta}</span>
              {anime.rating && <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold">★ {anime.rating.toFixed(1)}</span>}
            </div>

            {(() => {
              const firstEp = anime.streamingEpisodes?.[0]
              const epNum = displayAnime.progress?.episode ?? 1
              const epTitle = anime.streamingEpisodes?.[epNum - 1]?.title ?? firstEp?.title
              // Only show episode line if we have real title or progress
              if (!epTitle && !displayAnime.progress) return null
              return (
                <p className="mt-2 text-[12px] font-semibold text-white/90">
                  {displayAnime.progress ? `S1:E${epNum}` : 'S1:E1'} {epTitle ? `· ${epTitle}` : ''}
                </p>
              )
            })()}
            <p className="mt-1 line-clamp-3 text-[13px] leading-6 text-white/70">
              {anime.description || 'No description available.'}
            </p>

            <h3 className="mt-6 text-[14px] font-semibold text-white">Episodes</h3>
            <div className="mt-3">
              <EpisodeList anime={anime} />
            </div>
          </div>

          <div className="space-y-3 border-t border-white/10 pt-4 lg:border-t-0 lg:pt-0">
            {anime.genres.length > 0 && (
              <div className="text-xs leading-5">
                <span className="text-white/50">Genres: </span>
                <span className="text-white/80">{anime.genres.join(', ')}</span>
              </div>
            )}
            {anime.studios && anime.studios.length > 0 && (
              <div className="text-xs leading-5">
                <span className="text-white/50">Studios: </span>
                <span className="text-white/80">{anime.studios.join(', ')}</span>
              </div>
            )}
            {anime.format && (
              <div className="text-xs leading-5">
                <span className="text-white/50">Format: </span>
                <span className="text-white/80">{anime.format}</span>
              </div>
            )}
            {anime.status && (
              <div className="text-xs leading-5">
                <span className="text-white/50">Status: </span>
                <span className="text-white/80">{anime.status}</span>
              </div>
            )}
            {anime.year && (
              <div className="text-xs leading-5">
                <span className="text-white/50">Year: </span>
                <span className="text-white/80">{anime.year}{anime.season ? ` • ${anime.season.charAt(0) + anime.season.slice(1).toLowerCase()}` : ''}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
