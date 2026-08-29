import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { EpisodeList } from '../components/episodes/EpisodeList'
import { useAniList } from '../contexts/AniListContext'
import { useAnimeDetail } from '../hooks/useAnimeMetadata'
import { getSeriesGroup, type AnimeSeriesGroup } from '../services/anilist/series'
import { getTitleHierarchy } from '../lib/titles'

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

  // Series grouping — abortable, selectedSeason === displayAnime invariant
  // All hooks must be before any early return (Rules of Hooks)
  const [seriesGroup, setSeriesGroup] = useState<AnimeSeriesGroup | null>(null)
  const [selectedSeasonIdx, setSelectedSeasonIdx] = useState<number>(0)
  const requestIdRef = useRef(0)
  const seriesGroupRef = useRef<AnimeSeriesGroup | null>(null)
  seriesGroupRef.current = seriesGroup
  const selectedIdxRef = useRef(0)
  selectedIdxRef.current = selectedSeasonIdx

  // Effective group guards against stale seriesGroup when anime switches franchise before new fetch resolves.
  const effectiveGroup = useMemo(() => {
    if (!seriesGroup || seriesGroup.seasons.length <= 1) return null
    if (!anime?.identity.anilistId) return seriesGroup
    const contains = seriesGroup.seasons.some(s => s.identity.anilistId === anime.identity.anilistId)
    return contains ? seriesGroup : null
  }, [seriesGroup, anime?.identity.anilistId])
  const displayAnime = useMemo(() => {
    if (!anime) return null as any
    if (effectiveGroup) {
      return effectiveGroup.seasons[selectedSeasonIdx] ?? anime
    }
    return anime
  }, [effectiveGroup, selectedSeasonIdx, anime])
  const titles = useMemo(() => {
    if (!displayAnime) return { primary: '' } as any
    return getTitleHierarchy(displayAnime, effectiveGroup)
  }, [displayAnime, effectiveGroup])
  const backdrop = displayAnime ? (displayAnime.backdropImage || displayAnime.coverImage || '') : ''
  const displayKey = displayAnime ? (displayAnime.identity.anilistId ? `anilist:${displayAnime.identity.anilistId}` : displayAnime.identity.internalId) : 'none'
  const isMovie = displayAnime ? displayAnime.format?.toUpperCase() === 'MOVIE' : false

  useEffect(() => {
    if (!anime?.identity.anilistId) {
      setSeriesGroup(null)
      setSelectedSeasonIdx(0)
      return
    }
    const currentAnilistId = anime.identity.anilistId
    const curGroup = seriesGroupRef.current
    if (curGroup) {
      const idxInCurrent = curGroup.seasons.findIndex(s => s.identity.anilistId === currentAnilistId)
      if (idxInCurrent >= 0 && idxInCurrent !== selectedIdxRef.current) {
        setSelectedSeasonIdx(idxInCurrent)
      }
    }
    const reqId = ++requestIdRef.current
    const controller = new AbortController()
    getSeriesGroup(currentAnilistId, { signal: controller.signal })
      .then(group => {
        if (controller.signal.aborted || reqId !== requestIdRef.current) return
        if (group && group.seasons.length > 1) {
          setSeriesGroup(group)
          const idx = group.seasons.findIndex(s => s.identity.anilistId === currentAnilistId)
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
  if (!anime || !displayAnime) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-16 text-center">
        <p className="text-white">Anime not found.</p>
        <Link to="/" className="mt-4 inline-block text-sm text-white/60 underline">Back</Link>
      </div>
    )
  }

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
            <h1 className="text-2xl font-semibold text-white">{titles.primary}</h1>
            {titles.native && (
              <p className="text-xs text-white/60">{titles.native}</p>
            )}
            {titles.romaji && (
              <p className="text-xs text-white/50">{titles.romaji}</p>
            )}
            <p className="mt-1 text-sm text-white/60">
              {[displayAnime.year, displayAnime.format, !isMovie && displayAnime.episodes ? `${displayAnime.episodes} episodes` : null].filter(Boolean).join(' · ')}
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

            {/* Netflix-like season selector — uses effectiveGroup to avoid stale franchise */}
            {!isMovie && effectiveGroup && (
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
                  <span className="text-xs text-white/30">{effectiveGroup.totalSeasons} seasons • {displayAnime.identity.anilistId}</span>
                </div>
              </div>
            )}

            {!isMovie && (
              <div className="mt-6">
                <EpisodeList key={displayKey} anime={displayAnime} seasonNumber={selectedSeasonIdx + 1} />
              </div>
            )}
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
