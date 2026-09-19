import { Link } from 'react-router-dom'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Anime } from '../../types/anime'
import type { VideoEpisode } from '../../providers/video/types'
import { useTracking } from '../../contexts/TrackingContext'
import { normalizeEpisodes } from '../../lib/episodes'
import { resolveEpisodesWithFallback } from '../../providers/video/registry'

export function getEpisodes(anime: Anime) {
  const eps = normalizeEpisodes(anime)
  return eps.map(e => ({
    number: e.number,
    displayNumber: e.number,
    title: e.title,
    thumbnail: e.thumbnail,
    duration: e.duration ?? anime.duration ?? 24,
  }))
}

export function EpisodeList({ anime }: { anime: Anime }) {
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

  const episodes = useMemo(() => {
    const eps = normalizeEpisodes(anime, providerEpisodes)
    return eps.map(e => ({
      number: e.number,
      displayNumber: e.number,
      title: e.title,
      thumbnail: e.thumbnail,
      duration: e.duration ?? anime.duration ?? 24,
    }))
  }, [
    anime.identity.anilistId,
    anime.identity.internalId,
    anime.episodes,
    anime.streamingEpisodes,
    anime.duration,
    providerEpisodes,
  ])

  if (anime.format?.toUpperCase() === 'MOVIE') return null

  // Show skeleton only while provider is still loading AND we have no anime data to display yet
  if (!providerDone && episodes.length === 0) {
    return (
      <div className="space-y-1">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h3 className="text-[14px] font-semibold text-[var(--text)]">Episodes</h3>
          <span className="shrink-0 text-[14px] text-[var(--text-faint)]">{anime.episodes && anime.episodes > 0 ? `${anime.episodes} episodes` : 'Loading episodes...'}</span>
        </div>
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
    return combinedList.find((e) => {
      if (malId && e.anime.identity.malId === malId) return true
      if (anilistId && e.anime.identity.anilistId === anilistId) return true
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
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-[14px] font-semibold text-[var(--text)]">Episodes</h3>
        <span className="shrink-0 text-[14px] text-[var(--text-faint)]">{anime.episodes && anime.episodes > 0 ? `${anime.episodes} episodes` : `${episodes.length} episodes`}</span>
      </div>

      <div className="overflow-hidden rounded-lg border border-[var(--border)]">
        {episodes.map((ep: any) => {
          // progress = episodes watched: everything up to and including it is Watched
          const isWatched = progressEp > 0 && ep.number <= progressEp
          // next-up highlight only (no progress bar — it read as an error state)
          const isCurrent = ep.number === progressEp + 1 || (progressEp === 0 && ep.number === 1)
          const seasonKey = anime.identity.anilistId ? `anilist:${anime.identity.anilistId}` : anime.identity.internalId
          const thumb = ep.thumbnail || fallbackThumb
          const epLabel = `${String(ep.number).padStart(2, '0')}`
          const watchEp = ep.number
          return (
            <Link
              key={`${seasonKey}-${ep.number}`}
              to={`/watch/${anime.identity.internalId}/${watchEp}`}
              onClick={() => handleSelect(ep.number)}
              className={`flex items-center gap-3 bg-[var(--surface)] px-3 py-3 text-left transition hover:bg-[var(--text)]/[0.04] ${
                isCurrent ? 'bg-[var(--text)]/[0.06]' : ''
              } ${ep.number !== episodes.length ? 'border-b border-[var(--border)]' : ''}`}
            >
              <span className="w-9 text-center text-sm font-medium text-[var(--text-muted)]">{epLabel}</span>

              <div className="relative h-12 w-20 shrink-0 overflow-hidden rounded bg-[color-mix(in_srgb,var(--text)_5%,transparent)]">
                {thumb ? (
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
                {!thumb && (
                  <div className="grid h-full w-full place-items-center bg-[var(--text)]/[0.04] text-[10px] font-medium text-[color-mix(in_srgb,var(--text)_30%,transparent)]">
                    {epLabel}
                  </div>
                )}
                {/* fallback placeholder when img fails */}
                <div className="hidden h-full w-full place-items-center bg-[var(--text)]/[0.04] text-[10px] font-medium text-[color-mix(in_srgb,var(--text)_30%,transparent)]" style={{display: thumb ? 'none' : 'grid'}}>
                  {epLabel}
                </div>
                {isWatched && (
                  <span className="absolute inset-0 grid place-items-center bg-[color-mix(in_srgb,var(--bg)_40%,transparent)] text-[var(--text)]">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M5 13 9 17 19 7" />
                    </svg>
                  </span>
                )}
              </div>

              <div className="min-w-0 flex-1">
                {ep.title ? (
                  <p className={`truncate text-[13px] font-medium ${isCurrent ? 'text-[var(--text)]' : 'text-[var(--text)]'}`}>
                    {ep.title}
                  </p>
                ) : (
                  <p className={`text-[13px] font-medium ${isCurrent ? 'text-[var(--text)]' : 'text-[var(--text-muted)]'}`}>
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
