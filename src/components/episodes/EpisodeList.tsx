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
    title: e.title,
    thumbnail: e.thumbnail,
    duration: e.duration ?? anime.duration ?? 24,
  }))
}

export function EpisodeList({ anime, seasonNumber = 1 }: { anime: Anime; seasonNumber?: number }) {
  const [providerEpisodes, setProviderEpisodes] = useState<VideoEpisode[] | null>(null)
  const [providerDone, setProviderDone] = useState(false)
  const prevIdRef = useRef<string>('')

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
  // Otherwise render immediate episodes from AniList instantly, then enrich with provider when ready
  if (!providerDone && episodes.length === 0) {
    return (
      <div className="space-y-1">
        <div className="mb-2 flex items-center gap-2">
          <span className="rounded bg-white px-2 py-1 text-[11px] font-semibold text-black">S{seasonNumber}</span>
          <span className="text-xs text-white/50">{anime.episodes ? `${anime.episodes} episodes` : 'Loading episodes...'}</span>
        </div>
        <div className="overflow-hidden rounded-lg border border-white/10">
          {[1,2,3,4,5].map(i => (
            <div key={i} className={`flex items-center gap-3 px-3 py-3 ${i!==5 ? 'border-b border-white/5' : ''} animate-pulse`}>
              <span className="w-6 h-4 rounded bg-white/5" />
              <div className="h-12 w-20 rounded bg-white/5" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-3/4 rounded bg-white/5" />
                <div className="h-2 w-1/4 rounded bg-white/5" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }
  const { isAuthenticated, combinedList, updateProgress } = useTracking()
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

  const handleSelect = (epNum: number) => {
    if (isAuthenticated) {
      updateProgress(anime, epNum).catch(() => {})
    }
  }

  if (episodes.length === 0) {
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.02] px-4 py-6 text-center text-xs text-white/40">
        Episode information not available for this title.
      </div>
    )
  }

  const fallbackThumb = anime.coverImage || anime.backdropImage || ''

  return (
    <div className="space-y-1">
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded bg-white px-2 py-1 text-[11px] font-semibold text-black">S{seasonNumber}</span>
        <span className="text-xs text-white/50">{anime.episodes ?? episodes.length} episodes</span>
      </div>

      <div className="overflow-hidden rounded-lg border border-white/10">
        {episodes.map((ep: any) => {
          const isWatched = ep.number < progressEp
          const isCurrent = ep.number === progressEp
          const seasonKey = anime.identity.anilistId ? `anilist:${anime.identity.anilistId}` : anime.identity.internalId
          const thumb = ep.thumbnail || fallbackThumb
          return (
            <Link
              key={`${seasonKey}-${ep.number}`}
              to={`/watch/${anime.identity.internalId}/${ep.number}`}
              onClick={() => handleSelect(ep.number)}
              className={`flex items-center gap-3 px-3 py-3 text-left transition ${
                isCurrent ? 'bg-white/[0.06]' : 'bg-[#18181b] hover:bg-white/[0.04]'
              } ${ep.number !== episodes.length ? 'border-b border-white/5' : ''}`}
            >
              <span className="w-6 text-center text-sm font-medium text-white/70">{String(ep.number).padStart(2, '0')}</span>

              <div className="relative h-12 w-20 shrink-0 overflow-hidden rounded bg-white/5">
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
                  <div className="grid h-full w-full place-items-center bg-white/[0.04] text-[10px] font-medium text-white/30">
                    EP {String(ep.number).padStart(2, '0')}
                  </div>
                )}
                {/* fallback placeholder when img fails */}
                <div className="hidden h-full w-full place-items-center bg-white/[0.04] text-[10px] font-medium text-white/30" style={{display: thumb ? 'none' : 'grid'}}>
                  EP {String(ep.number).padStart(2, '0')}
                </div>
                {isWatched && (
                  <span className="absolute inset-0 grid place-items-center bg-black/40 text-white">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M5 13 9 17 19 7" />
                    </svg>
                  </span>
                )}
                {isCurrent && <span className="absolute bottom-0 left-0 h-0.5 w-full bg-[#e50914]" />}
              </div>

              <div className="min-w-0 flex-1">
                {ep.title ? (
                  <p className={`truncate text-[13px] font-medium ${isCurrent ? 'text-white' : 'text-white/90'}`}>
                    {ep.title}
                  </p>
                ) : (
                  <p className={`text-[13px] font-medium ${isCurrent ? 'text-white' : 'text-white/60'}`}>
                    Episode {ep.number}
                  </p>
                )}
                <p className="text-[11px] text-white/50">{ep.duration}m</p>
              </div>

              <span className="hidden text-xs text-white/40 sm:block">{isWatched ? 'Watched' : ''}</span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
