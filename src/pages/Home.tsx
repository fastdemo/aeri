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
import { getFranchiseTitle } from '../lib/titles'
import { getRecommendations } from '../recommendations/engine'

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

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// dedup pool by internalId
function dedup(animes: Anime[]): Anime[] {
  const m = new Map<string, Anime>()
  for (const a of animes) m.set(a.identity.internalId, a)
  return Array.from(m.values())
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
    if (!isAuthenticated || !combinedList) return []
    const filtered = combinedList
      .map((e, idx) => ({ e, idx }))
      .filter(({ e }) => e.status === 'watching' || (e.progress > 0 && e.status !== 'completed'))
    if (!filtered.length) return []

    // Netflix-style: merge same franchise, keep only the later season the user is watching
    const groups = new Map<string, { entries: typeof filtered; firstIdx: number }>()
    for (const item of filtered) {
      const anime = item.e.anime
      const isTv = anime.format === 'TV' || anime.format === 'TV_SHORT' || !anime.format
      let key: string
      if (isTv) {
        const raw = anime.title.english?.trim() || anime.title.romaji?.trim() || ''
        const franchise = raw ? getFranchiseTitle(raw) : ''
        // normalize: lower + single spaces
        key = franchise
          ? franchise.toLowerCase().replace(/\s+/g, ' ').trim()
          : `id:${anime.identity.internalId}`
      } else {
        key = `id:${anime.identity.internalId}`
      }
      const g = groups.get(key)
      if (!g) groups.set(key, { entries: [item], firstIdx: item.idx })
      else {
        g.entries.push(item)
        if (item.idx < g.firstIdx) g.firstIdx = item.idx
      }
    }

    const winners: { anime: Anime; sortIdx: number }[] = []
    for (const [, g] of groups) {
      if (g.entries.length === 1) {
        winners.push({ anime: g.entries[0]!.e.anime, sortIdx: g.firstIdx })
      } else {
        // pick later season: higher year wins, then higher absolute progress, then watching status
        const sorted = [...g.entries].sort((a, b) => {
          const yearA = a.e.anime.year ?? 0
          const yearB = b.e.anime.year ?? 0
          if (yearB !== yearA) return yearB - yearA
          if (b.e.progress !== a.e.progress) return b.e.progress - a.e.progress
          const score = (x: (typeof filtered)[number]) => (x.e.status === 'watching' ? 2 : x.e.status === 'completed' ? 0 : 1)
          return score(b) - score(a)
        })
        const winner = sorted[0]!
        // order by winner's original position to keep recency (most recently updated seasons first)
        winners.push({ anime: winner.e.anime, sortIdx: winner.idx })
      }
    }

    winners.sort((a, b) => a.sortIdx - b.sortIdx)
    return winners.map((w) => w.anime).slice(0, 10)
  }, [isAuthenticated, combinedList])

  const myList: Anime[] = useMemo(() => {
    if (isAuthenticated && combinedList) return combinedList.map((e) => e.anime).slice(0, 12)
    return []
  }, [isAuthenticated, combinedList])

  // Hero: choose different shows on each refresh from a pooled shuffle (not fixed slice)
  const heroes: Anime[] = useMemo(() => {
    const pool = dedup([
      ...(trending.data ?? []),
      ...(popular.data ?? []),
      ...(airing.data ?? []),
      ...(news.data ?? []),
    ]).filter(a => !!a.backdropImage)
    if (!pool.length) return []
    // shuffle with fresh randomness per mount (refresh) — deterministic enough but varying
    const shuffled = shuffle(pool)
    const picked = shuffled.slice(0, 7)
    // ensure at least 3, fallback to trending head if shuffle gave too few
    if (picked.length >= 3) return picked
    return pool.slice(0, 7)
  }, [trending.data, popular.data, airing.data, news.data])

  // Pool for derived categories and recommendations (deduplicated)
  const allPool = useMemo(() => {
    return dedup([
      ...(trending.data ?? []),
      ...(popular.data ?? []),
      ...(airing.data ?? []),
      ...(news.data ?? []),
    ])
  }, [trending.data, popular.data, airing.data, news.data])

  // --- Personalized: "Because you watched X" ---
  const becauseContext = useMemo(() => {
    if (!isAuthenticated || !combinedList || !combinedList.length) return null
    // pick most meaningful completed/watching as reference
    const candidates = [...combinedList]
    // prefer completed with highest score, then watching with highest progress, then any with rating
    const completed = candidates.filter(e => e.status === 'completed')
    const sortedCompleted = [...completed].sort((a,b) => (b.score ?? 0) - (a.score ?? 0) || (b.anime.rating ?? 0) - (a.anime.rating ?? 0))
    let ref = sortedCompleted[0]
    if (!ref) {
      const watching = candidates.filter(e => e.status === 'watching')
      const sortedWatching = [...watching].sort((a,b) => b.progress - a.progress || (b.anime.rating ?? 0) - (a.anime.rating ?? 0))
      ref = sortedWatching[0]
    }
    if (!ref) {
      // fallback: highest rated in list
      const sortedAll = [...candidates].sort((a,b) => (b.anime.rating ?? 0) - (a.anime.rating ?? 0))
      ref = sortedAll[0]
    }
    if (!ref || !ref.anime.genres?.length) return null
    return ref
  }, [isAuthenticated, combinedList])

  const becauseRecommendations = useMemo(() => {
    if (!becauseContext || !allPool.length) return null
    const ref = becauseContext.anime
    const refGenres = ref.genres
    if (!refGenres.length) return null
    // pool excluding already in list and the ref itself
    const listIds = new Set((combinedList ?? []).map(e => e.anime.identity.internalId))
    listIds.add(ref.identity.internalId)
    const candidates = allPool.filter(a => !listIds.has(a.identity.internalId))
    if (!candidates.length) return null
    const recs = getRecommendations(refGenres, candidates)
    return recs.slice(0, 8)
  }, [becauseContext, allPool, combinedList])

  // Derived categories from pool (filtered, not additional fetches)
  const derived = useMemo(() => {
    if (!allPool.length) return null
    const pool = allPool
    const highlyRated = [...pool].filter(a => (a.rating ?? 0) >= 8.0).sort((a,b) => (b.rating ?? 0) - (a.rating ?? 0)).slice(0, 8)
    const shortSeries = pool.filter(a => a.episodes != null && a.episodes >= 1 && a.episodes <= 12).slice(0, 8)
    // ensure shuffling for variety on each refresh for these picks
    const shortShuffled = shortSeries.length ? shuffle(shortSeries).slice(0, 8) : []
    const actionPicks = shuffle(pool.filter(a => a.genres.includes('Action'))).slice(0, 8)
    const romancePicks = shuffle(pool.filter(a => a.genres.includes('Romance'))).slice(0, 8)
    const hiddenGems = shuffle(pool.filter(a => (a.rating ?? 0) >= 7.8 && (a.popularity ?? 0) < 60000 && (a.popularity ?? 0) > 0)).slice(0, 8)
    // Top Picks for You — based on user's top genres across list
    let topPicks: Anime[] | null = null
    let topGenres: string[] = []
    if (isAuthenticated && combinedList && combinedList.length) {
      const counts = new Map<string, number>()
      for (const e of combinedList) for (const g of e.anime.genres) counts.set(g, (counts.get(g) ?? 0) + 1)
      topGenres = Array.from(counts.entries()).sort((a,b) => b[1]-a[1]).slice(0,3).map(([g])=>g)
      if (topGenres.length) {
        const listIds = new Set(combinedList.map(e => e.anime.identity.internalId))
        const cands = pool.filter(a => !listIds.has(a.identity.internalId))
        topPicks = getRecommendations(topGenres, cands).slice(0, 8)
      }
    }
    return { highlyRated, shortShuffled, actionPicks, romancePicks, hiddenGems, topPicks, topGenres }
  }, [allPool, isAuthenticated, combinedList])

  // Build dynamic middle sections (shuffled order each refresh, My List fixed bottom)
  const middleSections = useMemo(() => {
    const sections: Array<{ key: string; title: string; subtitle?: string; data: Anime[] }> = []
    // Only push if data exists and not loading — keep checks light, Section handles empty
    if (!trending.loading && trending.data && trending.data.length) sections.push({ key: 'trending', title: 'Trending Now', data: trending.data.slice(0, 12) })
    if (!popular.loading && popular.data && popular.data.length) sections.push({ key: 'popular', title: 'Popular on Aeri', data: popular.data.slice(0, 12) })
    if (!airing.loading && airing.data && airing.data.length) sections.push({ key: 'airing', title: 'Currently Airing', data: airing.data.slice(0, 12) })
    if (!news.loading && news.data && news.data.length) sections.push({ key: 'new', title: 'New Releases', data: news.data.slice(0, 12) })
    if (derived?.highlyRated?.length) sections.push({ key: 'highly', title: 'Highly Rated', subtitle: 'Critics love these', data: derived.highlyRated })
    if (derived?.shortShuffled?.length) sections.push({ key: 'short', title: 'Short & Sweet', subtitle: 'Under 12 episodes', data: derived.shortShuffled })
    if (derived?.actionPicks?.length) sections.push({ key: 'action', title: 'Action Picks', subtitle: 'For adrenaline', data: derived.actionPicks })
    if (derived?.romancePicks?.length) sections.push({ key: 'romance', title: 'Romance Picks', subtitle: 'Heartfelt stories', data: derived.romancePicks })
    if (derived?.hiddenGems?.length) sections.push({ key: 'gems', title: 'Hidden Gems', subtitle: 'Low-key favorites', data: derived.hiddenGems })
    // personalized sections near bottom but before My List — keep them together
    const personalized: typeof sections = []
    if (derived?.topPicks?.length) personalized.push({ key: 'toppicks', title: 'Top Picks for You', subtitle: derived.topGenres?.length ? derived.topGenres.join(' · ') : undefined, data: derived.topPicks })
    if (becauseContext && becauseRecommendations?.length) {
      const refTitle = becauseContext.anime.title.english?.trim() || becauseContext.anime.title.romaji
      const subtitle = becauseContext.anime.genres.slice(0,2).join(' · ') || undefined
      personalized.push({ key: 'because', title: `Because you watched ${refTitle}`, subtitle, data: becauseRecommendations })
    }
    // Shuffle middle (non-personalized) sections for variety, keep Trending Now first if exists
    const trendingFirst = sections.find(s => s.key === 'trending')
    const rest = sections.filter(s => s.key !== 'trending')
    const shuffledRest = rest.length ? shuffle(rest) : []
    const ordered = [...(trendingFirst ? [trendingFirst] : []), ...shuffledRest, ...personalized]
    return ordered
  }, [trending, popular, airing, news, derived, becauseContext, becauseRecommendations])

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
        {/* Continue — only when signed in (spec logged-out: must not appear at all) */}
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

        {/* Dynamic home feed — Trending first, rest shuffled, personalized before My List */}
        {middleSections.map(s => (
          <ContentRow key={s.key} title={s.title} subtitle={s.subtitle}>
            {s.data.map(a => (
              <AnimeCard key={a.identity.internalId} anime={a} onSelect={handleSelect} />
            ))}
          </ContentRow>
        ))}

        {/* Fallback static sections if derived not ready yet (keep for loading parity) */}
        {middleSections.length === 0 && (
          <>
            <Section title="Trending Now" state={trending} onSelect={handleSelect} />
            <Section title="Popular on Aeri" state={popular} onSelect={handleSelect} />
            <Section title="Currently Airing" state={airing} onSelect={handleSelect} />
            <Section title="New Releases" state={news} onSelect={handleSelect} />
          </>
        )}

        {/* My List permanently at bottom */}
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
