import type { Anime } from '../types/anime'

// Deterministic recommendation engine — genre overlap is primary, popularity/rating/recency are tie-breakers.
// Keeps the same signature used by Home.tsx (topPicks, Because you watched) but avoids popularity dominating overlap.

export function getRecommendations(userGenres: string[], all: Anime[]): Anime[] {
  if (!userGenres.length || !all.length) return [...all]
  const genreSet = new Set(userGenres.map(g => g.toLowerCase()))
  return [...all]
    .map((a) => {
      const overlap = a.genres.filter((g) => genreSet.has(g.toLowerCase())).length
      if (overlap === 0) return { anime: a, score: -1 }
      const overlapScore = overlap * 50
      const ratingScore = (a.rating ?? 0) * 4
      const popularityScore = a.popularity ? Math.log10(a.popularity + 10) * 2 : 0
      const recencyScore = a.year ? Math.max(0, (a.year - 2010) * 0.4) : 0
      const formatBoost = a.format === 'TV' ? 1 : 0
      const score = overlapScore + ratingScore + popularityScore + recencyScore + formatBoost
      return { anime: a, score }
    })
    .filter(x => x.score >= 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.anime)
}
