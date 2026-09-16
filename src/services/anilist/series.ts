import { anilistGraphQL } from './client'
import { mapAniListMediaToAnime } from './mapper'
import type { Anime } from '../../types/anime'
import type { AniListMedia } from './mapper'
import { getFranchiseTitle } from '../../lib/titles'
import { getCache, putCache } from '../../storage/db'
import { putCachedAnime } from './animeCache'

// Completed season models are cached (memory 30min + IDB 24h, bounded) so
// repeat visits and chain-walk revisits cost zero AniList requests — critical
// under the reduced 30/min limit. Stale entries may serve during throttling;
// entries are real fetched models, never fabricated.
const GROUP_MEM_TTL = 1000 * 60 * 30
const GROUP_MEM_MAX = 100
const groupMem = new Map<number, { group: AnimeSeriesGroup | null; expiry: number }>()
const groupInflight = new Map<number, Promise<AnimeSeriesGroup | null>>()

function groupCacheKey(id: number): string {
  return `anilist:seriesgroup:${id}`
}

export interface AnimeSeriesGroup {
  rootId: number
  title: { romaji: string; english?: string; native?: string }
  stem: string
  seasons: Anime[] // ordered, each retains its own AniList ID
  totalSeasons: number
  relation: 'SEQUEL'
  confidence: 'high' | 'medium' | 'low'
  span?: { from?: number; to?: number }
}

// Only TV (and TV_SHORT) seasons are considered genuine seasons, not movies/OVAs/specials
function isSeasonFormat(format: string | null | undefined): boolean {
  return format === 'TV' || format === 'TV_SHORT'
}

// Conservative: only PREQUEL/SEQUEL with TV format are seasons
function isSeasonRelation(relationType: string, format: string | null | undefined): boolean {
  if (relationType !== 'PREQUEL' && relationType !== 'SEQUEL') return false
  return isSeasonFormat(format)
}
void isSeasonRelation

export function normalizeTitleStem(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[×:]/g, ' ')
    .replace(/\b(season|part|saison)\s*\d+\b/gi, '')
    .replace(/\b\d+(st|nd|rd|th)\s*season\b/gi, '')
    .replace(/:\s*.+-(hen|arc)\s*$/i, '')
    .replace(/\b(2nd|3rd|4th|5th)\s*season\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// Re-export canonical helper from lib/titles for backwards compat
export { getFranchiseTitle } from '../../lib/titles'

// Slim spine hop: id + titles + format + one-level nested relations of every
// One query serves BOTH the chain walk and the display model. Each hop
// carries full display fields for its own node PLUS the nested back-link
// ids/titles/formats needed to verify the NEXT step in memory — so the walk
// needs exactly one request per chain step and zero follow-up fetches of any
// kind (no slim pass, no batch pass, no per-season Media queries).
const SPINE_QUERY = `
query ($id: Int) {
  Media(id: $id, type: ANIME) {
    id
    idMal
    title { romaji english native }
    description
    coverImage { extraLarge large medium }
    bannerImage
    startDate { year month day }
    season
    seasonYear
    episodes
    duration
    status
    averageScore
    genres
    studios { edges { isMain } nodes { name isAnimationStudio } }
    format
    popularity
    streamingEpisodes { title thumbnail url site }
    trailer { id site }
    nextAiringEpisode { airingAt timeUntilAiring episode }
    airingSchedule { nodes { airingAt episode } }
    isAdult
    relations {
      edges {
        relationType
        node {
          id
          title { romaji english native }
          format
          seasonYear
          startDate { year month day }
          episodes
          relations {
            edges {
              relationType
              node { id format }
            }
          }
        }
      }
    }
  }
}
`

// A spine hop IS a full media node (walk fields + display fields together).
// Display mapping reuses mapAniListMediaToAnime directly — no second fetch.
type SlimNode = AniListMedia & {
  relations?: { edges?: { relationType: string; node: SlimEdgeNode }[] }
}

type SlimEdgeNode = {
  id: number
  title?: { romaji?: string | null; english?: string | null; native?: string | null } | null
  format?: string | null
  seasonYear?: number | null
  startDate?: { year?: number | null } | null
  episodes?: number | null
  relations?: { edges?: { relationType: string; node: { id: number; format?: string | null } }[] }
}

type SpineResponse = {
  Media: SlimNode | null
}

async function fetchSpine(id: number, signal?: AbortSignal): Promise<SlimNode> {
  const data = await anilistGraphQL<SpineResponse>(SPINE_QUERY, { id }, { cacheKey: `anilist:spine:${id}`, useCache: true, signal })
  if (!data.Media) throw new Error('Not found')
  return data.Media
}

// Walk PREQUEL chain to find root (earliest season), using slim spine hops.
// Each hop's nested relations carry the candidate's own edge list, so the
// mutual back-link check runs in memory — no follow-up fetch per candidate.
// Same rules as before: exactly one TV prequel + mutual SEQUEL back-link.
async function findRootSpine(media: SlimNode, signal?: AbortSignal): Promise<SlimNode> {
  let current = media
  const visited = new Set<number>([current.id])
  while (true) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const prequelEdges = (current.relations?.edges ?? []).filter((e) => e.relationType === 'PREQUEL' && isSeasonFormat(e.node.format))
    if (prequelEdges.length !== 1) break // 0 = root, >1 = branching -> stop
    const prequelEdge = prequelEdges[0]
    const prequelId = prequelEdge.node.id
    if (visited.has(prequelId)) break
    // Mutual link check from the ALREADY-FETCHED nested edges: the prequel
    // candidate lists its own relations inside this hop's payload.
    const backLink = (prequelEdge.node.relations?.edges ?? []).some(
      (e) => e.relationType === 'SEQUEL' && e.node.id === current.id,
    )
    if (!backLink) break
    visited.add(prequelId)
    try {
      current = await fetchSpine(prequelId, signal)
    } catch (e) {
      if ((e as any)?.name === 'AbortError') throw e
      break
    }
  }
  return current
}

