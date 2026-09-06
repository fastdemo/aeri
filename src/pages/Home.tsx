import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
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

// Stable per-mount ordering: same ids → same order for the whole session, so
// background refetches (tracking reloads, enrichment batches) never visibly
// reshuffle the feed. A full reload re-shuffles, preserving variety.
function useStableOrder() {
  const cache = useRef(new Map<string, string[]>())
  return useCallback((key: string, items: Anime[]): Anime[] => {
    const ids = items.map((a) => a.identity.internalId)
    const sig = `${key}|${ids.join(',')}`
    let perm = cache.current.get(sig)
    if (!perm) {
      perm = shuffle(ids)
      if (cache.current.size > 80) cache.current.clear()
      cache.current.set(sig, perm)
    }
    const byId = new Map(items.map((a) => [a.identity.internalId, a] as const))
    const out: Anime[] = []
    for (const id of perm) {
      const a = byId.get(id)
      if (a) out.push(a)
    }
    return out
  }, [])
}

function currentSeasonLabel(): string {
  const d = new Date()
  const m = d.getMonth()
  const season = m <= 2 ? 'Winter' : m <= 5 ? 'Spring' : m <= 8 ? 'Summer' : 'Fall'
  return `${season} ${d.getFullYear()}`
}

// dedup pool by internalId
function dedup(animes: Anime[]): Anime[] {
  const m = new Map<string, Anime>()
  for (const a of animes) m.set(a.identity.internalId, a)
  return Array.from(m.values())
}

// sample varied without immediately duplicating recently used titles
function sampleVaried(pool: Anime[], count: number, used?: Set<string>, key?: string, order?: (key: string, items: Anime[]) => Anime[]): Anime[] {
  if (!pool.length) return []
  const available = used ? pool.filter(a => !used.has(a.identity.internalId)) : pool
  const source = available.length >= Math.min(count, 4) ? available : pool
  const ordered = order ? order(key ?? 'sample', source) : shuffle(source)
  return ordered.slice(0, count)
}

// Ensure a row always has `min` items — fills from fallback pool if the primary pool is short
// (e.g. Hidden Gems only has 5 candidates in the current 96-item allPool). Avoids the "5 cards then big empty" look.
function ensureMinRow(primary: Anime[], fallback: Anime[], min: number, used?: Set<string>, key?: string, order?: (key: string, items: Anime[]) => Anime[]): Anime[] {
  if (!primary.length && !fallback.length) return []
  const ord = (suffix: string, arr: Anime[]) => (order ? order(`${key ?? 'row'}:${suffix}`, arr) : shuffle(arr))
  // Prefer primary, avoid `used` when possible
  let result = sampleVaried(primary, Math.min(min, primary.length), used, `${key ?? 'row'}:main`, order)
  if (result.length >= min) return result
  const seen = new Set<string>(result.map(a => a.identity.internalId))
  if (used) for (const id of used) seen.add(id)
  // First fill from fallback (allPool) excluding seen
  const candidates = ord('fill', fallback.filter(a => !seen.has(a.identity.internalId)))
  const need = min - result.length
  result = [...result, ...candidates.slice(0, need)]
  if (result.length >= min) return result
  // Still short (fallback also exhausted) — allow cross-row duplicates, just avoid intra-row duplicates
  const seenResult = new Set(result.map(a => a.identity.internalId))
  const extra = ord('extra', primary.filter(a => !seenResult.has(a.identity.internalId)))
  result = [...result, ...extra.slice(0, min - result.length)]
  if (result.length >= min) return result
  const extra2 = ord('extra2', fallback.filter(a => !seenResult.has(a.identity.internalId)))
  result = [...result, ...extra2.slice(0, min - result.length)]
  // Last resort: pad with already-used fallback (duplicates across rows) to hit min for visual fullness
  if (result.length < min) {
    const filler = ord('pad', fallback).slice(0, min - result.length)
    result = [...result, ...filler]
  }
  return result.slice(0, min)
}

