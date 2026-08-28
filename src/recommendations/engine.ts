import type { Anime } from '../types/anime'

// Deterministic recommendation engine — Phase 6 placeholder
// Scoring: genre overlap + popularity + recency + list boost

export function getRecommendations(userGenres: string[], all: Anime[]): Anime[] {
  return [...all]
    .map((a) => {
      const overlap = a.genres.filter((g) => userGenres.includes(g)).length
      const score = overlap * 10 + (a.popularity ?? 0) * 0.2 + (a.year ? (a.year - 2015) * 0.5 : 0)
      return { anime: a, score }
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.anime)
}
