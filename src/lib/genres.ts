// Canonical AniList genre list — single source for the Anime-page filter and
// the search genre boost below.
export const ANILIST_GENRES = [
  'Action',
  'Adventure',
  'Animation',
  'Comedy',
  'Drama',
  'Fantasy',
  'Horror',
  'Mahou Shoujo',
  'Mecha',
  'Music',
  'Mystery',
  'Psychological',
  'Romance',
  'Sci-Fi',
  'Slice of Life',
  'Sports',
  'Supernatural',
  'Suspense',
] as const

export function matchKnownGenre(query: string): string | null {
  const q = query.trim().toLowerCase()
  if (!q) return null
  // Exact match first, then prefix (so "sci" finds Sci-Fi, "act" finds Action)
  const exact = ANILIST_GENRES.find((g) => g.toLowerCase() === q)
  if (exact) return exact
  return ANILIST_GENRES.find((g) => g.toLowerCase().startsWith(q)) ?? null
}
