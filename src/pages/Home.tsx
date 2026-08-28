import { useState } from 'react'
import { Hero } from '../components/hero/Hero'
import { AnimeCard } from '../components/cards/AnimeCard'
import { ContentRow } from '../components/rows/ContentRow'
import { DetailModal } from '../components/detail/DetailModal'
import type { Anime } from '../types/anime'
import { becauseYouWatched, continueWatching, currentlyAiring, heroAnime, mockAnime, todaysPicks, trending } from '../data/mockAnime'

export function Home() {
  const [selected, setSelected] = useState<Anime | null>(null)

  const handleSelect = (a: Anime) => setSelected(a)

  return (
    <div className="pb-10">
      <div className="mx-auto max-w-[1600px] px-0 sm:px-6 lg:px-12">
        <div className="px-0 sm:px-0">
          <Hero anime={heroAnime} onMoreInfo={() => setSelected(heroAnime)} />
        </div>
      </div>

      <div className="mx-auto max-w-[1600px] space-y-6 px-0 pt-5 sm:px-6 lg:px-12 lg:space-y-7">
        {continueWatching.length > 0 && (
          <ContentRow title="Continue Watching" subtitle={`${continueWatching.length} titles`}>
            {continueWatching.map((a) => (
              <AnimeCard key={a.identity.internalId} anime={a} variant="continue" onSelect={handleSelect} />
            ))}
          </ContentRow>
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

        <ContentRow title="My List">
          {mockAnime.filter((a) => a.inList).map((a) => (
            <AnimeCard key={a.identity.internalId} anime={a} onSelect={handleSelect} />
          ))}
        </ContentRow>
      </div>

      {selected && <DetailModal anime={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
