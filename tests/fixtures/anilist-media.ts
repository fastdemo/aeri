/**
 * Minimal AniList Media fixtures for playback tests (metadata ONLY).
 *
 * These doubles replace ONLY the app's AniList metadata fetch
 * (`POST https://graphql.anilist.co` with MEDIA_QUERY / MEDIA_BY_MAL_QUERY)
 * inside the Playwright browser context. They carry catalogue metadata
 * (titles, episode counts, malId linkage) so Watch/AnimeDetail can render
 * and resolve provider episodes. They carry NO playback bytes — media
 * resolution always runs the REAL provider chain (MegaVid / AnimeGG /
 * AniWave) unless a test explicitly routes those hosts to a controlled
 * double (see tests/helpers/test-media.ts).
 *
 * Units tested per title: episodes + idMal are the fields Watch needs
 * (episode grid + MegaVid MAL-keyed resolution). streamingEpisodes is
 * intentionally EMPTY: provider episode titles must come from providers,
 * never from fabricated streaming metadata.
 */

export interface FixtureMedia {
  anilistId: number
  malId: number
  romaji: string
  english: string
  episodes: number
  format: string
  year: number
}

export const FIXTURE_MEDIA: FixtureMedia[] = [
  { anilistId: 1, malId: 1, romaji: 'Cowboy Bebop', english: 'Cowboy Bebop', episodes: 26, format: 'TV', year: 1998 },
  { anilistId: 20, malId: 20, romaji: 'Naruto', english: 'Naruto', episodes: 220, format: 'TV', year: 2002 },
  { anilistId: 21, malId: 21, romaji: 'One Piece', english: 'One Piece', episodes: 69, format: 'TV', year: 1999 },
  { anilistId: 1535, malId: 1535, romaji: 'Death Note', english: 'Death Note', episodes: 37, format: 'TV', year: 2006 },
  { anilistId: 16498, malId: 16498, romaji: 'Shingeki no Kyojin', english: 'Attack on Titan', episodes: 25, format: 'TV', year: 2013 },
  { anilistId: 154587, malId: 52991, romaji: 'Sousou no Frieren', english: 'Frieren', episodes: 28, format: 'TV', year: 2023 },
]

function toMediaJson(f: FixtureMedia) {
  return {
    id: f.anilistId,
    idMal: f.malId,
    title: { romaji: f.romaji, english: f.english, native: f.romaji },
    description: `${f.romaji} (test fixture metadata)`,
    coverImage: { extraLarge: '', large: '', medium: '' },
    bannerImage: '',
    startDate: { year: f.year, month: 1, day: 1 },
    season: 'WINTER',
    seasonYear: f.year,
    episodes: f.episodes,
    chapters: null,
    volumes: null,
    duration: 24,
    status: 'FINISHED',
    averageScore: 80,
    genres: ['Action'],
    studios: { edges: [], nodes: [] },
    format: f.format,
    popularity: 1000,
    streamingEpisodes: [],
    nextAiringEpisode: null,
    airingSchedule: { nodes: [] },
    isAdult: false,
    relations: { edges: [] },
    trailer: null,
  }
}

/**
 * Build a route handler body for a MEDIA_QUERY-shaped response. Matches on
 * EITHER `id` (anilist) or `idMal` (MAL) variables so both `anilist-<id>`
 * and `mal-<id>` detail paths resolve.
 */
export function mediaFixtureByVariables(vars: Record<string, unknown>): unknown {
  const id = Number(vars.id ?? NaN)
  const malId = Number(vars.idMal ?? vars.malId ?? NaN)
  const hit = FIXTURE_MEDIA.find(f => f.anilistId === id || f.malId === malId)
  if (!hit) return { data: { Media: null } }
  return { data: { Media: toMediaJson(hit) } }
}
