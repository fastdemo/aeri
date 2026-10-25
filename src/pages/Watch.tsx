import { lazy, Suspense, useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { Link, useParams, useNavigate, useLocation, Navigate } from 'react-router-dom'
import { useTracking } from '../contexts/TrackingContext'
import { useAnimeDetail } from '../hooks/useAnimeMetadata'
import { useAeriTitle } from '../hooks/useAeriTitle'
import { resolveEpisodesWithFallback, resolveSourcesForLanguages } from '../providers/video/registry'
import type { VideoEpisode, VideoSourceEnhanced } from '../providers/video/types'
import { getWatchPos, putWatchPos, clearWatchPos } from '../storage/db'
import { getPreferences, isIncognitoEnabled } from '../storage/preferences'
import { getTitleHierarchy } from '../lib/titles'
import { normalizeEpisodes, sanitizeAnimeForDisplay } from '../lib/episodes'
import { useKitsuEpisodes } from '../hooks/useKitsuEpisodes'
import { formatLabel } from '../lib/mediaLabels'
import { Icon } from '../components/ui/Icon'
import { FilterSelect } from '../components/ui/FilterSelect'
import { useRelatedEntries } from '../hooks/useRelatedEntries'
import { RelatedRow } from '../components/related/RelatedRow'
import { detailPath } from '../hooks/useDetailOpen'

// The player is the only route that needs Video.js + the HLS adapter; keep
// both out of the initial bundle for Home/Browse/Search/List.
const VideoPlayer = lazy(() => import('../components/player/VideoPlayer').then((m) => ({ default: m.VideoPlayer })))

// Video.js owns playback for direct HLS/MP4 only. Embed sources are not
// offered anywhere in the player or source picker (D125).
function isPlayableSource(source: VideoSourceEnhanced): boolean {
  return Boolean(source.url) && !source.embed && source.type !== 'embed'
}

export function Watch() {
  const { id, episode } = useParams<{ id: string; episode: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { isAuthenticated, combinedList, updateProgress, updateStatus } = useTracking()

  // URL is the episode number of THIS entry. No season offsets, no global
  // numbering: entry owns its episodes 1..N.
  const epNum = Number(episode ?? 1)

  const trackingEntry = isAuthenticated && id ? combinedList?.find((e) => e.anime.identity.internalId === id || e.anime.identity.anilistId?.toString() === id || e.anime.identity.malId?.toString() === id || e.anime.identity.internalId.startsWith(`anilist-${id}`) || e.anime.identity.internalId.startsWith(`mal-${id}`)) : null
  const realId = (() => {
    if (!id) return undefined
    if (id.startsWith('anilist-') || id.startsWith('mal-') || /^\d+$/.test(id)) return id
    if (trackingEntry?.anime.identity.anilistId) return `anilist-${trackingEntry.anime.identity.anilistId}`
    return id
  })()

  const { data: remote, loading: loadingAnime } = useAnimeDetail(realId)
  // DISPLAY RECORD RULE (same root cause as AnimeDetail): the tracker's
  // list copy is a THIN MediaListCollection record (no relations, no
  // streamingEpisodes). It supplies tracking state only — all display
  // data comes from the full Media record, or nothing renders yet.
  const anime = remote ?? null
  // TAB TITLE (owner 2026-10-18): the show's own name, e.g. "Naruto - Aeri".
  // HOOK PLACEMENT RULE: this call MUST sit above the component's early
  // returns (redirect/skeleton/not-found) — hooks are called on EVERY
  // render, and a call added after an early return crashes React with
  // "Rendered more hooks than during the previous render" the moment the
  // record resolves (verify: /watch/anilist-20/21 emptied #root in the
  // headless probe until this was hoisted).
  useAeriTitle(anime ? (getTitleHierarchy(anime).primary || null) : null, 'override')
  // CARD ≠ PAGE CONTROLS (2026-10-18): the Episodes/Details buttons open the
  // floating detail card WITH the nav state (this page as background + the
  // record when held) so the card floats over the watch page and closing
  // returns here intact. A bare Link would swap the background to Home and
  // remount the page on close — the "refresh" the owner reported.
  const detailNav = anime
    ? { to: detailPath(anime), state: { background: { pathname: location.pathname, search: location.search }, anime } }
    : { to: `/anime/${id}`, state: { background: { pathname: location.pathname, search: location.search } } }
  const matchHints = {
    animeTitle: anime ? (anime.title.romaji || anime.title.english || null) : null,
    animeEnglish: anime?.title.english ?? null,
    animeNative: anime?.title.native ?? null,
    animeEpisodes: typeof anime?.episodes === 'number' ? anime.episodes : null,
    animeFormat: anime?.format ?? null,
    animeYear: typeof anime?.year === 'number' ? anime.year : null,
  }

  // Video provider: episodes — shell renders immediately, episode list is immediate from AniList metadata
  // Video provider episodes are only for source mapping, not for UI list (which uses anime.episodes/streamingEpisodes directly)
  const [providerEpisodes, setProviderEpisodes] = useState<VideoEpisode[] | null>(null)
  const episodesLoading = false // episode list is immediate from AniList, not blocked by video provider
  const [providerId, setProviderId] = useState<string | null>(null)

  // This entry only: sanitize standalone (sort/filter/fix), no group model.
  const sanitizedAnimeForWatch = useMemo(() => {
    if (!anime) return null
    return sanitizeAnimeForDisplay(anime)
  }, [anime])

  // Episode names/thumbnails: AniList first; Kitsu ONLY when AniList has no
  // usable episode metadata at all; otherwise the UI placeholder. The
  // video-provider episode list is for source mapping only. `anime` is the
  // pre-sanitize record so the gate still sees AniList data that the
  // season/range guard discards for display.
  const kitsu = useKitsuEpisodes(sanitizedAnimeForWatch, anime)

  const immediateEpisodes = useMemo(() => {
    if (!sanitizedAnimeForWatch) return []
    const eps = normalizeEpisodes(sanitizedAnimeForWatch, null, kitsu)
    return eps.map(e => ({
      number: e.number,
      displayNumber: e.number,
      title: e.title,
      thumbnail: e.thumbnail,
    }))
  }, [sanitizedAnimeForWatch, kitsu])

  // PROGRESS VALIDITY (owner 2026-10-23): never write progress from an
  // incomplete/broken record. A usable record has at least one tracker id,
  // a real title, a finite episode number and — when the total is known —
  // an episode inside 1..total. Anything else performs NO tracker write.
  const canSyncProgress = Boolean(
    anime &&
    Number.isFinite(epNum) && epNum > 0 &&
    (anime.identity.anilistId != null || anime.identity.malId != null) &&
    (anime.title?.romaji || anime.title?.english || anime.title?.native) &&
    (anime.episodes == null || anime.episodes <= 0 || epNum <= anime.episodes),
  )

  // OWNER (2026-10-25): "reaching 80% advances progress by one." A write
  // must never REGRESS the tracker: rewatching an earlier episode (progress
  // 8, episode 3 at 80%) leaves progress at 8. Only a not-yet-counted
  // episode advances it.
  const trackedProgress = trackingEntry?.progress ?? anime?.progress?.episode ?? 0
  const canAdvanceProgress = canSyncProgress && epNum > trackedProgress

  // NOTE (owner 2026-10-23): opening an episode does not mark it WATCHED.
  // Progress advances exactly once per episode, when >= 80% of a genuinely
  // loaded video has played (below), or when the video ends.
  //
  // OWNER (2026-10-25): opening an episode DOES put the title in Watching —
  // status + start date, even when the episode is unfinished. This is the
  // "I started this show" signal, separate from episode completion. Written
  // once per open, only when the entry is not already Watching (so a
  // completed title restarted at episode 1 becomes a rewatch). Incognito
  // suppresses the automatic write exactly like progress.
  const trackingStatus = trackingEntry?.status ?? anime?.listStatus ?? null
  const autoWatchingRef = useRef(false)
  useEffect(() => {
    if (!anime || !canSyncProgress || !isAuthenticated) return
    if (autoWatchingRef.current) return
    if (trackingStatus === 'watching') return
    if (isIncognitoEnabled()) return
    autoWatchingRef.current = true
    updateStatus(anime, 'watching').catch(() => { autoWatchingRef.current = false })
  }, [anime, canSyncProgress, isAuthenticated, trackingStatus, updateStatus])

  // Background: resolve provider episodes for source mapping (does not block UI) — abortable
  useEffect(() => {
    if (!anime) return
    const controller = new AbortController()
    let cancelled = false
    resolveEpisodesWithFallback(anime, controller.signal)
      .then(res => {
        if (cancelled || controller.signal.aborted) return
        setProviderEpisodes(res.episodes)
        setProviderId(res.providerId)
      })
      .catch(() => {
        if (cancelled) return
      })
    return () => { cancelled = true; controller.abort() }
  }, [anime?.identity.internalId, anime?.identity.anilistId, anime?.episodes, anime?.streamingEpisodes?.length])

  // Current episode (from provider, or fallback to immediate)
  const currentEpisode: VideoEpisode | null = useMemo(() => {
    if (!providerEpisodes) return null
    return providerEpisodes.find(e => e.number === epNum) ?? null
  }, [providerEpisodes, epNum])

  // If episodes not yet loaded but we have anime.episodes count, synthesize a currentEpisode for source resolution
  // Stable id (no providerId jitter) to avoid double fetch when providerId flips null->mock
  const effectiveEpisode: VideoEpisode | null = useMemo(() => {
    if (currentEpisode) return currentEpisode
    if (!anime) return null
    const stableId = `${anime.identity.internalId}-${epNum}`
    return {
      id: stableId,
      animeId: anime.identity.internalId,
      number: epNum,
      title: `Episode ${epNum}`,
      provider: providerId ?? 'mock',
      providerEpisodeId: stableId,
    }
  }, [currentEpisode, anime?.identity.internalId, epNum])

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
    resolveSourcesForLanguages(effectiveEpisode, { preferredProvider, preferredLanguage: preferredAudio, languages: ['sub', 'dub'], signal: controller.signal, ...matchHints })
      .then(res => {
        if (cancelled || controller.signal.aborted) return
        const playable = res.sources.filter(isPlayableSource)
        setSources(playable)
        setTriedProviders(res.tried)
        if (playable.length > 0) {
          // Prefer language matching preference, else first
          const preferred = playable.find(s => s.language === preferredAudio)
          setSelectedSource(preferred ?? playable[0])
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
  const [watchPos, setWatchPos] = useState<{ currentTime: number; duration: number; episode: number } | null>(null)
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
          setWatchPos({ currentTime: pos.currentTime, duration: pos.duration, episode: pos.episode })
          setShowResume(true)
          hasShownResume.current = true
        }
      }
    }).catch(() => {})
    return () => { cancelled = true }
  }, [anime?.identity.internalId, epNum])

  // When episode changes, reset resume flag
  useEffect(() => { hasShownResume.current = false; setShowResume(false) }, [epNum])

  const lastSaveRef = useRef(0)
  const hasCompletedRef = useRef(false)
  useEffect(() => { hasCompletedRef.current = false }, [epNum])

  const handleTimeUpdate = useCallback((currentTime: number, duration: number) => {
    if (!anime || !Number.isFinite(duration) || duration < 30) return
    // 80% rule (owner 2026-10-23): an episode counts as FINISHED — and only
    // then does tracker progress advance (+1) — once 80% of the loaded
    // video has played. Evaluated on every tick BEFORE the position-save
    // throttle so crossing the threshold is never skipped.
    if (canAdvanceProgress && isAuthenticated && !hasCompletedRef.current && currentTime / duration >= 0.8) {
      hasCompletedRef.current = true
      updateProgress(anime, epNum).catch(() => {})
    }
    const now = Date.now()
    if (now - lastSaveRef.current < 5000) return
    lastSaveRef.current = now
    putWatchPos({ id: anime.identity.internalId, episode: epNum, currentTime, duration, updatedAt: Date.now() }).catch(() => {})
  }, [anime, epNum, isAuthenticated, updateProgress, canAdvanceProgress])

  const handleEnded = useCallback(() => {
    if (!anime) return
    clearWatchPos(anime.identity.internalId).catch(() => {})
    // End-of-video = 100% watched; same validity + no-regression gate as the
    // 80% path.
    if (isAuthenticated && canAdvanceProgress && !hasCompletedRef.current) {
      hasCompletedRef.current = true
      updateProgress(anime, epNum).catch(() => {})
    }
    try {
      const prefs = getPreferences()
      const isMovieNow = anime.format?.toUpperCase() === 'MOVIE'
      if (prefs.autoplay && id && !isMovieNow && immediateEpisodes.length > 0 && epNum < immediateEpisodes.length) {
        navigate(`/watch/${id}/${epNum + 1}`)
      }
    } catch {}
  }, [anime, epNum, isAuthenticated, updateProgress, canAdvanceProgress, id, navigate, immediateEpisodes.length])

  const handleResume = () => {
    setShowResume(false)
    // VideoPlayer will seek via initialTime prop
  }

  const handleRestart = () => {
    setShowResume(false)
    setWatchPos(null)
    if (anime) clearWatchPos(anime.identity.internalId).catch(() => {})
  }

  if (!isAuthenticated) {
    return <Navigate to="/" replace />
  }
  if (loadingAnime && !anime) {
    return (
      <div className="mx-auto max-w-[1280px] px-0 sm:px-4 lg:px-6">
        <div className="aspect-video w-full animate-pulse rounded-lg bg-[color-mix(in_srgb,var(--text)_5%,transparent)]" />
      </div>
    )
  }

  if (!anime) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-12 text-center">
        <p className="text-[var(--text)]">Anime not found.</p>
        <Link to="/" className="mt-4 inline-block text-sm text-[var(--text-muted)] underline">
          Back to home
        </Link>
      </div>
    )
  }

  const isMovie = anime.format?.toUpperCase() === 'MOVIE'
  const prevLocal = !isMovie && epNum > 1 ? epNum - 1 : null
  const nextLocal = !isMovie && immediateEpisodes.length > 0 && epNum < immediateEpisodes.length ? epNum + 1 : null
  const prev = prevLocal
  const next = nextLocal
  const backdrop = anime.backdropImage || anime.coverImage || ''
  // Episode tiles use the same placeholder rule as EpisodeList: an episode
  // without its own artwork shows the show's own backdrop/cover — never a
  // bare empty box.
  const fallbackThumb = anime.backdropImage || anime.coverImage || ''
  // Metadata line owner rule (2026-10-24): season + year, format, duration —
  // never the playback provider. "Fall 2006 • TV • 24m".
  const seasonLabel = formatLabel(anime.season)
  const yearLabel = anime.year ? String(anime.year) : null
  const seasonYearLabel = seasonLabel && yearLabel ? `${seasonLabel} ${yearLabel}` : (yearLabel ?? seasonLabel)
  const metaLine = [
    seasonYearLabel,
    formatLabel(anime.format) ?? anime.format ?? null,
    anime.duration ? `${anime.duration}m` : null,
  ].filter(Boolean).join(' • ') || '—'
  // Episode nav pills follow the manga reader: filled text-colored pills,
  // unavailable sides disabled at 40% opacity. The middle pill is a status,
  // not a control — a span, never a button.
  const navPill = 'inline-flex max-w-full items-center justify-center truncate rounded-full bg-[var(--text)] px-4 py-1.5 text-xs font-semibold text-[var(--on-text)] transition disabled:cursor-not-allowed disabled:opacity-40'
  const navPillLink = `${navPill} hover:bg-[color-mix(in_srgb,var(--text)_90%,transparent)] active:scale-[0.98]`
  const titles = getTitleHierarchy(anime)
  const hasVideo = sources && sources.length > 0 && selectedSource && selectedSource.url
  const isLoadingVideo = episodesLoading || sourcesLoading
  const showNoSource = !isLoadingVideo && (!sources || sources.length === 0) && !sourcesError

  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <div className="mx-auto max-w-[1280px] px-0 sm:px-4 lg:px-6">
        {/* Player area. The OLD player's wrapper chrome (soft background +
            rounded corners) is gone (owner 2026-10-25): Video.js 10 paints
            its own surface and bottom control gradient, so any wrapper fill
            or radius showed through as an artifact around the video. The
            placeholder frame (no video yet) keeps its soft surface/rounding. */}
        <div className={`relative aspect-video w-full overflow-hidden ${hasVideo && !isLoadingVideo ? 'bg-transparent' : 'bg-[var(--bg-soft)] sm:rounded-lg'}`}>
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

          {/* Loading: episode finding - pointer-events-none so navbar remains clickable even while loading */}
          {isLoadingVideo && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center bg-[color-mix(in_srgb,var(--bg)_40%,transparent)]">
              <div className="text-center">
                <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-[var(--border-strong)] border-t-[var(--text)]" />
                <p className="mt-3 text-sm font-medium text-[var(--text)]">
                  {episodesLoading ? 'Finding episodes…' : 'Finding video source…'}
                </p>
                <p className="text-xs text-[var(--text-faint)]">Trying {providerId ?? 'providers'} • {triedProviders.join(', ') || '…'}</p>
              </div>
            </div>
          )}

          {/* Video player when source available */}
          {hasVideo && !isLoadingVideo && (
            <Suspense
              fallback={
                backdrop ? (
                  <img src={backdrop} alt="" className="absolute inset-0 h-full w-full object-cover opacity-80" />
                ) : null
              }
            >
              <VideoPlayer
                sources={sources!}
                selectedSource={selectedSource}
                onTimeUpdate={handleTimeUpdate}
                onEnded={handleEnded}
                initialTime={showResume ? undefined : (watchPos && watchPos.episode === epNum ? watchPos.currentTime : 0)}
                animeTitle={titles.primary}
                episodeNumber={epNum}
                volume={getPreferences().volume}
                autoplay={getPreferences().autoplay}
                subtitles={getPreferences().subtitles ? selectedSource?.subtitles : undefined}
                poster={backdrop || undefined}
              />
            </Suspense>
          )}

          {/* Resume prompt — top center, clear of player controls.
              Shows whenever a saved position exists (not gated on video
              readiness, which can lag behind IDB on slow networks). */}
          {showResume && watchPos && (
            <div className="absolute inset-x-4 top-14 flex justify-center">
              <div className="flex items-center gap-2 rounded-full bg-[color-mix(in_srgb,var(--bg)_80%,transparent)] px-4 py-2 text-xs text-[var(--text)] backdrop-blur">
                <span>Resume from {Math.floor(watchPos.currentTime / 60)}:{String(Math.floor(watchPos.currentTime % 60)).padStart(2, '0')}?</span>
                <button onClick={handleResume} className="rounded-full bg-[var(--text)] px-3 py-1 text-xs font-semibold text-[var(--on-text)] hover:bg-[color-mix(in_srgb,var(--text)_90%,transparent)]">Resume</button>
                <button onClick={handleRestart} className="rounded-full bg-[color-mix(in_srgb,var(--text)_20%,transparent)] px-3 py-1 text-xs text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--text)_30%,transparent)]">Restart</button>
              </div>
            </div>
          )}

          {/* No-source placeholder (when no provider works) - outer pointer-events-none so navbar stays clickable, inner auto for buttons */}
          {showNoSource && !isLoadingVideo && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center bg-[color-mix(in_srgb,var(--bg)_60%,transparent)] p-6 text-center">
              <div className="pointer-events-auto max-w-md">
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[var(--text)] text-[var(--on-text)]">
                  <Icon name="play-circle" size={22} />
                </div>
                <p className="mt-3 text-sm font-medium text-[var(--text)]">No playable source is currently available for this {isMovie ? 'title' : 'episode'}.</p>
                <p className="mx-auto mt-1 text-xs leading-5 text-[var(--text-muted)]">
                  This source isn&apos;t available right now. Try another source{isMovie ? '' : ' or episode'}. Aeri resolves playback through its built-in server — you can set a custom video server URL in Settings.
                </p>
                {triedProviders.length > 0 && (
                  <p className="mt-2 text-[11px] text-[var(--text-faint)]">Tried: {triedProviders.join(' • ')}</p>
                )}
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <button
                    onClick={() => {
                      if (effectiveEpisode) {
                        setSourcesLoading(true)
                        setSourcesError(null)
                        resolveSourcesForLanguages(effectiveEpisode, { preferredProvider, preferredLanguage: preferredAudio, languages: ['sub', 'dub'], bypassCache: true, ...matchHints }).then(res => {
                          setSources(res.sources)
                          setTriedProviders(res.tried)
                          if (res.sources.length) {
                            const pref = res.sources.find(s => s.language === preferredAudio)
                            setSelectedSource(pref ?? res.sources[0])
                          }
                          setSourcesLoading(false)
                        }).catch(() => setSourcesLoading(false))
                      }
                    }}
                    className="rounded-full bg-[var(--text)] px-4 py-1.5 text-xs font-semibold text-[var(--on-text)] hover:bg-[color-mix(in_srgb,var(--text)_90%,transparent)]"
                  >
                    Retry
                  </button>
                  <Link to="/settings" className="rounded-full bg-[color-mix(in_srgb,var(--text)_15%,transparent)] px-4 py-1.5 text-xs font-medium text-[var(--text)] backdrop-blur hover:bg-[color-mix(in_srgb,var(--text)_20%,transparent)]">
                    Change source
                  </Link>
                  <Link to={detailNav.to} state={detailNav.state} className="rounded-full bg-[color-mix(in_srgb,var(--text)_15%,transparent)] px-4 py-1.5 text-xs font-medium text-[var(--text)] backdrop-blur hover:bg-[color-mix(in_srgb,var(--text)_20%,transparent)]">
                    {isMovie ? 'Details' : 'Episodes'}
                  </Link>
                </div>
              </div>
            </div>
          )}

          {/* Source error */}
          {sourcesError && !isLoadingVideo && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center bg-[color-mix(in_srgb,var(--bg)_60%,transparent)] p-6 text-center">
              <div className="pointer-events-auto">
                <p className="text-sm font-medium text-[var(--text)]">This source isn&apos;t available right now.</p>
                <p className="mt-1 text-xs text-[var(--text-muted)]">{sourcesError}</p>
                <div className="mt-3 flex justify-center gap-2">
                  <button
                    onClick={() => {
                      if (effectiveEpisode) {
                        setSourcesLoading(true)
                        setSourcesError(null)
                        resolveSourcesForLanguages(effectiveEpisode, { preferredProvider, preferredLanguage: preferredAudio, languages: ['sub', 'dub'], bypassCache: true, ...matchHints }).then(res => {
                          setSources(res.sources)
                          setTriedProviders(res.tried)
                          if (res.sources.length) {
                            const pref = res.sources.find(s => s.language === preferredAudio)
                            setSelectedSource(pref ?? res.sources[0])
                          } else setSourcesError(null)
                          setSourcesLoading(false)
                        }).catch(() => setSourcesLoading(false))
                      }
                    }}
                    className="rounded-full bg-[var(--text)] px-4 py-1.5 text-xs font-semibold text-[var(--on-text)]"
                  >
                    Try another source
                  </button>
                  <Link to="/settings" className="rounded-full bg-[color-mix(in_srgb,var(--text)_15%,transparent)] px-4 py-1.5 text-xs font-medium text-[var(--text)]">Change source</Link>
                </div>
              </div>
            </div>
          )}

          {/* Back-to-detail + S:E live below the player (h1 + Episodes link):
              no overlay chrome over the video — the OS/browser player owns it. */}

          {/* Bottom gradient when no video */}
          {!hasVideo && <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[color-mix(in_srgb,var(--bg)_60%,transparent)] to-transparent" />}
        </div>

        <div className="px-4 py-5 sm:px-0">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-[15px] font-semibold text-[var(--text)]">
                {isMovie ? titles.primary : `${titles.primary} — Episode ${epNum}`}
              </h1>
              {titles.native && <p className="text-xs text-[var(--text-muted)]">{titles.native}</p>}
              {titles.romaji && <p className="text-xs text-[var(--text-faint)]">{titles.romaji}</p>}
              <p className="mt-1 text-xs text-[var(--text-muted)]">{metaLine}</p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Source selector. Values are option INDICES, not URLs: two
                  providers can legitimately hand back the same URL, and a
                  URL-keyed native select silently jumped to the first match —
                  the "picker does nothing" bug. */}
              {sources && sources.length > 0 && (() => {
                // AUDIO IS A SEPARATE CONTROL (owner 2026-10-24): the source
                // picker lists only the streams for the active Sub/Dub side.
                // Its label is the provider alone (plus a REAL quality, never
                // the "auto" placeholder) — the language lives on the toggle.
                const activeLanguage = selectedSource?.language ?? preferredAudio
                const languageSources = sources.filter(s => !s.language || s.language === activeLanguage)
                const selectedIdx = selectedSource ? languageSources.indexOf(selectedSource) : -1
                return (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-[var(--text-faint)]">Source:</span>
                    <FilterSelect
                      value={selectedIdx >= 0 ? String(selectedIdx) : ''}
                      onChange={v => {
                        const s = languageSources[Number(v)]
                        if (s) setSelectedSource(s)
                      }}
                      ariaLabel="Select video source"
                      options={languageSources.map((s, idx) => ({
                        value: String(idx),
                        label: `${s.provider}${s.quality && !/^auto$/i.test(s.quality) ? ` • ${s.quality}` : ''}`,
                        key: `${idx}:${s.provider}:${s.language ?? ''}:${s.quality ?? ''}:${s.url}`,
                      }))}
                    />
                  </div>
                )
              })()}
              {/* SUB/DUB toggle when available */}
              {sources && sources.some(s => s.language) && (
                <div className="flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--text)]/[0.04] p-1">
                  {(['sub','dub'] as const).map(lang => {
                    const hasLang = sources.some(s => s.language === lang)
                    const isActive = selectedSource?.language === lang || (!selectedSource?.language && preferredAudio === lang)
                    return (
                      <button
                        key={lang}
                        type="button"
                        disabled={!hasLang}
                        aria-pressed={isActive}
                        onClick={() => {
                          const match = sources.find(s => s.language === lang)
                          if (match) setSelectedSource(match)
                        }}
                        className={`rounded-full px-3 py-1 text-xs font-medium ${isActive ? 'bg-[var(--text)] text-[var(--on-text)]' : hasLang ? 'text-[var(--text-muted)] hover:text-[var(--text)]' : 'text-[color-mix(in_srgb,var(--text)_20%,transparent)]'}`}
                      >
                        {lang === 'sub' ? 'Sub' : 'Dub'}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Episode navigation — hidden for movies. The middle pill is the
              current episode only: white like the side pills, but a
              non-focusable span with no click handler and no hover. */}
          {!isMovie && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {prev ? (
                <Link to={`/watch/${id}/${prev}`} className={navPillLink}>
                  ← Previous
                </Link>
              ) : (
                <button type="button" disabled aria-label="Previous episode" className={navPill}>
                  ← Previous
                </button>
              )}

              <span aria-current="step" className={`${navPill} cursor-default select-none`}>
                Episode {epNum}
              </span>

              {next ? (
                <Link to={`/watch/${id}/${next}`} className={navPillLink}>
                  Next →
                </Link>
              ) : (
                <button type="button" disabled aria-label="Next episode" className={navPill}>
                  Next →
                </button>
              )}
            </div>
          )}
          {!isMovie && (
            <Link
              to={detailNav.to}
              state={detailNav.state}
              className={`mt-4 ${isMovie ? 'hidden' : 'inline-flex'} rounded-full bg-[color-mix(in_srgb,var(--text)_10%,transparent)] px-4 py-1.5 text-xs font-medium text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--text)_15%,transparent)] sm:hidden`}
            >
              Details
            </Link>
          )}

          {/* Episode list — this entry's own episodes, no season model. */}
          {!isMovie && (
            <div className="mt-6">
              <h2 className="mb-2 text-sm font-semibold text-[var(--text)]">Episodes</h2>
              {immediateEpisodes.length > 0 ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                  {immediateEpisodes.map(ep => {
                    // Current tile uses the owner-chosen white "Now playing"
                    // chip (D124); aria-current stays for semantics. The owner
                    // picked it from alternatives per AGENTS "Suggestions".
                    const isCurrent = ep.number === epNum
                    const realTitle = ep.title
                    const thumb = ep.thumbnail || fallbackThumb
                    const epKey = sanitizedAnimeForWatch?.identity.anilistId ? `anilist:${sanitizedAnimeForWatch.identity.anilistId}-${ep.number}` : `${sanitizedAnimeForWatch?.identity.internalId}-${ep.number}`
                    return (
                      <Link
                        key={epKey}
                        to={`/watch/${id}/${ep.displayNumber}`}
                        className="group/tile relative block aspect-video overflow-hidden rounded-[6px] bg-[var(--surface)] transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-strong)]"
                        aria-label={`Watch Episode ${ep.displayNumber}${realTitle ? ` - ${realTitle}` : ''}`}
                        aria-current={isCurrent ? 'step' : undefined}
                      >
                        {thumb && (
                          <img
                            src={thumb}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            className="absolute inset-0 h-full w-full object-cover opacity-90 transition duration-200 group-hover/tile:opacity-100"
                            onError={(e) => { e.currentTarget.style.display = 'none' }}
                          />
                        )}
                        {/* The artwork dissolves into the page's own base color,
                            not a black scrim — the tile edge disappears into the
                            page in every theme. */}
                        {thumb && (
                          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[var(--bg)] via-[color-mix(in_srgb,var(--bg)_55%,transparent)] to-transparent" />
                        )}
                        {/* Same hover treatment as AnimeCard (D083): base-tinted
                            scrim + 8px frost + centered play glyph. The glyph
                            is 22px — the same 25%-smaller box every card uses
                            (owner 2026-10-25). */}
                        <div className="pointer-events-none absolute inset-0 bg-[color-mix(in_srgb,var(--bg)_50%,transparent)] opacity-0 backdrop-blur-[8px] transition-opacity duration-200 group-hover/tile:opacity-100 group-focus-visible/tile:opacity-100" />
                        {isCurrent && (
                          <span
                            aria-hidden="true"
                            className="pointer-events-none absolute left-2 top-2 z-20 inline-flex items-center rounded-full bg-[var(--text)] px-2 py-1 text-[10px] font-semibold leading-none text-[var(--on-text)] shadow-sm"
                          >
                            Now playing
                          </span>
                        )}
                        <div className="absolute inset-x-0 bottom-0 z-10 p-2 text-left">
                          <p className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold leading-tight text-[var(--text)]">
                            <span>Episode {ep.displayNumber}</span>
                          </p>
                          {realTitle && <p className="mt-0.5 line-clamp-1 text-[10px] leading-tight text-[var(--text-muted)]">{realTitle}</p>}
                        </div>
                        <div className="pointer-events-none absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 text-[var(--text)] opacity-0 transition-opacity duration-200 group-hover/tile:opacity-100 group-focus-visible/tile:opacity-100">
                          <Icon name="play-fill" size={22} />
                        </div>
                        {/* Soft frame — same hairline + glow as cards. */}
                        <div aria-hidden className="frame-soft z-20" />
                      </Link>
                    )
                  })}
                </div>
              ) : (
                <p className="text-sm text-[var(--text-faint)]">No episodes found. Try another anime.</p>
              )}
            </div>
          )}

          <div className="mt-8 max-w-[720px]">
            <h2 className="mb-2 text-sm font-semibold text-[var(--text)]">Synopsis</h2>
            <p className="text-sm leading-6 text-[var(--text-muted)]">{anime.description || 'No description available.'}</p>
          </div>

          {/* Related rails — Home-style landscape anime first, then the
              manga adaptations/relations underneath. Same rail, card size,
              hover treatment and focus behavior as Home; cards open the
              floating detail card over this page (D097). */}
          {anime.identity.anilistId && (
            <WatchRelatedEntries anilistId={anime.identity.anilistId} relations={anime.relations} />
          )}
        </div>
      </div>
    </div>
  )
}

function WatchRelatedEntries({ anilistId, relations }: { anilistId: number; relations: import('../types/anime').Anime['relations'] }) {
  const { entries, loading } = useRelatedEntries(`page-${anilistId}:${anilistId}`, relations, 'ANIME')
  return (
    <div className="mt-10 space-y-8">
      <RelatedRow entries={entries} loading={loading} mediaKind="anime" title="Related Anime" />
      <RelatedRow entries={entries} loading={loading} mediaKind="manga" title="Related Manga" />
    </div>
  )
}