export function Home() {
  const [selected, setSelected] = useState<Anime | null>(null)
  const mountSalt = useRef(Math.floor(Math.random() * 1e9))
  const { isAuthenticated, trackingProvider, combinedList, loading, error, authExpired } = useTracking()
  const location = useLocation()

  // Close modal on navigation (fixes navbar Home click while modal open)
  useEffect(() => { setSelected(null) }, [location.pathname, location.hash, location.search])

  const handleSelect = (a: Anime) => setSelected(a)

  // Fetch larger pools so varied sampling has room to vary
  const trending = useTrending(24)
  const popular = usePopular(24)
  const airing = useAiring(24)
  const news = useNewReleases(24)

  const continueWatching: Anime[] = useMemo(() => {
    if (!isAuthenticated || !combinedList) return []
    // Strict: only status=watching (works for both trackers — statuses are
    // normalized at the provider boundary). No title cap: show everything.
    const filtered = combinedList
      .map((e, idx) => ({ e, idx }))
      .filter(({ e }) => e.status === 'watching')
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
    return winners.map((w) => w.anime)
  }, [isAuthenticated, combinedList])

  const myList: Anime[] = useMemo(() => {
    if (isAuthenticated && combinedList) return combinedList.map((e) => e.anime)
    return []
  }, [isAuthenticated, combinedList])

  const stableOrder = useStableOrder()

  // Hero: only popular and/or currently airing. Order is stable per mount
  // (fresh shuffle each full load, never mid-session) so the hero never jumps.
  const heroes: Anime[] = useMemo(() => {
    const pool = dedup([
      ...(popular.data ?? []),
      ...(airing.data ?? []),
    ]).filter(a => !!a.backdropImage)
    if (!pool.length) {
      // fallback to trending+popular+airing if too few popular/airing (rare)
      const fallback = dedup([
        ...(trending.data ?? []),
        ...(popular.data ?? []),
        ...(airing.data ?? []),
      ]).filter(a => !!a.backdropImage)
      if (!fallback.length) return []
      return stableOrder('heroes', fallback).slice(0, 7)
    }
    return stableOrder('heroes', pool).slice(0, 7)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popular.data, airing.data, trending.data])

  // Pool for derived categories and recommendations (deduplicated) — use larger pool for variety
  const allPool = useMemo(() => {
    return dedup([
      ...(trending.data ?? []),
      ...(popular.data ?? []),
      ...(airing.data ?? []),
      ...(news.data ?? []),
    ])
  }, [trending.data, popular.data, airing.data, news.data])

  // --- Personalized: "Because you watched X" — real history, weighted random ---
  const becauseContext = useMemo(() => {
    if (!isAuthenticated || !combinedList || !combinedList.length || !allPool.length) return null
    // Build suitable candidates: those with genres and at least a few recommendable titles
    const listIds = new Set(combinedList.map(e => e.anime.identity.internalId))
    const poolIds = new Set(allPool.map(a => a.identity.internalId))
    // Filter to entries that could actually generate recommendations (at least 5 candidates share a genre and not in list)
    const scored = combinedList
      .filter(e => e.anime.genres?.length)
      .map(e => {
        const statusWeight = e.status === 'watching' ? 4 : e.status === 'completed' ? 3 : e.status === 'planned' ? 0.5 : 1
        const scoreWeight = ((e.score ?? 5) / 10) + 0.6 // 0.6..1.6
        const ratingWeight = ((e.anime.rating ?? 7) / 10) + 0.6
        const popularityWeight = e.anime.popularity ? Math.min(1.2, Math.log10(e.anime.popularity + 10) / 5) + 0.5 : 0.8
        // How much useful recommendation data exists for this title (genre overlap with pool not in list)
        const overlapCount = allPool.filter(a => !listIds.has(a.identity.internalId) && a.genres.some(g => e.anime.genres.includes(g))).length
        const recencyWeight = e.status === 'watching' ? 1.1 + Math.min(0.4, e.progress / 24) : 1
        const availabilityWeight = overlapCount >= 8 ? 1.3 : overlapCount >= 4 ? 1.0 : overlapCount >= 2 ? 0.6 : 0.3
        // Slight boost for recently relevant: if anime is in poolIds (trending/popular) it is more recognizable
        const poolBoost = poolIds.has(e.anime.identity.internalId) ? 1.1 : 1
        const weight = statusWeight * scoreWeight * ratingWeight * popularityWeight * recencyWeight * availabilityWeight * poolBoost
        return { entry: e, weight, overlapCount }
      })
      .filter(x => x.overlapCount >= 2) // need at least 2 to make a row
      .sort((a,b) => b.weight - a.weight)

    if (!scored.length) return null
    // Take top 10 most suitable, then pick one — stable per mount (variety
    // across loads, never reshuffles mid-session on background refetches).
    const top = scored.slice(0, 10)
    const ordered = stableOrder('because-ctx', top.map((x) => x.entry.anime))
    const firstId = ordered[0]?.identity.internalId
    return top.find((x) => x.entry.anime.identity.internalId === firstId)?.entry ?? top[0]?.entry ?? null
  }, [isAuthenticated, combinedList, allPool, stableOrder])

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
    // take top 16 then stable sample 8 (relevance kept, order fixed per mount)
    const topSlice = recs.slice(0, 16)
    return stableOrder('because', topSlice).slice(0, 8)
  }, [becauseContext, allPool, combinedList, stableOrder])

  // Derived categories from pool (filtered, not additional fetches) — varied pools, always ≥10 for visual fullness
  const derived = useMemo(() => {
    if (!allPool.length) return null
    const pool = allPool
    // For each derived, take a larger candidate set then shuffle sample, to keep relevance but allow variation
    // Targets are 10+ with fallback filling so rows never look cut off
    const highlyRatedBase = [...pool].filter(a => (a.rating ?? 0) >= 8.0).sort((a,b) => (b.rating ?? 0) - (a.rating ?? 0)).slice(0, 24)
    const highlyRated = highlyRatedBase.length ? ensureMinRow(sampleVaried(highlyRatedBase, Math.min(16, highlyRatedBase.length), undefined, 'highly', stableOrder), pool, 10, undefined, 'highly', stableOrder) : []

    const shortBase = pool.filter(a => a.episodes != null && a.episodes >= 1 && a.episodes <= 12)
    const shortShuffled = shortBase.length ? ensureMinRow(sampleVaried(shortBase, Math.min(16, shortBase.length), undefined, 'short', stableOrder), pool, 10, undefined, 'short', stableOrder) : []

    const actionBase = pool.filter(a => a.genres.includes('Action'))
    const actionPicks = actionBase.length ? ensureMinRow(sampleVaried(actionBase, Math.min(18, actionBase.length), undefined, 'action', stableOrder), pool, 10, undefined, 'action', stableOrder) : []

    const romanceBase = pool.filter(a => a.genres.includes('Romance'))
    const romancePicks = romanceBase.length ? ensureMinRow(sampleVaried(romanceBase, Math.min(16, romanceBase.length), undefined, 'romance', stableOrder), pool, 10, undefined, 'romance', stableOrder) : []

    const hiddenBase = pool.filter(a => (a.rating ?? 0) >= 7.8 && (a.popularity ?? 0) < 60000 && (a.popularity ?? 0) > 0)
    const hiddenGems = hiddenBase.length ? ensureMinRow(sampleVaried(hiddenBase, Math.min(16, hiddenBase.length), undefined, 'gems', stableOrder), pool, 10, undefined, 'gems', stableOrder) : []
    // If hidden gems pool is tiny (e.g. 5 in 96), ensureMinRow pads from allPool to 10

    // Top Picks for You — based on user's top genres across list, varied
    let topPicks: Anime[] | null = null
    let topGenres: string[] = []
    if (isAuthenticated && combinedList && combinedList.length) {
      const counts = new Map<string, number>()
      for (const e of combinedList) for (const g of e.anime.genres) counts.set(g, (counts.get(g) ?? 0) + 1)
      topGenres = Array.from(counts.entries()).sort((a,b) => b[1]-a[1]).slice(0,3).map(([g])=>g)
      if (topGenres.length) {
        const listIds = new Set(combinedList.map(e => e.anime.identity.internalId))
        const cands = pool.filter(a => !listIds.has(a.identity.internalId))
        const recs = getRecommendations(topGenres, cands)
        // vary: top 20 then ensure 10
        topPicks = recs.length ? ensureMinRow(stableOrder('toppicks', recs.slice(0, 20)), pool, 10, undefined, 'toppicks', stableOrder) : null
      }
    }
    return { highlyRated, shortShuffled, actionPicks, romancePicks, hiddenGems, topPicks, topGenres }
  }, [allPool, isAuthenticated, combinedList, stableOrder])

  // Build dynamic home feed — stable per mount (fresh variety each full load,
  // never reshuffled by background refetches mid-session)
  const middleSections = useMemo(() => {
    const used = new Set<string>()
    const pushVaried = (key: string, title: string, data: Anime[] | null | undefined, subtitle?: string, count = 12) => {
      if (!data || !data.length) return null
      const varied = sampleVaried(data, Math.min(count, data.length), used, `sec:${key}`, stableOrder)
      if (!varied.length) return null
      for (const a of varied) used.add(a.identity.internalId)
      return { key, title, subtitle, data: varied }
    }

    // Stable slices for API categories — same lineup until data changes
    const variedTrending = trending.data ? stableOrder('sec:tr', trending.data).slice(0, 12) : null
    const variedPopular = popular.data ? stableOrder('sec:pop', popular.data).slice(0, 12) : null
    const variedAiring = airing.data ? stableOrder('sec:air', airing.data).slice(0, 12) : null
    const variedNews = news.data ? stableOrder('sec:new', news.data).slice(0, 12) : null

    const sections: Array<{ key: string; title: string; subtitle?: string; data: Anime[] }> = []
    // Use varied samples, avoiding duplication when possible
    const t = !trending.loading && variedTrending?.length ? pushVaried('trending', 'Trending Now', variedTrending, currentSeasonLabel(), 12) : null
    if (t) sections.push(t)
    const p = !popular.loading && variedPopular?.length ? pushVaried('popular', 'Popular on Aeri', variedPopular, 'All-time popular', 12) : null
    if (p) sections.push(p)
    const a = !airing.loading && variedAiring?.length ? pushVaried('airing', 'Currently Airing', variedAiring, 'On air now', 12) : null
    if (a) sections.push(a)
    const n = !news.loading && variedNews?.length ? pushVaried('new', 'New Releases', variedNews, 'Just finished', 12) : null
    if (n) sections.push(n)

    if (derived?.highlyRated?.length) {
      const v = ensureMinRow(derived.highlyRated, allPool, 10, used, 'sec:highly', stableOrder)
      if (v.length) { for (const x of v) used.add(x.identity.internalId); sections.push({ key: 'highly', title: 'Highly Rated', subtitle: 'Critics love these', data: v }) }
    }
    if (derived?.shortShuffled?.length) {
      const v = ensureMinRow(derived.shortShuffled, allPool, 10, used, 'sec:short', stableOrder)
      if (v.length) { for (const x of v) used.add(x.identity.internalId); sections.push({ key: 'short', title: 'Short & Sweet', subtitle: 'Under 12 episodes', data: v }) }
    }
    if (derived?.actionPicks?.length) {
      const v = ensureMinRow(derived.actionPicks, allPool, 10, used, 'sec:action', stableOrder)
      if (v.length) { for (const x of v) used.add(x.identity.internalId); sections.push({ key: 'action', title: 'Action Picks', subtitle: 'For adrenaline', data: v }) }
    }
    if (derived?.romancePicks?.length) {
      const v = ensureMinRow(derived.romancePicks, allPool, 10, used, 'sec:romance', stableOrder)
      if (v.length) { for (const x of v) used.add(x.identity.internalId); sections.push({ key: 'romance', title: 'Romance Picks', subtitle: 'Heartfelt stories', data: v }) }
    }
    if (derived?.hiddenGems?.length) {
      const v = ensureMinRow(derived.hiddenGems, allPool, 10, used, 'sec:gems', stableOrder)
      if (v.length) { for (const x of v) used.add(x.identity.internalId); sections.push({ key: 'gems', title: 'Hidden Gems', subtitle: 'Low-key favorites', data: v }) }
    }

    // personalized sections near bottom but before My List — keep them together, also varied but not deduped aggressively
    const personalized: typeof sections = []
    if (derived?.topPicks?.length) {
      const v = ensureMinRow(derived.topPicks, allPool, 10, undefined, 'sec:toppicks', stableOrder)
      if (v.length) personalized.push({ key: 'toppicks', title: 'Top Picks for You', subtitle: derived.topGenres?.length ? derived.topGenres.join(' · ') : undefined, data: v })
    }
    if (becauseContext && becauseRecommendations?.length) {
      const v = ensureMinRow(becauseRecommendations, allPool, 10, undefined, 'sec:because', stableOrder)
      if (v.length) {
        const refTitle = becauseContext.anime.title.english?.trim() || becauseContext.anime.title.romaji
        const subtitle = becauseContext.anime.genres.slice(0,2).join(' · ') || undefined
        personalized.push({ key: 'because', title: `Because you watched ${refTitle}`, subtitle, data: v })
      }
    }

    // Section order: Trending first, rest in mount-stable varied order (fresh
    // each full load via mountSalt, frozen mid-session so rows never jump).
    const trendingFirst = sections.find(s => s.key === 'trending')
    const rest = sections.filter(s => s.key !== 'trending')
    const hashKey = (k: string) => {
      let h = mountSalt.current
      const s = `${k}`
      for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0
      return h
    }
    const orderedRest = [...rest].sort((a, b) => hashKey(a.key) - hashKey(b.key))
    const ordered = [...(trendingFirst ? [trendingFirst] : []), ...orderedRest, ...personalized]
    return ordered
  }, [trending, popular, airing, news, derived, becauseContext, becauseRecommendations, allPool])

  const trackerName = trackingProvider === 'mal' ? 'MyAnimeList' : 'AniList'

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
            <ContentRow title="Continue Watching" subtitle={`${continueWatching.length} titles • ${trackerName}`}>
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
            <ContentRow title="My List" subtitle={`${myList.length} titles • ${trackerName}`}>
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
