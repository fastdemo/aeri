import { useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { mockAnime } from '../data/mockAnime'
import { useTracking } from '../contexts/TrackingContext'
import { useAnimeDetail } from '../hooks/useAnimeMetadata'

export function Watch() {
  const { id, episode } = useParams<{ id: string; episode: string }>()
  const { isAuthenticated, combinedList, updateProgress } = useTracking()
  const epNum = Number(episode ?? 1)

  const mock = id ? mockAnime.find((a) => a.identity.internalId === id) : null
  const trackingEntry = isAuthenticated && id ? combinedList?.find((e) => e.anime.identity.internalId === id || e.anime.identity.anilistId?.toString() === id || e.anime.identity.malId?.toString() === id || e.anime.identity.internalId.startsWith(`anilist-${id}`) || e.anime.identity.internalId.startsWith(`mal-${id}`)) : null
  const realId = (() => {
    if (!id) return undefined
    if (id.startsWith('anilist-') || id.startsWith('mal-') || /^\d+$/.test(id)) return id
    if (mock?.identity.anilistId) return `anilist-${mock.identity.anilistId}`
    if (trackingEntry?.anime.identity.anilistId) return `anilist-${trackingEntry.anime.identity.anilistId}`
    if (mock?.identity.malId) return `mal-${mock.identity.malId}`
    return id
  })()

  const { data: remote, loading } = useAnimeDetail(realId)
  const anime = trackingEntry?.anime ?? remote ?? mock

  useEffect(() => {
    if (!isAuthenticated || !anime) return
    updateProgress(anime, epNum).catch(() => {})
    try {
      localStorage.setItem(`aeri:progress:${anime.identity.internalId}`, String(epNum))
    } catch {}
  }, [isAuthenticated, anime, epNum, updateProgress])

  if (loading && !anime) {
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

  return (
    <div className="min-h-screen bg-black">
      <div className="mx-auto max-w-[1280px] px-0 sm:px-4 lg:px-6">
        <div className="relative aspect-video w-full overflow-hidden bg-[#0a0a0a] sm:rounded-lg">
          <img
            src={backdrop}
            alt=""
            className="h-full w-full object-cover opacity-80"
            loading="eager"
            decoding="async"
            onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
          />
          <div className="absolute inset-0 grid place-items-center">
            <div className="text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-white text-black">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5.14v13.72L19 12z" />
                </svg>
              </div>
              <p className="mt-3 text-sm font-medium text-white">Episode {epNum}</p>
              <p className="text-xs text-white/60">Authorised source playback • mock</p>
            </div>
          </div>

          <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent px-4 py-3">
            <Link to={`/anime/${id}`} className="text-sm font-medium text-white hover:text-white/80">
              ← {anime.title.english ?? anime.title.romaji}
            </Link>
            <span className="text-xs text-white/60">E{String(epNum).padStart(2, '0')}</span>
          </div>

          <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/60 to-transparent" />
        </div>

        <div className="px-4 py-5 sm:px-0">
          <h1 className="text-[15px] font-semibold text-white">
            {anime.title.english ?? anime.title.romaji} — Episode {epNum}
          </h1>
          <p className="mt-1 text-xs text-white/60">
            {anime.title.romaji} • {anime.year} • {anime.duration}m
          </p>

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
          </div>

          <p className="mt-6 max-w-[720px] text-sm leading-6 text-white/70">{anime.description || 'No description available.'}</p>
        </div>
      </div>
    </div>
  )
}