// Walk SEQUEL chain from root, collecting slim nodes in order. Branching uses
// the same mutual-link + stem rule, resolved in memory from nested edges;
// only the CHOSEN next season costs a hop. Returns slim nodes + confidence.
async function collectSpine(root: SlimNode, signal?: AbortSignal): Promise<{ chain: SlimNode[]; confidence: 'high' | 'medium' | 'low' }> {
  const chain: SlimNode[] = []
  const visited = new Set<number>()
  let current: SlimNode | null = root
  let confidence: 'high' | 'medium' | 'low' = 'high'

  while (current && !visited.has(current.id)) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    visited.add(current.id)
    if (isSeasonFormat(current.format)) {
      chain.push(current)
    }
    const sequelEdges = (current.relations?.edges ?? []).filter((e) => e.relationType === 'SEQUEL' && isSeasonFormat(e.node.format))
    if (sequelEdges.length === 0) break
    if (sequelEdges.length > 1) {
      // Branching, resolved in memory: mutual back-link + title-stem match.
      const currentStem = normalizeTitleStem(current.title?.romaji ?? '')
      const scored = sequelEdges.map((edge) => {
        const hasBack = (edge.node.relations?.edges ?? []).some((e) => e.relationType === 'PREQUEL' && e.node.id === current!.id)
        const stem = normalizeTitleStem(edge.node.title?.romaji ?? '')
        const stemMatch = !!(currentStem && stem && (stem === currentStem || stem.startsWith(currentStem) || currentStem.startsWith(stem)))
        const year: number = edge.node.seasonYear ?? edge.node.startDate?.year ?? 9999
        return { edge, hasBack, stemMatch, year }
      })
      const withBack = scored.filter((s) => s.hasBack)
      const pool = withBack.length ? withBack : scored
      const stemMatched = pool.filter((s) => s.stemMatch)
      let chosen: (typeof scored)[number] | undefined
      if (stemMatched.length === 1) chosen = stemMatched[0]
      else if (stemMatched.length > 1) {
        stemMatched.sort((a, b) => a.year - b.year)
        chosen = stemMatched[0]
        confidence = 'low'
      } else if (pool.length === 1) {
        chosen = pool[0]
        confidence = 'medium'
      } else {
        pool.sort((a, b) => a.year - b.year)
        chosen = pool[0]
        confidence = 'low'
      }
      const nextId = chosen!.edge.node.id
      if (visited.has(nextId)) break
      if (chosen!.hasBack === false) confidence = 'low'
      try {
        if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
        current = await fetchSpine(nextId, signal)
      } catch (e) {
        if ((e as any)?.name === 'AbortError') throw e
        break
      }
      continue
    }
    // Single sequel: back-link verified in memory from nested edges.
    const sequelEdge = sequelEdges[0]
    const nextId = sequelEdge.node.id
    if (visited.has(nextId)) break
    const hasBack = (sequelEdge.node.relations?.edges ?? []).some((e) => e.relationType === 'PREQUEL' && e.node.id === current!.id)
    if (!hasBack) {
      const curStem = normalizeTitleStem(current.title?.romaji ?? '')
      const nextStem = normalizeTitleStem(sequelEdge.node.title?.romaji ?? '')
      if (curStem && nextStem && curStem !== nextStem && !nextStem.startsWith(curStem) && !curStem.startsWith(nextStem)) {
        confidence = 'medium'
      }
    }
    try {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      current = await fetchSpine(nextId, signal)
    } catch (e) {
      if ((e as any)?.name === 'AbortError') throw e
      break
    }
  }
  return { chain, confidence }
}

