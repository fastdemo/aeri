import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { EpisodeList } from '../components/episodes/EpisodeList'
import { useAniList } from '../contexts/AniListContext'
import { useAnimeDetail } from '../hooks/useAnimeMetadata'
import { getSeriesGroup, type AnimeSeriesGroup } from '../services/anilist/series'

export function AnimeDetail() {
  const { id } = useParams<{ id: string }>()
  const { animeList } = useAniList()

  // Try to resolve from user's list first (real, with progress)
  const fromList = id
    ? animeList?.find(
        (e) =>
          e.anime.identity.internalId === id ||
          e.anime.identity.anilistId?.toString() === id ||
          `anilist-${e.anime.identity.anilistId}` === id
      )?.anime
    : null

  const realId = (() => {
    if (!id) return undefined
    if (id.startsWith('anilist-') || /^\d+$/.test(id)) return id
    if (fromList?.identity.anilistId) return `anilist-${fromList.identity.anilistId}`
    // Legacy slug like 'frieren' no longer resolves to mock — show not found instead of fake content
    return id
  })()

  const { data: remote, loading, error } = useAnimeDetail(realId)

  // Prefer real remote data when available, else fromList (no mock fallback in production)
  const anime = remote ?? fromList

  // Series grouping (Netflix-like seasons)
  const [seriesGroup, setSeriesGroup] = useState<AnimeSeriesGroup | null>(null)
  const [selectedSeasonIdx, setSelectedSeasonIdx] = useState<number>(0)

  useEffect(() => {
    if (!anime?.identity.anilistId) {
      setSeriesGroup(null)
      return
    }
    let cancelled = false
    getSeriesGroup(anime.identity.anilistId).then(group => {
      if (cancelled) return
      if (group && group.seasons.length > 1) {
        setSeriesGroup(group)
        // Find current season index
        const idx = group.seasons.findIndex(s => s.identity.anilistId === anime.identity.anilistId)
        setSelectedSeasonIdx(idx >= 0 ? idx : 0)
      } else {
        setSeriesGroup(null)
      }
    }).catch(() => {
      if (!cancelled) setSeriesGroup(null)
    })
    return () => { cancelled = true }
  }, [anime?.identity.anilistId])

  if (loading && !anime) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-16">
        <div className="h-[420px] animate-pulse rounded-xl bg-white/5" />
        <div className="mt-6 h-20 animate-pulse rounded bg-white/5" />
      </div>
    )
  }
  if (error && !anime) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-16 text-center">
        <p className="text-amber-200/80">{error}</p>
        <Link to="/" className="mt-4 inline-block text-sm text-white/60 underline">Back</Link>
      </div>
    )
  }
  if (!anime) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-16 text-center">
        <p className="text-white">Anime not found.</p>
        <Link to="/" className="mt-4 inline-block text-sm text-white/60 underline">Back</Link>
      </div>
    )
  }

  // When seriesGroup exists, the displayed anime is the selected season
  const displayAnime = seriesGroup ? seriesGroup.seasons[selectedSeasonIdx] ?? anime : anime

  const backdrop = displayAnime.backdropImage || displayAnime.coverImage || ''

  return (
    <div className="mx-auto max-w-[1200px] px-4 pb-12 sm:px-6 lg:px-12">
      <div className="relative overflow-hidden rounded-xl bg-[var(--surface)]">
        <div className="relative h-[420px] w-full overflow-hidden bg-[var(--surface-elevated)]">
          <img
            src={backdrop}
            alt=""
            className="h-full w-full object-cover"
            loading="eager"
            decoding="async"
            onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
          />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(0deg, #0e0e10 6%, rgba(14,14,16,0.75) 22%, transparent 58%)' }} />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, rgba(7,7,8,0.85) 0%, transparent 62%)' }} />
          <div className="absolute bottom-0 left-0 p-6 sm:p-8">
            <h1 className="text-2xl font-semibold text-white">{displayAnime.title.english ?? displayAnime.title.romaji}</h1>
            {displayAnime.title.english && displayAnime.title.romaji !== displayAnime.title.english && (
              <p className="text-xs text-white/50">{displayAnime.title.romaji}</p>
            )}
            <p className="mt-1 text-sm text-white/60">
              {[displayAnime.year, displayAnime.format, displayAnime.episodes ? `${displayAnime.episodes} episodes` : null].filter(Boolean).join(' · ')}
              {displayAnime.rating ? ` · ${displayAnime.rating.toFixed(1)}` : ''}
            </p>
            <div className="mt-3 flex gap-2">
              <Link to={`/watch/${displayAnime.identity.internalId}/1`} className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-black">Play</Link>
              <Link to="/" className="rounded-full bg-white/15 px-5 py-2 text-sm font-medium text-white backdrop-blur">Back to Home</Link>
            </div>
          </div>
        </div>
        <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[1.6fr_0.8fr]">
          <div>
            <p className="text-sm leading-6 text-white/70">{displayAnime.description || 'No description available.'}</p>

            {/* Netflix-like season selector */}
            {seriesGroup && seriesGroup.seasons.length > 1 && (
              <div className="mt-6">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-white/50">Season</span>
                  <div className="relative">
                    <select
                      value={String(selectedSeasonIdx)}
                      onChange={e => setSelectedSeasonIdx(Number(e.target.value))}
                      aria-label="Select season"
                      className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 pr-8 text-xs font-medium text-white focus:border-white/20 focus:outline-none"
                    >
                      {seriesGroup.seasons.map((s, idx) => (
                        <option key={s.identity.internalId} value={String(idx)} className="bg-[#141416]">
                          Season {idx + 1} {s.year ? `• ${s.year}` : ''} {s.episodes ? `• ${s.episodes} eps` : ''}
                        </option>
                      ))}
                    </select>
                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-white/40">▼</span>
                  </div>
                  <span className="text-xs text-white/30">{seriesGroup.totalSeasons} seasons • {displayAnime.identity.anilistId}</span>
                </div>
              </div>
            )}

            <div className="mt-6">
              <EpisodeList anime={displayAnime} />
            </div>
          </div>
          <div className="space-y-3 text-xs leading-5">
            <div><span className="text-white/50">Genres: </span><span className="text-white/80">{displayAnime.genres.join(', ') || '—'}</span></div>
            <div><span className="text-white/50">Studios: </span><span className="text-white/80">{displayAnime.studios?.join(', ') || '—'}</span></div>
            <div><span className="text-white/50">Status: </span><span className="text-white/80">{displayAnime.status ?? '—'}</span></div>
            <div><span className="text-white/50">Format: </span><span className="text-white/80">{displayAnime.format ?? '—'}</span></div>
            {displayAnime.identity.malId && <div><span className="text-white/50">MAL ID: </span><span className="text-white/80">{displayAnime.identity.malId}</span></div>}
            {loading && <p className="text-white/40">Loading metadata…</p>}
            {error && <p className="text-amber-200/70">{error}</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
