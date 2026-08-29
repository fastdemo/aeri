import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTracking } from '../contexts/TrackingContext'
import { useAnimeDetail } from '../hooks/useAnimeMetadata'
import { VideoPlayer } from '../components/player/VideoPlayer'
import { resolveEpisodesWithFallback, resolveSourcesWithFallback, getProviderCapabilities } from '../providers/video/registry'
import type { VideoEpisode, VideoSourceEnhanced } from '../providers/video/types'
import { getWatchPos, putWatchPos, clearWatchPos } from '../storage/db'
import { getPreferences } from '../storage/preferences'

export function Watch() {
  const { id, episode } = useParams<{ id: string; episode: string }>()
  const { isAuthenticated, combinedList, updateProgress } = useTracking()
  const epNum = Number(episode ?? 1)

  const trackingEntry = isAuthenticated && id ? combinedList?.find((e) => e.anime.identity.internalId === id || e.anime.identity.anilistId?.toString() === id || e.anime.identity.malId?.toString() === id || e.anime.identity.internalId.startsWith(`anilist-${id}`) || e.anime.identity.internalId.startsWith(`mal-${id}`)) : null
  const realId = (() => {
    if (!id) return undefined
    if (id.startsWith('anilist-') || id.startsWith('mal-') || /^\d+$/.test(id)) return id
    if (trackingEntry?.anime.identity.anilistId) return `anilist-${trackingEntry.anime.identity.anilistId}`
    return id
  })()

  const { data: remote, loading: loadingAnime } = useAnimeDetail(realId)
  const anime = trackingEntry?.anime ?? remote

  // AniList progress sync (existing behavior, throttled)
  useEffect(() => {
    if (!isAuthenticated || !anime) return
    updateProgress(anime, epNum).catch(() => {})
    try {
      localStorage.setItem(`aeri:progress:${anime.identity.internalId}`, String(epNum))
    } catch {}
  }, [isAuthenticated, anime, epNum, updateProgress])

  // Video provider: episodes — shell renders immediately, episode list is immediate from AniList metadata
  // Video provider episodes are only for source mapping, not for UI list (which uses anime.episodes/streamingEpisodes directly)
  const [providerEpisodes, setProviderEpisodes] = useState<VideoEpisode[] | null>(null)
  const episodesLoading = false // episode list is immediate from AniList, not blocked by video provider
  const [providerId, setProviderId] = useState<string | null>(null)

  // Immediate episode list from AniList metadata (no provider wait) — authoritative Media.episodes, not streamingEpisodes length
  const immediateEpisodes = useMemo(() => {
    if (!anime) return []
    const count = anime.episodes ?? anime.streamingEpisodes?.length ?? 12
    const n = Math.min(count, 100)
    return Array.from({ length: n }, (_, i) => ({
      number: i + 1,
      title: anime.streamingEpisodes?.[i]?.title,
    }))
  }, [anime])

  // Background: resolve provider episodes for source mapping (does not block UI)
  useEffect(() => {
    if (!anime) return
    let cancelled = false
    resolveEpisodesWithFallback(anime)
      .then(res => {
        if (cancelled) return
        setProviderEpisodes(res.episodes)
        setProviderId(res.providerId)
      })
      .catch(() => {
        if (cancelled) return
        // keep immediateEpisodes fallback
      })
    return () => { cancelled = true }
  }, [anime?.identity.internalId])

  // Current episode (from provider, or fallback to immediate)
  const currentEpisode: VideoEpisode | null = useMemo(() => {
    if (!providerEpisodes) return null
    return providerEpisodes.find(e => e.number === epNum) ?? null
  }, [providerEpisodes, epNum])

  // If episodes not yet loaded but we have anime.episodes count, synthesize a currentEpisode for source resolution
  const effectiveEpisode: VideoEpisode | null = useMemo(() => {
    if (currentEpisode) return currentEpisode
    if (!anime) return null
    // Fallback: create a synthetic episode so source resolution can still be attempted (will return no-source)
    return {
      id: `${anime.identity.internalId}-${epNum}`,
      animeId: anime.identity.internalId,
      number: epNum,
      title: `Episode ${epNum}`,
      provider: providerId ?? 'mock',
      providerEpisodeId: `${anime.identity.internalId}-${epNum}`,
    }
  }, [currentEpisode, anime, epNum, providerId])

  // Video provider: sources for current episode (respects Settings preferences)
  const [sources, setSources] = useState<VideoSourceEnhanced[] | null>(null)
  const [sourcesLoading, setSourcesLoading] = useState(false)
  const [sourcesError, setSourcesError] = useState<string | null>(null)
  const [selectedSource, setSelectedSource] = useState<VideoSourceEnhanced | null>(null)
  const [triedProviders, setTriedProviders] = useState<string[]>([])
  const prefs = getPreferences()
  const preferredProvider = prefs.preferredProvider
  const preferredAudio = prefs.preferredAudio

  useEffect(() => {
    if (!effectiveEpisode) return
    let cancelled = false
    const controller = new AbortController()
    setSourcesLoading(true)
    setSourcesError(null)
    setSources(null)
    setSelectedSource(null)
    setTriedProviders([])
    resolveSourcesWithFallback(effectiveEpisode, { preferredProvider, preferredLanguage: preferredAudio, signal: controller.signal })
      .then(res => {
        if (cancelled || controller.signal.aborted) return
        setSources(res.sources)
        setTriedProviders(res.tried)
        if (res.sources.length > 0) {
          // Prefer language matching preference, else first
          const preferred = res.sources.find(s => s.language === preferredAudio)
          setSelectedSource(preferred ?? res.sources[0])
        } else setSourcesError(null)
        setSourcesLoading(false)
      })
      .catch(e => {
        if (cancelled || controller.signal.aborted || (e as any)?.name === 'AbortError') return
        setSourcesError(e instanceof Error ? e.message : 'Couldn’t find video source')
        setSourcesLoading(false)
      })
    return () => { cancelled = true; controller.abort() }
  }, [effectiveEpisode?.id, effectiveEpisode?.providerEpisodeId, preferredProvider, preferredAudio])

  // Local watch position (resume)
  const [watchPos, setWatchPos] = useState<{ currentTime: number; duration: number } | null>(null)
  const [showResume, setShowResume] = useState(false)
  const hasShownResume = useRef(false)

  useEffect(() => {
    if (!anime) return
    let cancelled = false
    getWatchPos(anime.identity.internalId).then(pos => {
      if (cancelled || !pos) return
      // Only show resume if it's for the same episode and not near start ( >30s) and not near end ( <90% )
      if (pos.episode === epNum && pos.currentTime > 30 && pos.duration > 0 && pos.currentTime < pos.duration * 0.9) {
        if (!hasShownResume.current) {
          setWatchPos({ currentTime: pos.currentTime, duration: pos.duration })
          setShowResume(true)
          hasShownResume.current = true
        }
      }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [anime?.identity.internalId, epNum])

  // When episode changes, reset resume flag
  useEffect(() => { hasShownResume.current = false; setShowResume(false) }, [epNum])

  const handleTimeUpdate = useCallback((currentTime: number, duration: number) => {
    if (!anime || !duration || duration < 30) return
    // Throttle: only store every 5 seconds or on significant change
    const now = Date.now()
    if ((handleTimeUpdate as any)._lastSave && now - (handleTimeUpdate as any)._lastSave < 5000) return
    ;(handleTimeUpdate as any)._lastSave = now
    putWatchPos({ id: anime.identity.internalId, episode: epNum, currentTime, duration, updatedAt: Date.now() }).catch(() => {})
    // Near end (>90%) → consider completed for AniList (throttled, reuse existing updateProgress which is already called on mount, but we can also update on near-end)
    if (currentTime / duration > 0.92 && isAuthenticated) {
      // Only update once per episode
      if (!(handleTimeUpdate as any)._hasCompleted) {
        ;(handleTimeUpdate as any)._hasCompleted = true
        updateProgress(anime, epNum).catch(() => {})
      }
    }
  }, [anime, epNum, isAuthenticated, updateProgress])

  const handleEnded = useCallback(() => {
    if (!anime) return
    // Clear watch pos for this anime (episode completed)
    clearWatchPos(anime.identity.internalId).catch(() => {})
    if (isAuthenticated) {
      // Advance AniList progress if not already
      updateProgress(anime, epNum).catch(() => {})
    }
  }, [anime, epNum, isAuthenticated, updateProgress])

  const handleResume = () => {
    setShowResume(false)
    // VideoPlayer will seek via initialTime prop
  }

  const handleRestart = () => {
    setShowResume(false)
    setWatchPos(null)
    if (anime) clearWatchPos(anime.identity.internalId).catch(() => {})
  }

  if (loadingAnime && !anime) {
    return (
      <div className="mx-auto max-w-[1280px] px-0 sm:px-4 lg:px-6">
        <div className="aspect-video w-full animate-pulse rounded-lg bg-white/5" />
      </div>
    )
  }

  if (!anime) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-12 text-center">
        <p className="text-white">Anime not found.</p>
        <Link to="/" className="mt-4 inline-block text-sm text-white/60 underline">
          Back to home
        </Link>
      </div>
    )
  }

  const prev = epNum > 1 ? epNum - 1 : null
  const next = anime.episodes && epNum < anime.episodes ? epNum + 1 : null
  const backdrop = anime.backdropImage || anime.coverImage || ''
  const hasVideo = sources && sources.length > 0 && selectedSource && selectedSource.url
  const isLoadingVideo = episodesLoading || sourcesLoading
  const showNoSource = !isLoadingVideo && (!sources || sources.length === 0) && !sourcesError
  const capabilities = getProviderCapabilities().filter(c => c.id !== 'mock')

  return (
    <div className="min-h-screen bg-black">
      <div className="mx-auto max-w-[1280px] px-0 sm:px-4 lg:px-6">
        {/* Player area */}
        <div className="relative aspect-video w-full overflow-hidden bg-[#0a0a0a] sm:rounded-lg">
          {/* Backdrop fallback (visible when no video) */}
          {!hasVideo && (
            <img
              src={backdrop}
              alt=""
              className="absolute inset-0 h-full w-full object-cover opacity-80"
              loading="eager"
              decoding="async"
              onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
            />
          )}

          {/* Loading: episode finding */}
          {isLoadingVideo && (
            <div className="absolute inset-0 grid place-items-center bg-black/40 backdrop-blur-sm">
              <div className="text-center">
                <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                <p className="mt-3 text-sm font-medium text-white">
                  {episodesLoading ? 'Finding episodes…' : 'Finding video source…'}
                </p>
                <p className="text-xs text-white/50">Trying {providerId ?? 'providers'} • {triedProviders.join(', ') || '…'}</p>
              </div>
            </div>
          )}

          {/* Video player when source available */}
          {hasVideo && !isLoadingVideo && (
            <VideoPlayer
              sources={sources!}
              selectedSource={selectedSource}
              onSourceChange={setSelectedSource}
              onTimeUpdate={handleTimeUpdate}
              onEnded={handleEnded}
              initialTime={showResume ? undefined : (watchPos?.currentTime ?? 0)}
              animeTitle={anime.title.english ?? anime.title.romaji}
              episodeNumber={epNum}
            />
          )}

          {/* Resume prompt */}
          {showResume && watchPos && hasVideo && (
            <div className="absolute inset-x-4 bottom-16 flex justify-center sm:bottom-20">
              <div className="flex items-center gap-2 rounded-full bg-black/80 px-4 py-2 text-xs text-white backdrop-blur">
                <span>Resume from {Math.floor(watchPos.currentTime / 60)}:{String(Math.floor(watchPos.currentTime % 60)).padStart(2, '0')}?</span>
                <button onClick={handleResume} className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-black hover:bg-white/90">Resume</button>
                <button onClick={handleRestart} className="rounded-full bg-white/20 px-3 py-1 text-xs text-white hover:bg-white/30">Restart</button>
              </div>
            </div>
          )}

          {/* No-source placeholder (when no provider works) */}
          {showNoSource && !isLoadingVideo && (
            <div className="absolute inset-0 grid place-items-center bg-black/60 p-6 text-center backdrop-blur-[1px]">
              <div className="max-w-md">
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-white text-black">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path d="M10 16l6-4-6-4v8z" />
                    <circle cx="12" cy="12" r="10" />
                  </svg>
                </div>
                <p className="mt-3 text-sm font-medium text-white">No playable source is currently available for this episode.</p>
                <p className="mx-auto mt-1 text-xs leading-5 text-white/60">
                  This source isn&apos;t available right now. Try another source or episode. Aeri is static on GitHub Pages — most providers need a server proxy. Configure a video backend in Settings for playback.
                </p>
                {triedProviders.length > 0 && (
                  <p className="mt-2 text-[11px] text-white/40">Tried: {triedProviders.join(' • ')}</p>
                )}
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <button
                    onClick={() => {
                      if (effectiveEpisode) {
                        setSourcesLoading(true)
                        resolveSourcesWithFallback(effectiveEpisode, { preferredProvider, preferredLanguage: preferredAudio }).then(res => {
                          setSources(res.sources)
                          setTriedProviders(res.tried)
                          if (res.sources.length) {
                            const pref = res.sources.find(s => s.language === preferredAudio)
                            setSelectedSource(pref ?? res.sources[0])
                          }
                          setSourcesLoading(false)
                        })
                      }
                    }}
                    className="rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black hover:bg-white/90"
                  >
                    Retry
                  </button>
                  <Link to="/settings" className="rounded-full bg-white/15 px-4 py-1.5 text-xs font-medium text-white backdrop-blur hover:bg-white/20">
                    Change source
                  </Link>
                  <Link to={`/anime/${id}`} className="rounded-full bg-white/15 px-4 py-1.5 text-xs font-medium text-white backdrop-blur hover:bg-white/20">
                    Episodes
                  </Link>
                </div>
                <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                  {capabilities.slice(0,4).map(c => (
                    <span key={c.id} className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-white/50">
                      {c.displayName}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Source error */}
          {sourcesError && !isLoadingVideo && (
            <div className="absolute inset-0 grid place-items-center bg-black/60 p-6 text-center">
              <div>
                <p className="text-sm font-medium text-white">This source isn&apos;t available right now.</p>
                <p className="mt-1 text-xs text-white/60">{sourcesError}</p>
                <div className="mt-3 flex justify-center gap-2">
                  <button
                    onClick={() => {
                      if (effectiveEpisode) {
                        setSourcesLoading(true)
                        setSourcesError(null)
                        resolveSourcesWithFallback(effectiveEpisode, { preferredProvider, preferredLanguage: preferredAudio }).then(res => {
                          setSources(res.sources)
                          setTriedProviders(res.tried)
                          if (res.sources.length) {
                            const pref = res.sources.find(s => s.language === preferredAudio)
                            setSelectedSource(pref ?? res.sources[0])
                          } else setSourcesError(null)
                          setSourcesLoading(false)
                        })
                      }
                    }}
                    className="rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black"
                  >
                    Try another source
                  </button>
                  <Link to="/settings" className="rounded-full bg-white/15 px-4 py-1.5 text-xs font-medium text-white">Change source</Link>
                </div>
              </div>
            </div>
          )}

          {/* Top bar */}
          <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent px-4 py-3">
            <Link to={`/anime/${id}`} className="text-sm font-medium text-white hover:text-white/80">
              ← {anime.title.english ?? anime.title.romaji}
            </Link>
            <span className="text-xs text-white/60">E{String(epNum).padStart(2, '0')}</span>
          </div>

          {/* Bottom gradient when no video */}
          {!hasVideo && <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/60 to-transparent" />}
        </div>

        <div className="px-4 py-5 sm:px-0">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-[15px] font-semibold text-white">
                {anime.title.english ?? anime.title.romaji} — Episode {epNum}
              </h1>
              <p className="mt-1 text-xs text-white/60">
                {anime.title.romaji} • {anime.year} • {anime.duration}m
                {providerId && providerId !== 'mock' ? ` • ${providerId}` : ''}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Source selector */}
              {sources && sources.length > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-white/50">Source:</span>
                  <select
                    value={selectedSource?.url ?? ''}
                    onChange={e => {
                      const s = sources.find(s => s.url === e.target.value)
                      if (s) setSelectedSource(s)
                    }}
                    aria-label="Select video source"
                    className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 pr-8 text-xs text-white focus:border-white/20 focus:outline-none"
                  >
                    {sources.map(s => (
                      <option key={s.url} value={s.url} className="bg-[#141416]">
                        {s.provider} {s.quality ? `• ${s.quality}` : ''} {s.language ? `• ${s.language}` : ''} {s.embed ? '• embed' : ''}
                      </option>
                    ))}
                  </select>
                  <span className="text-[10px] text-white/30">{preferredProvider ? `Preferred: ${preferredProvider}` : 'Auto'}</span>
                </div>
              )}
              {/* SUB/DUB toggle when available */}
              {sources && sources.some(s => s.language) && (
                <div className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] p-1">
                  {(['sub','dub'] as const).map(lang => {
                    const hasLang = sources.some(s => s.language === lang)
                    const isActive = selectedSource?.language === lang || (!selectedSource?.language && preferredAudio === lang)
                    return (
                      <button
                        key={lang}
                        disabled={!hasLang}
                        onClick={() => {
                          const match = sources.find(s => s.language === lang)
                          if (match) setSelectedSource(match)
                        }}
                        className={`rounded-full px-3 py-1 text-xs font-medium ${isActive ? 'bg-white text-black' : hasLang ? 'text-white/70 hover:text-white' : 'text-white/20'}`}
                      >
                        {lang.toUpperCase()}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Episode navigation */}
          <div className="mt-4 flex items-center gap-2">
            {prev ? (
              <Link
                to={`/watch/${id}/${prev}`}
                className="rounded-full border border-white/15 bg-white/10 px-4 py-1.5 text-xs font-medium text-white hover:bg-white/15"
              >
                ← Previous
              </Link>
            ) : (
              <span className="rounded-full border border-white/10 px-4 py-1.5 text-xs text-white/30">← Previous</span>
            )}

            <Link
              to={`/anime/${id}`}
              className="rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black hover:bg-white/90"
            >
              Episodes
            </Link>

            {next ? (
              <Link
                to={`/watch/${id}/${next}`}
                className="rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black hover:bg-white/90"
              >
                Next →
              </Link>
            ) : (
              <span className="rounded-full border border-white/10 px-4 py-1.5 text-xs text-white/30">Next →</span>
            )}

            <span className="ml-2 text-xs text-white/40">{immediateEpisodes.length} episodes{providerId && providerId !== 'mock' ? ` • ${providerId}` : ''}</span>
          </div>

          {/* Episode list — immediate from AniList metadata, not blocked by video provider */}
          <div className="mt-6">
            <h2 className="mb-2 text-sm font-semibold text-white">Episodes</h2>
            {immediateEpisodes.length > 0 ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                {immediateEpisodes.map(ep => {
                  const isCurrent = ep.number === epNum
                  const realTitle = anime.streamingEpisodes?.[ep.number - 1]?.title
                  return (
                    <Link
                      key={ep.number}
                      to={`/watch/${id}/${ep.number}`}
                      className={`relative flex aspect-video flex-col items-center justify-center overflow-hidden rounded bg-white/5 p-2 text-center transition ${isCurrent ? 'ring-1 ring-white/30 bg-white/10' : 'hover:bg-white/10'}`}
                      aria-label={`Watch Episode ${ep.number}${realTitle ? ` - ${realTitle}` : ''}`}
                    >
                      <span className={`text-xs font-medium ${isCurrent ? 'text-white' : 'text-white/70'}`}>Ep {ep.number}</span>
                      {realTitle && <span className="mt-1 line-clamp-1 text-[10px] text-white/40">{realTitle}</span>}
                      {isCurrent && <span className="absolute bottom-1 left-1/2 h-0.5 w-8 -translate-x-1/2 bg-[#e50914]" />}
                    </Link>
                  )
                })}
              </div>
            ) : (
              <p className="text-sm text-white/50">No episodes found. Try another anime.</p>
            )}
          </div>

          <p className="mt-6 max-w-[720px] text-sm leading-6 text-white/70">{anime.description || 'No description available.'}</p>

          {/* Provider capabilities footer (quiet) */}
          <div className="mt-6 flex flex-wrap gap-1.5">
            {getProviderCapabilities().filter(c => c.id !== 'mock').map(c => (
              <span key={c.id} className="rounded-full border border-white/5 bg-white/[0.02] px-2 py-1 text-[10px] text-white/30">
                {c.displayName} {c.languages.join('/')}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
