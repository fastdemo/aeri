import { Link } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Anime } from '../../types/anime'
import type { VideoEpisode } from '../../providers/video/types'
import { useTracking } from '../../contexts/TrackingContext'
import { normalizeEpisodes } from '../../lib/episodes'
import { resolveEpisodesWithFallback } from '../../providers/video/registry'
import { Icon } from '../ui/Icon'

export function getEpisodes(anime: Anime) {
  const eps = normalizeEpisodes(anime)
  return eps.map(e => ({
    number: e.number,
    displayNumber: e.number,
    title: e.title,
    thumbnail: e.thumbnail,
    duration: e.duration ?? anime.duration ?? 24,
    fieldState: e.fieldState,
  }))
}

export function EpisodeList({ anime, hideHeader }: { anime: Anime; hideHeader?: boolean }) {
  const [providerEpisodes, setProviderEpisodes] = useState<VideoEpisode[] | null>(null)
  const [providerDone, setProviderDone] = useState(false)
  const prevIdRef = useRef<string>('')
  const { isAuthenticated, combinedList, updateProgress } = useTracking()

  useEffect(() => {
    const id = anime.identity.internalId
    prevIdRef.current = id
    setProviderEpisodes(null)
    setProviderDone(false)
    const controller = new AbortController()
    let cancelled = false
    let timeout: any = null
    timeout = setTimeout(() => {
      if (!cancelled) setProviderDone(true)
    }, 1800)
    resolveEpisodesWithFallback(anime, controller.signal)
      .then(res => {
        if (cancelled || controller.signal.aborted) return
        if (res.episodes && res.episodes.length) setProviderEpisodes(res.episodes)
      })
      .catch(() => {})
      .finally(() => {
        clearTimeout(timeout)
        if (!cancelled) setProviderDone(true)
      })
    return () => { cancelled = true; controller.abort(); clearTimeout(timeout) }
  }, [anime.identity.internalId, anime.identity.anilistId, anime.episodes, anime.streamingEpisodes?.length])

  const [localDesc, setLocalDesc] = useState(false)
  const episodes = useMemo(() => {
    const eps = normalizeEpisodes(anime, providerEpisodes)
    const mapped = eps.map(e => ({
      number: e.number,
      displayNumber: e.number,
      title: e.title,
      thumbnail: e.thumbnail,
      duration: e.duration ?? anime.duration ?? 24,
      fieldState: e.fieldState,
    }))
    // Local order toggle (same pattern as manga Chapters): default
    // oldest→newest, no global pref.
    return localDesc ? [...mapped].reverse() : mapped
  }, [
    anime.identity.anilistId,
    anime.identity.internalId,
    anime.episodes,
    anime.streamingEpisodes,
    anime.duration,
    providerEpisodes,
    localDesc,
  ])

  if (anime.format?.toUpperCase() === 'MOVIE') return null

  // Show skeleton only while provider is still loading AND we have no anime data to display yet
  if (!providerDone && episodes.length === 0) {
    return (
      <div className="space-y-1">
        {!hideHeader && (
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h3 className="text-[14px] font-semibold text-[var(--text)]">Episodes</h3>
            <span className="shrink-0 text-[14px] text-[var(--text-faint)]">{anime.episodes && anime.episodes > 0 ? `${anime.episodes} episodes` : 'Loading episodes...'}</span>
          </div>
        )}
        <div className="overflow-hidden rounded-lg border border-[var(--border)]">
          {[1,2,3,4,5].map(i => (
            <div key={i} className={`flex items-center gap-3 bg-[var(--surface)] px-3 py-3 ${i!==5 ? 'border-b border-[var(--border)]' : ''} animate-pulse`}>
              <span className="w-6 h-4 rounded bg-[color-mix(in_srgb,var(--text)_5%,transparent)]" />
              <div className="h-12 w-20 rounded bg-[color-mix(in_srgb,var(--text)_5%,transparent)]" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-3/4 rounded bg-[color-mix(in_srgb,var(--text)_5%,transparent)]" />
                <div className="h-2 w-1/4 rounded bg-[color-mix(in_srgb,var(--text)_5%,transparent)]" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }
  const entry = (() => {
    if (!isAuthenticated || !combinedList) return null
    const malId = anime.identity.malId
    const anilistId = anime.identity.anilistId
    // malId namespaces collide across MAL anime/manga — accept a malId hit
    // only when media kinds agree (EpisodeList is anime-only context).
    const selfManga = ['MANGA', 'NOVEL', 'ONE_SHOT'].includes(anime.format?.toUpperCase() ?? '')
    return combinedList.find((e) => {
      const eManga = ['MANGA', 'NOVEL', 'ONE_SHOT'].includes(e.anime.format?.toUpperCase() ?? '')
      if (malId && e.anime.identity.malId === malId) return eManga === selfManga
      if (anilistId && e.anime.identity.anilistId === anilistId) return eManga === selfManga
      return e.anime.identity.internalId === anime.identity.internalId
    }) ?? null
  })()
  const progressEp = entry?.progress ?? anime.progress?.episode ?? 0

  const handleSelect = (localNum: number) => {
    if (isAuthenticated) {
      updateProgress(anime, localNum).catch(() => {})
    }
  }

  if (episodes.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--text)]/[0.02] px-4 py-6 text-center text-xs text-[var(--text-faint)]">
        Episode information not available for this title.
      </div>
    )
  }

  const fallbackThumb = anime.coverImage || anime.backdropImage || ''

  return (
    <div className="space-y-1">
      {!hideHeader && (
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h3 className="flex min-w-0 flex-1 items-baseline gap-1.5 text-[14px] font-semibold text-[var(--text)]">
            <span className="truncate">Episodes</span>
            <button
              type="button"
              onClick={() => setLocalDesc(v => !v)}
              aria-label={localDesc ? 'Sort episodes oldest first' : 'Sort episodes newest first'}
              title={localDesc ? 'Oldest first (click for newest)' : 'Newest first (click for oldest)'}
              className="grid h-5 w-5 shrink-0 place-items-center rounded text-[var(--text-faint)] transition hover:bg-[color-mix(in_srgb,var(--text)_10%,transparent)] hover:text-[var(--text)]"
            >
              <Icon name="arrow-down-up" size={12} />
            </button>
          </h3>
          <span className="shrink-0 text-[14px] text-[var(--text-faint)]">{anime.episodes && anime.episodes > 0 ? `${anime.episodes} episodes` : `${episodes.length} episodes`}</span>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-[var(--border)]">
        {episodes.map((ep: any, idx: number) => {
          // progress = episodes watched: everything up to and including it is Watched.
          // No next-up highlight: tinting the first 2 rows on desc-sort read
          // as a rendering bug (they ARE the highlight, just relocated).
          const isWatched = progressEp > 0 && ep.number <= progressEp
          const seasonKey = anime.identity.anilistId ? `anilist:${anime.identity.anilistId}` : anime.identity.internalId
          // Per-row state: skeleton ONLY while that field is genuinely still
          // loading (provider fetch pending). A resolved-but-absent field
          // renders the quiet "Episode N" fallback — never a fake thumbnail.
          // providerDone=false + unavailable state can occur on the very
          // first paint (fetch not yet settled); treat as loading then.
          const titleLoading = !providerDone ? (ep.fieldState?.title !== 'resolved') : ep.fieldState?.title === 'loading'
          const thumbLoading = !providerDone ? (ep.fieldState?.thumbnail !== 'resolved') : ep.fieldState?.thumbnail === 'loading'
          const thumb = ep.thumbnail || fallbackThumb
          const showThumbSkeleton = thumbLoading && !ep.thumbnail
          const showRealThumb = !!ep.thumbnail
          const epLabel = `${String(ep.number).padStart(2, '0')}`
          const watchEp = ep.number
          return (
            <Link
              key={`${seasonKey}-${ep.number}`}
              to={`/watch/${anime.identity.internalId}/${watchEp}`}
              onClick={() => handleSelect(ep.number)}
              className={`flex items-center gap-3 bg-[var(--surface)] px-3 py-3 text-left transition hover:bg-[var(--text)]/[0.04] ${idx !== episodes.length - 1 ? 'border-b border-[var(--border)]' : ''}`}
            >
              <span className="w-9 text-center text-sm font-medium text-[var(--text-muted)]">{epLabel}</span>

              <div className="relative h-12 w-20 shrink-0 overflow-hidden rounded bg-[color-mix(in_srgb,var(--text)_5%,transparent)]">
                {showThumbSkeleton ? (
                  <div className="h-full w-full animate-pulse bg-[color-mix(in_srgb,var(--text)_8%,transparent)]" aria-label="Loading episode thumbnail" />
                ) : showRealThumb ? (
                  <img
                    key={`${seasonKey}-${ep.number}-${thumb}`}
                    src={thumb}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                    decoding="async"
                    onError={(e) => {
                      const img = e.currentTarget as HTMLImageElement
                      img.style.display = 'none'
                      const fallback = img.nextElementSibling as HTMLElement | null
                      if (fallback) fallback.style.display = 'grid'
                    }}
                  />
                ) : null}
                {!showRealThumb && !showThumbSkeleton && (
                  <div className="grid h-full w-full place-items-center bg-[var(--text)]/[0.04] text-[10px] font-medium text-[color-mix(in_srgb,var(--text)_30%,transparent)]">
                    {epLabel}
                  </div>
                )}
                {/* fallback placeholder when img fails */}
                <div className="hidden h-full w-full place-items-center bg-[var(--text)]/[0.04] text-[10px] font-medium text-[color-mix(in_srgb,var(--text)_30%,transparent)]" style={{display: showRealThumb ? undefined : 'grid'}}>
                  {epLabel}
                </div>
                {isWatched && (
                  <span className="absolute inset-0 grid place-items-center bg-[color-mix(in_srgb,var(--bg)_40%,transparent)] text-[var(--text)]">
                    <Icon name="check-lg" size={14} />
                  </span>
                )}
              </div>

              <div className="min-w-0 flex-1">
                {ep.title ? (
                  <p className="truncate text-[13px] font-medium text-[var(--text)]">
                    {ep.title}
                  </p>
                ) : titleLoading ? (
                  <p aria-label="Loading episode title">
                    <span className="block h-3 w-3/4 animate-pulse rounded bg-[color-mix(in_srgb,var(--text)_8%,transparent)]" />
                  </p>
                ) : (
                  <p className="text-[13px] font-medium text-[var(--text-muted)]">
                    Episode {ep.number}
                  </p>
                )}
                <p className="text-[11px] text-[var(--text-faint)]">{ep.duration}m</p>
              </div>

              <span className="hidden text-xs text-[var(--text-faint)] sm:block">{isWatched ? 'Watched' : ''}</span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
