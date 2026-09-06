import type { Anime } from '../types/anime'

// Conservative search ranking: exact and prefix title matches first, then
// title substring, then genre/studio matches, then everything else in AniList
// order. AniList's own relevance is loose (a query like "epic" surfaces
// barely-related titles), so the top of the list must be earned by closeness.
export function rankSearchResults(query: string, items: Anime[]): Anime[] {
  const nq = query.trim().toLowerCase()
  if (!nq) return items
  const titlesOf = (a: Anime) => [a.title.romaji, a.title.english, a.title.native]
    .filter((t): t is string => !!t)
    .map((t) => t.toLowerCase())
  const tierOf = (a: Anime): number => {
    const ts = titlesOf(a)
    if (ts.some((t) => t === nq)) return 0
    if (ts.some((t) => t.startsWith(nq))) return 1
    if (ts.some((t) => t.includes(nq))) return 2
    const studios = (a.studios ?? []).map((s) => s.toLowerCase())
    if (a.genres.some((g) => g.toLowerCase().includes(nq)) || studios.some((s) => s.includes(nq))) return 3
    return 4
  }
  const tiers = new Map<Anime, number>()
  for (const a of items) tiers.set(a, tierOf(a))
  return [...items].sort((a, b) => {
    const dt = (tiers.get(a) ?? 4) - (tiers.get(b) ?? 4)
    if (dt !== 0) return dt
    return (b.popularity ?? 0) - (a.popularity ?? 0)
  })
}
