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
  /** Manga-kind fixtures carry the AniList chapter count (episodes null). */
  chapters?: number
}

export const FIXTURE_MEDIA: FixtureMedia[] = [
  { anilistId: 1, malId: 1, romaji: 'Cowboy Bebop', english: 'Cowboy Bebop', episodes: 26, format: 'TV', year: 1998 },
  { anilistId: 20, malId: 20, romaji: 'Naruto', english: 'Naruto', episodes: 220, format: 'TV', year: 2002 },
  { anilistId: 21, malId: 21, romaji: 'One Piece', english: 'One Piece', episodes: 69, format: 'TV', year: 1999 },
  { anilistId: 1535, malId: 1535, romaji: 'Death Note', english: 'Death Note', episodes: 37, format: 'TV', year: 2006 },
  { anilistId: 16498, malId: 16498, romaji: 'Shingeki no Kyojin', english: 'Attack on Titan', episodes: 25, format: 'TV', year: 2013 },
  { anilistId: 154587, malId: 52991, romaji: 'Sousou no Frieren', english: 'Frieren', episodes: 28, format: 'TV', year: 2023 },
  // Manga-kind (Berserk, AniList 30002 / MAL 2) for the manga card probes.
  // KIND-SCOPED semantics: the manga fixture is only served to MANGA-kind
  // queries — the same numeric MAL id (2) must never satisfy an anime read
  // (D104 boundary, kind-dispatched batch).
  { anilistId: 30002, malId: 2, romaji: 'Berserk', english: 'Berserk', episodes: 0, chapters: 392, format: 'MANGA', year: 1989 },
]

/**
 * The ONE AniList streamingEpisodes name fixtures carry (Naruto ep 21) —
 * the continue-card caption and the detail E-line assert against this
 * deterministic value. Local runs MUST NOT ride the real upstream (AniList
 * 403-blocks direct egress — verified 2026-10-21, and serial suites were
 * burning rate budget): the real-AniList name path stays verified on
 * production live probes. Scanner-cleaner strips the "Episode 21 - " prefix.
 */
export const FIXTURE_EP_NAME_21 = 'Wind Whistle at Dusk'

// A tiny inline SVG data-URI cover so fixture records render a REAL <img>
// (detail ready-gates on artwork; empty covers hide the img and would make
// photo-dependent assertions wait forever).
export const FIXTURE_COVER = 'data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 2 3%22%3E%3Crect width=%222%22 height=%223%22 fill=%22%23445566%22/%3E%3C/svg%3E'
export const FIXTURE_COVER_2 = 'data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 2 3%22%3E%3Crect width=%222%22 height=%223%22 fill=%22%23665544%22/%3E%3C/svg%3E'

function toMediaJson(f: FixtureMedia) {
  return {
    id: f.anilistId,
    idMal: f.malId,
    title: { romaji: f.romaji, english: f.english, native: f.romaji },
    description: `${f.romaji} (test fixture metadata)`,
    coverImage: { extraLarge: f.chapters ? FIXTURE_COVER : '', large: '', medium: '' },
    bannerImage: '',
    startDate: { year: f.year, month: 1, day: 1 },
    season: 'WINTER',
    seasonYear: f.year,
    episodes: f.chapters ? null : f.episodes,
    chapters: f.chapters ?? null,
    volumes: null,
    duration: 24,
    status: 'FINISHED',
    averageScore: 80,
    genres: ['Action'],
    studios: { edges: [], nodes: [] },
    format: f.format,
    popularity: 1000,
    // streamingEpisodes carries the DETERMINISTIC fixture name for Naruto
    // only (continued caption + detail E-line asserts); every other fixture
    // is empty exactly like before — provider play titles are never
    // fabricated.
    streamingEpisodes: f.malId === 20
      ? [{ title: `Episode 21 - ${FIXTURE_EP_NAME_21}`, thumbnail: '', url: 'https://crunchyroll.com/ep21', site: 'Crunchyroll' }]
      : [],
    nextAiringEpisode: null,
    airingSchedule: { nodes: [] },
    isAdult: false,
    // The manga tag fixture carries ONE related MANGA tile (P6: a related
    // manga tile must swap to /manga/:id, never the browse page). Anime
    // fixtures keep empty relations; the detailed relations are the real
    // AniList's verified behavior (live probes).
    relations: f.chapters
      ? {
          edges: [{
            relationType: 'SEQUEL',
            node: {
              id: 30151,
              title: { romaji: 'Berserk Fragments', english: 'Berserk Fragments', native: 'Berserk Fragments' },
              format: 'MANGA', status: 'FINISHED', episodes: null, chapters: 3, volumes: null,
              coverImage: { extraLarge: FIXTURE_COVER_2, large: '', medium: '' },
              bannerImage: '',
            },
          }],
        }
      : { edges: [] },
    trailer: null,
  }
}

/**
 * Build a route handler body for a MEDIA_QUERY-shaped response. Matches on
 * EITHER `id` (anilist) or `idMal` (MAL) variables so both `anilist-<id>`
 * and `mal-<id>` detail paths resolve. KIND-SCOPED (D104): when the query
 * carries a type variable, only fixtures of that kind may answer — MAL id 2
 * is Berserk-manga AND an unknown anime MAL id (the anime and manga id
 * spaces are independent numerics).
 */
export function mediaFixtureByVariables(vars: Record<string, unknown>): unknown {
  const id = Number(vars.id ?? NaN)
  const malId = Number(vars.idMal ?? vars.malId ?? NaN)
  const type = String(vars.type ?? '').toUpperCase()
  const hit = FIXTURE_MEDIA.find(f =>
    (f.anilistId === id || f.malId === malId) &&
    (!type || type === (f.chapters ? 'MANGA' : 'ANIME')))
  if (!hit) return { data: { Media: null } }
  return { data: { Media: toMediaJson(hit) } }
}

/**
 * Batched by-MAL resolution (enrichment D111): the app's batch query is
 * `Page(perPage: 50) { media(idMal_in: $ids, type: $type) }`. Both kinds
 * resolve from FIXTURE_MEDIA by kind; ids with no fixture are ABSENT from
 * the response — exactly the definitive-negative shape the real endpoint
 * returns for unmapped ids.
 */
export function mediaBatchFixtureByResponse(ids: number[], type: string): unknown {
  const wantManga = type === 'MANGA'
  const media = ids.map((malId) => FIXTURE_MEDIA.find((f) => f.malId === malId && wantManga === (f.chapters != null))).filter(Boolean).map(toMediaJson)
  return { data: { Page: { pageInfo: { hasNextPage: false, currentPage: 1, lastPage: 1, total: media.length }, media } as unknown } }
}
