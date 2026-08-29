import { useState } from 'react'
import { Hero } from '../components/hero/Hero'
import { AnimeCard } from '../components/cards/AnimeCard'
import { ContentRow } from '../components/rows/ContentRow'
import { DetailModal } from '../components/detail/DetailModal'
import type { Anime } from '../types/anime'
import { becauseYouWatched, continueWatching as mockContinueWatching, currentlyAiring, heroAnime, mockAnime, todaysPicks, trending } from '../data/mockAnime'
import { useAniList } from '../contexts/AniListContext'
import { RowSkeleton } from '../components/ui/Skeleton'

export function Home() {
  const [selected, setSelected] = useState<Anime | null>(null)
  const { isAuthenticated, animeList, loadingList, error, authExpired } = useAniList()

  const handleSelect = (a: Anime) => setSelected(a)

  // Derive Continue Watching and My List from AniList when authenticated, else mock
  const continueWatching: Anime[] = (() => {
    if (isAuthenticated && animeList) {
      // Watching or progress>0
      return animeList
        .filter((e) => e.status === 'watching' || (e.progress > 0 && e.status !== 'completed'))
        .map((e) => e.anime)
        .slice(0, 10)
    }
    return mockContinueWatching
  })()

  const myList: Anime[] = (() => {
    if (isAuthenticated && animeList) return animeList.map((e) => e.anime).slice(0, 12)
    return mockAnime.filter((a) => a.inList)
  })()

  return (
    <div className="pb-10">
      <div className="mx-auto max-w-[1600px] px-0 sm:px-6 lg:px-12">
        <div className="px-0 sm:px-0">
          <Hero anime={heroAnime} onMoreInfo={() => setSelected(heroAnime)} />
        </div>
      </div>

      <div className="mx-auto max-w-[1600px] space-y-6 px-0 pt-5 sm:px-6 lg:px-12 lg:space-y-7">
        {isAuthenticated && loadingList ? (
          <RowSkeleton title="Continue Watching" />
        ) : continueWatching.length > 0 ? (
          <ContentRow title="Continue Watching" subtitle={`${continueWatching.length} titles${isAuthenticated ? ' • AniList' : ''}`}>
            {continueWatching.map((a) => (
              <AnimeCard key={a.identity.internalId} anime={a} variant="continue" onSelect={handleSelect} />
            ))}
          </ContentRow>
        ) : null}
        {isAuthenticated && !loadingList && (error || authExpired) && (
          <div className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-white/60">
            {authExpired ? 'AniList session expired. Reconnect in My List.' : error}
          </div>
        )}

        <ContentRow title="Today's Top Picks for You">
          {todaysPicks.map((a) => (
            <AnimeCard key={a.identity.internalId} anime={a} onSelect={handleSelect} />
          ))}
        </ContentRow>

        <ContentRow title="Because you watched Frieren" subtitle="Fantasy · Drama">
          {becauseYouWatched.map((a) => (
            <AnimeCard key={a.identity.internalId} anime={a} onSelect={handleSelect} />
          ))}
        </ContentRow>

        <ContentRow title="Trending Now">
          {trending.map((a) => (
            <AnimeCard key={a.identity.internalId} anime={a} onSelect={handleSelect} />
          ))}
        </ContentRow>

        <ContentRow title="Currently Airing">
          {currentlyAiring.map((a) => (
            <AnimeCard key={a.identity.internalId} anime={a} onSelect={handleSelect} />
          ))}
        </ContentRow>

        {isAuthenticated && loadingList ? (
          <RowSkeleton title="My List" />
        ) : (
          <ContentRow title="My List" subtitle={isAuthenticated ? `${myList.length} titles • AniList` : undefined}>
            {myList.map((a) => (
              <AnimeCard key={a.identity.internalId} anime={a} onSelect={handleSelect} />
            ))}
          </ContentRow>
        )}
      </div>

      {selected && <DetailModal anime={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
