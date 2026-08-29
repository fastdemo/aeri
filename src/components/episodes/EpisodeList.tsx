import { Link } from 'react-router-dom'
import { useMemo } from 'react'
import type { Anime } from '../../types/anime'
import { useTracking } from '../../contexts/TrackingContext'

export function getEpisodes(anime: Anime) {
  const count = anime.episodes ?? anime.streamingEpisodes?.length ?? 0
  if (count === 0) return []
  // Cap at 100 for perf; larger (One Piece) uses pagination via Watch immediateEpisodes
  const n = Math.min(count, 100)
  return Array.from({ length: n }, (_, i) => {
    const se = anime.streamingEpisodes?.[i]
    const title = se?.title?.trim() || undefined
    const thumbnail = se?.thumbnail ?? undefined
    return {
      number: i + 1,
      title,
      thumbnail,
      duration: anime.duration ?? 24,
    }
  })
}

export function EpisodeList({ anime, seasonNumber = 1 }: { anime: Anime; seasonNumber?: number }) {
  // Explicit episode normalization from displayAnime — rebuilds when anilistId/episodes/streamingEpisodes change
  // Using anilistId in deps ensures stale closures don't retain previous season's count (e.g., 25 vs 12)
  const episodes = useMemo(() => getEpisodes(anime), [
    anime.identity.anilistId,
    anime.identity.internalId,
    anime.episodes,
    anime.streamingEpisodes,
    anime.duration,
  ])
  // Movies must never show an episode list — guarded also by callers but defensive here
  // Placed after hooks to preserve hook order when switching MOVIE <-> TV seasons
  if (anime.format?.toUpperCase() === 'MOVIE') return null
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

  return (
    <div className="space-y-1">
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded bg-white px-2 py-1 text-[11px] font-semibold text-black">S{seasonNumber}</span>
        <span className="text-xs text-white/50">{anime.episodes ?? episodes.length} episodes</span>
      </div>

      <div className="overflow-hidden rounded-lg border border-white/10">
        {episodes.map((ep) => {
          const isWatched = ep.number < progressEp
          const isCurrent = ep.number === progressEp
          const seasonKey = anime.identity.anilistId ? `anilist:${anime.identity.anilistId}` : anime.identity.internalId
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
                {ep.thumbnail ? (
                  <img
                    key={`${seasonKey}-${ep.number}-${ep.thumbnail}`}
                    src={ep.thumbnail}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                    decoding="async"
                    onError={(e) => {
                      const img = e.currentTarget as HTMLImageElement
                      img.style.display = 'none'
                      // Also hide parent's fallback handling if needed
                      const fallback = img.nextElementSibling as HTMLElement | null
                      if (fallback) fallback.style.display = 'grid'
                    }}
                  />
                ) : (
                  <div className="grid h-full w-full place-items-center bg-white/[0.04] text-[10px] font-medium text-white/30">
                    EP {String(ep.number).padStart(2, '0')}
                  </div>
                )}
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
