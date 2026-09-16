import type { Anime } from '../types/anime'

// Public score display: MAL mean when the MAL tracker is active, AniList
// average otherwise. Always 2 decimals (e.g. 8.70, 7.50).
export function displayRating(anime: Anime | null | undefined, trackingProvider?: 'anilist' | 'mal' | null): number | undefined {
  if (!anime) return undefined
  const r = anime.ratings
  if (trackingProvider === 'mal') {
    if (r?.mal != null) return r.mal
    if (r?.anilist != null) return r.anilist
    return anime.rating
  }
  if (r?.anilist != null) return r.anilist
  if (r?.mal != null) return r.mal
  return anime.rating
}

export function formatRating(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null
  return value.toFixed(2)
}
