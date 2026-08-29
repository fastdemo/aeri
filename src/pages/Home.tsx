import { useState, useMemo } from 'react'
import { Hero } from '../components/hero/Hero'
import { AnimeCard } from '../components/cards/AnimeCard'
import { ContentRow } from '../components/rows/ContentRow'
import { DetailModal } from '../components/detail/DetailModal'
import type { Anime } from '../types/anime'
import { heroAnime } from '../data/mockAnime'
import { useAniList } from '../contexts/AniListContext'
import { RowSkeleton } from '../components/ui/Skeleton'
import { useTrending, usePopular, useAiring, useNewReleases } from '../hooks/useAnimeMetadata'

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
  const { isAuthenticated, animeList, loadingList, error, authExpired } = useAniList()

  const handleSelect = (a: Anime) => setSelected(a)

  const trending = useTrending(12)
  const popular = usePopular(12)
  const airing = useAiring(12)
  const news = useNewReleases(12)

  // Derive Continue Watching and My List from AniList when authenticated, else empty (discovery will still show)
  const continueWatching: Anime[] = useMemo(() => {
    if (isAuthenticated && animeList) {
      return animeList
        .filter((e) => e.status === 'watching' || (e.progress > 0 && e.status !== 'completed'))
        .map((e) => e.anime)
        .slice(0, 10)
    }
    return []
  }, [isAuthenticated, animeList])

  const myList: Anime[] = useMemo(() => {
    if (isAuthenticated && animeList) return animeList.map((e) => e.anime).slice(0, 12)
    return []
  }, [isAuthenticated, animeList])

  // Hero: real trending top with banner, fallback to mock hero
  const hero: Anime = trending.data?.[0] ?? heroAnime

  // Fallbacks for public sections when API fails: use trending/popular as fallback via Section prop
  // Because You Watched: simple deterministic - filter trending by Fantasy if available
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

  return (
    <div className="pb-10">
      <div className="mx-auto max-w-[1600px] px-0 sm:px-6 lg:px-12">
        <div className="px-0 sm:px-0">
          {trending.loading ? (
            <div className="aspect-[21/9] w-full animate-pulse rounded-xl bg-white/5 lg:min-h-[460px]" />
          ) : (
            <Hero anime={hero} onMoreInfo={() => setSelected(hero)} />
          )}
        </div>
      </div>

      <div className="mx-auto max-w-[1600px] space-y-6 px-0 pt-5 sm:px-6 lg:px-12 lg:space-y-7">
        {isAuthenticated ? (
          loadingList ? (
            <RowSkeleton title="Continue Watching" />
          ) : continueWatching.length > 0 ? (
            <ContentRow title="Continue Watching" subtitle={`${continueWatching.length} titles • AniList`}>
              {continueWatching.map((a) => (
                <AnimeCard key={a.identity.internalId} anime={a} variant="continue" onSelect={handleSelect} />
              ))}
            </ContentRow>
          ) : null
        ) : null}
        {isAuthenticated && !loadingList && (error || authExpired) && (
          <div className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-white/60">
            {authExpired ? 'AniList session expired. Reconnect in My List.' : error}
          </div>
        )}

        <Section title="Trending Now" state={trending} onSelect={handleSelect} />
        <Section title="Popular on Aeri" state={popular} onSelect={handleSelect} />
        <Section title="Currently Airing" state={airing} onSelect={handleSelect} />
        <Section title="New Releases" state={news} onSelect={handleSelect} />

        {/* Deterministic recommendation placeholder */}
        <Section title="Because you watched Frieren" subtitle="Fantasy · Drama" state={becauseState} onSelect={handleSelect} />

        {isAuthenticated ? (
          loadingList ? (
            <RowSkeleton title="My List" />
          ) : myList.length ? (
            <ContentRow title="My List" subtitle={`${myList.length} titles • AniList`}>
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