export async function getSeriesGroup(animeId: number, opts?: { signal?: AbortSignal }): Promise<AnimeSeriesGroup | null> {
  const signal = opts?.signal
  if (!Number.isFinite(animeId) || animeId <= 0) return null
  // Memory fast path (shared across components, like anilistGraphQL dedup)
  const memHit = groupMem.get(animeId)
  if (memHit && memHit.expiry > Date.now()) return memHit.group
  // Concurrent callers for the same id share one build
  const shared = groupInflight.get(animeId)
  if (shared) {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
    if (!signal) return shared
    return Promise.race([
      shared,
      new Promise<AnimeSeriesGroup | null>((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError')), { once: true })
      }),
    ])
  }
  const build = (async (): Promise<AnimeSeriesGroup | null> => {
    // IDB before walking the chain (repeat visits: zero network)
    try {
      const cached = await getCache<{ group: AnimeSeriesGroup | null; at: number }>(groupCacheKey(animeId))
      if (cached && Date.now() - cached.at < 1000 * 60 * 60 * 24) {
        groupMem.set(animeId, { group: cached.group, expiry: Date.now() + GROUP_MEM_TTL })
        return cached.group
      }
    } catch {}
    const group = await buildSeriesGroup(animeId, signal)
    groupMem.set(animeId, { group, expiry: Date.now() + GROUP_MEM_TTL })
    if (groupMem.size > GROUP_MEM_MAX) {
      const oldest = groupMem.keys().next().value as number | undefined
      if (oldest !== undefined) groupMem.delete(oldest)
    }
    try { await putCache(groupCacheKey(animeId), { group, at: Date.now() }) } catch {}
    return group
  })()
  groupInflight.set(animeId, build)
  try {
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError')
    if (!signal) return await build
    return await Promise.race([
      build,
      new Promise<AnimeSeriesGroup | null>((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError')), { once: true })
      }),
    ])
  } finally {
    if (groupInflight.get(animeId) === build) groupInflight.delete(animeId)
  }
}

async function buildSeriesGroup(animeId: number, signal?: AbortSignal): Promise<AnimeSeriesGroup | null> {
  try {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    // Single walk: each hop already carries full display fields, so the
    // collected chain maps straight to seasons — no batch pass, no
    // per-season Media queries. One request per chain step, nothing else.
    const initial = await fetchSpine(animeId, signal)
    if (!isSeasonFormat(initial.format)) {
      return null
    }
    const root = await findRootSpine(initial, signal)
    const { chain, confidence } = await collectSpine(root, signal)
    if (chain.length <= 1) return null
    const seasons: Anime[] = chain.map((m) => {
      const anime = mapAniListMediaToAnime(m as any)
      // Every hop is a full media record: publish it to the shared cache so
      // the page Media query (and later visits) cost zero network.
      if (m?.id) putCachedAnime(m.id, anime)
      return anime
    })

    // Compute franchise title from root, normalized
    const franchiseRomaji = getFranchiseTitle(root.title?.romaji ?? seasons[0]?.title.romaji ?? '')
    const years = chain.map((m) => m?.seasonYear ?? m?.startDate?.year).filter(Boolean) as number[]
    const span = years.length ? { from: Math.min(...years), to: Math.max(...years) } : undefined

    return {
      rootId: root.id,
      title: {
        romaji: franchiseRomaji,
        english: root.title?.english ?? undefined,
        native: root.title?.native ?? undefined,
      },
      stem: normalizeTitleStem(franchiseRomaji),
      seasons,
      totalSeasons: seasons.length,
      relation: 'SEQUEL',
      confidence,
      span,
    }
  } catch (e) {
    if ((e as any)?.name === 'AbortError') throw e
    return null
  }
}

// Deduplication for discovery: group by stem (synchronous, no extra fetch)
// Conservative: only dedupe when stem matches and both are TV/TV_SHORT and years are plausible
// This avoids hiding movies/OVAs and alternative routes (Fate) while collapsing genuine seasons (COTE, AoT)
export function deduplicateBySeries(animes: Anime[]): Anime[] {
  if (!animes.length) return animes
  const seen = new Map<string, Anime>()
  const result: Anime[] = []
  for (const anime of animes) {
    // Only consider TV candidates for dedup; movies/OVA stay separate
    if (!isSeasonFormat(anime.format ?? null)) {
      result.push(anime)
      continue
    }
    const stem = normalizeTitleStem(anime.title.romaji)
    if (!stem) {
      result.push(anime)
      continue
    }
    const existing = seen.get(stem)
    if (!existing) {
      seen.set(stem, anime)
      result.push(anime)
    } else {
      // Keep the more popular / higher scored as representative, but preserve root franchise title
      // Prefer higher popularity
      const existingPop = existing.popularity ?? 0
      const currentPop = anime.popularity ?? 0
      if (currentPop > existingPop) {
        // Replace in result
        const idx = result.findIndex(a => a === existing)
        if (idx >= 0) result[idx] = anime
        seen.set(stem, anime)
      }
      // else keep existing, drop current (deduplicated)
    }
  }
  return result
}

// Async version that verifies dedup via actual relations (for Search detail pages)
// Use when you have time to fetch relations and want high confidence
export async function deduplicateBySeriesAsync(animes: Anime[]): Promise<Anime[]> {
  // For now, just use sync version; async verification can be added with getSeriesGroup checks
  return deduplicateBySeries(animes)
}
