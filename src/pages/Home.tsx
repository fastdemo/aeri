import { useState, useMemo, useEffect } from 'react'
import { HeroCarousel } from '../components/hero/Hero'
import { AnimeCard } from '../components/cards/AnimeCard'
import { ContentRow } from '../components/rows/ContentRow'
import { DetailModal } from '../components/detail/DetailModal'
import type { Anime } from '../types/anime'
import { useTracking } from '../contexts/TrackingContext'
import { RowSkeleton } from '../components/ui/Skeleton'
import { useTrending, usePopular, useAiring, useNewReleases } from '../hooks/useAnimeMetadata'
import { useLocation } from 'react-router-dom'

function Section({
  title,
  subtitle,
  state,
  onSelect,
  fallback,
}: {
  title: string
  subtitle?: string
  state: { data: Anime[] | null; loading: boolean; error: string | null }
  onSelect: (a: Anime) => void
  fallback?: Anime[]
}) {
  if (state.loading) return <RowSkeleton title={title} />
  if (state.error) {
    if (fallback && fallback.length) {
      return (
        <ContentRow title={title} subtitle={subtitle}>
          {fallback.map((a) => (
            <AnimeCard key={a.identity.internalId} anime={a} onSelect={onSelect} />
          ))}
        </ContentRow>
      )
    }
    return (
      <div className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-amber-200/70">
        {state.error}
      </div>
    )
  }
  const data = state.data && state.data.length ? state.data : fallback ?? []
  if (!data.length) return null
  return (
    <ContentRow title={title} subtitle={subtitle}>
      {data.map((a) => (
        <AnimeCard key={a.identity.internalId} anime={a} onSelect={onSelect} />
      ))}
    </ContentRow>
  )
}

export function Home() {
  const [selected, setSelected] = useState<Anime | null>(null)
  const { isAuthenticated, isAniListAuthenticated, isMALAuthenticated, combinedList, loading, error, authExpired } = useTracking()
  const location = useLocation()

  // Close modal on navigation (fixes navbar Home click while modal open)
  useEffect(() => { setSelected(null) }, [location.pathname, location.hash, location.search])

  const handleSelect = (a: Anime) => setSelected(a)

  const trending = useTrending(12)
  const popular = usePopular(12)
  const airing = useAiring(12)
  const news = useNewReleases(12)

  const continueWatching: Anime[] = useMemo(() => {
    if (isAuthenticated && combinedList) {
      return combinedList
        .filter((e) => e.status === 'watching' || (e.progress > 0 && e.status !== 'completed'))
        .map((e) => e.anime)
        .slice(0, 10)
    }
    return []
  }, [isAuthenticated, combinedList])

  const myList: Anime[] = useMemo(() => {
    if (isAuthenticated && combinedList) return combinedList.map((e) => e.anime).slice(0, 12)
    return []
  }, [isAuthenticated, combinedList])

  const heroes: Anime[] = useMemo(() => {
    const src = trending.data ?? []
    // pick 7 most trending with good backdrops, deduped
    return src.filter((a) => !!a.backdropImage).slice(0, 7)
  }, [trending.data])

  const becauseData = useMemo(() => {
    if (trending.data) {
      const fantasy = trending.data.filter((a) => a.genres.includes('Fantasy') || a.genres.includes('Adventure')).slice(0, 8)
      return fantasy.length >= 4 ? fantasy : trending.data.slice(0, 8)
    }
    return null
  }, [trending.data])

  const becauseState = useMemo(() => {
    if (becauseData) return { data: becauseData, loading: trending.loading, error: trending.error }
    return trending
  }, [becauseData, trending])

  const syncLabel = isAniListAuthenticated && isMALAuthenticated ? 'AniList • MAL' : isAniListAuthenticated ? 'AniList' : isMALAuthenticated ? 'MAL' : ''

  return (
    <div className="pb-10">
      <div className="mx-auto max-w-[1600px] px-0 sm:px-6 lg:px-12">
        <div className="px-0 sm:px-0">
          {trending.loading ? (
            <div className="aspect-[21/9] w-full animate-pulse rounded-xl bg-white/5 lg:min-h-[460px]" />
          ) : trending.error ? (
            <div className="flex aspect-[21/9] w-full items-center justify-center rounded-xl bg-white/[0.03] px-6 text-center lg:min-h-[460px]">
              <div>
                <p className="text-sm text-amber-200/80">{trending.error}</p>
                <p className="mt-1 text-xs text-white/40">Hero unavailable — other rows still work</p>
              </div>
            </div>
          ) : heroes.length ? (
            <HeroCarousel animes={heroes} onMoreInfo={setSelected} />
          ) : (
            <div className="flex aspect-[21/9] w-full items-center justify-center rounded-xl bg-white/[0.03] lg:min-h-[460px]">
              <p className="text-sm text-white/40">No hero available</p>
            </div>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-[1600px] space-y-6 px-0 pt-5 sm:px-6 lg:px-12 lg:space-y-7">
        {isAuthenticated ? (
          loading ? (
            <RowSkeleton title="Continue Watching" />
          ) : continueWatching.length > 0 ? (
            <ContentRow title="Continue Watching" subtitle={`${continueWatching.length} titles${syncLabel ? ` • ${syncLabel}` : ''}`}>
              {continueWatching.map((a) => (
                <AnimeCard key={a.identity.internalId} anime={a} variant="continue" onSelect={handleSelect} />
              ))}
            </ContentRow>
          ) : null
        ) : null}
        {isAuthenticated && !loading && (error || authExpired) && (
          <div className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-white/60">
            {authExpired ? 'Session expired. Reconnect in My List.' : error}
          </div>
        )}

        <Section title="Trending Now" state={trending} onSelect={handleSelect} />
        <Section title="Popular on Aeri" state={popular} onSelect={handleSelect} />
        <Section title="Currently Airing" state={airing} onSelect={handleSelect} />
        <Section title="New Releases" state={news} onSelect={handleSelect} />

        <Section title="Because you watched Frieren" subtitle="Fantasy · Drama" state={becauseState} onSelect={handleSelect} />

        {isAuthenticated ? (
          loading ? (
            <RowSkeleton title="My List" />
          ) : myList.length ? (
            <ContentRow title="My List" subtitle={`${myList.length} titles${syncLabel ? ` • ${syncLabel}` : ''}`}>
              {myList.map((a) => (
                <AnimeCard key={a.identity.internalId} anime={a} onSelect={handleSelect} />
              ))}
            </ContentRow>
          ) : (
            <div className="rounded-lg border border-white/5 bg-white/[0.02] px-4 py-6 text-center text-xs text-white/40">
              Your list is empty. Add titles from Trending or Search.
            </div>
          )
        ) : null}
      </div>

      {selected && <DetailModal anime={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
