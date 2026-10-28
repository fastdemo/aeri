import { useEffect, useState } from 'react'
import type { Anime } from '../types/anime'
import { anilistGraphQL, isAnilistCooling } from '../services/anilist/client'
import { mapAniListMediaToAnime, type AniListMedia, type AniListRelationEdge } from '../services/anilist/mapper'
import { getCache, putCache } from '../storage/db'

export interface RelatedEntry {
  anime: Anime
  relationType: string
  /** True when discovered via a second hop (A→B→C), not a direct edge. */
  indirect?: boolean
}

// AniList relation types, ranked strongest → weakest. Direct story
// continuations (SEQUEL/PREQUEL/PARENT) come first; same-story alternates
// next; spinoffs/side stories after; format-bound one-offs (OVA/ONA/
// specials/movies) last. Unknown types sort below known ones.
const RELATION_RANK: Record<string, number> = {
  SEQUEL: 0,
  PREQUEL: 1,
  PARENT: 2,
  CHARACTER: 3,
  SUMMARY: 4,
  ALTERNATIVE: 5,
  SPIN_OFF: 6,
  SIDE_STORY: 7,
  ADAPTATION: 8,
  PREQUEL_ADAPTATION: 8,
  SEQUEL_ADAPTATION: 8,
  OVA: 9,
  ONA: 9,
  SPECIAL: 10,
  MOVIE: 11,
  OTHER: 12,
}

// TV continuations outrank same-relation movies/specials: a SEQUEL TV is a
// stronger "watch next" signal than a SEQUEL movie recap.
function formatBoost(format?: string | null): number {
  const f = (format ?? '').toUpperCase()
  if (f === 'TV' || f === 'TV_SHORT') return 0
  if (f === 'ONA' || f === 'OVA') return 1
  if (f === 'SPECIAL') return 2
  if (f === 'MOVIE') return 3
  if (f === 'MUSIC') return 5
  return 4
}

function rankOf(relationType: string, format?: string | null): number {
  const base = RELATION_RANK[relationType] ?? 99
  return base * 10 + formatBoost(format)
}

// Scoped key `<scope>:<anilistId>` isolates each RelatedEntries mount
// (modal-desktop, modal-mobile, detail page, watch page) so instances can
// never share mem/inflight/IDB rows. Plain numbers still work (scope '').
function parseScopedId(scopedId: string | number | null | undefined): { scope: string; anilistId: number | null } {
  if (typeof scopedId === 'number') return { scope: '', anilistId: scopedId }
  if (typeof scopedId !== 'string') return { scope: '', anilistId: null }
  const idx = scopedId.lastIndexOf(':')
  if (idx < 0) {
    const n = Number(scopedId)
    return { scope: '', anilistId: Number.isFinite(n) ? n : null }
  }
  const n = Number(scopedId.slice(idx + 1))
  return { scope: scopedId.slice(0, idx), anilistId: Number.isFinite(n) ? n : null }
}

const RELATED_QUERY_ANIME = `
query ($id: Int) {
  Media(id: $id, type: ANIME) {
    id
    relations {
      edges {
        relationType
        node {
          id
          title { romaji english native }
          format
          status
          episodes
          chapters
          volumes
          coverImage { extraLarge large medium }
          bannerImage
        }
      }
    }
  }
}
`

const RELATED_QUERY_MANGA = `
query ($id: Int) {
  Media(id: $id, type: MANGA) {
    id
    relations {
      edges {
        relationType
        node {
          id
          title { romaji english native }
          format
          status
          episodes
          chapters
          volumes
          coverImage { extraLarge large medium }
          bannerImage
        }
      }
    }
  }
}
`

type RelatedEdge = {
  relationType: string
  node: AniListMedia & { id: number }
}
type RelatedResponse = {
  Media: {
    id: number
    relations?: {
      edges?: RelatedEdge[]
    } | null
  } | null
}

const MEM_TTL = 1000 * 60 * 30
const MEM_MAX = 100
// Instance-scoped mem/inflight MIRRORS keyed by the caller's scopedId —
// each RelatedEntries mount keeps its own render mirror. The NETWORK/IDB
// cache inside anilistGraphQL is CANONICAL (`anilist:related:<type>:<id>`,
// no scope): the underlying data is identical for every mount, so desktop
// + mobile instances of the same card share ONE fetch and ONE IDB row
// instead of each firing its own 12-hop fan (the old scope-namespaced keys
// multiplied cold card opens into ~26 GraphQL requests and drove AniList
// 429 storms — the shared cooldown then parked everything for ~60s, which
// is exactly the observed 50/50 failures and 30s waits).
const mem = new Map<string, { at: number; data: RelatedEntry[] }>()
const inflight = new Map<string, Promise<RelatedEntry[]>>()

// Second-hop budget: at most 6 neighbors fetched over the network, in
// ~140ms-staggered starts (a simultaneous 12-query burst trips AniList's
// burst limiter). Skip the fan entirely when the direct list is already
// rich (>= 8 entries) — transitive closure adds little there.
const HOP_MAX = 6
const HOP_RICH = 8
const HOP_STAGGER_MS = 140

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

function toEntry(edge: AniListRelationEdge): RelatedEntry | null {
  const node = edge.node
  const nodeId = node?.id
  if (nodeId == null) return null
  const anime = mapAniListMediaToAnime({ ...(node as AniListMedia), id: nodeId })
  return { anime, relationType: edge.relationType ?? 'OTHER' }
}

async function fetchRelated(anilistId: number, mediaType: 'ANIME' | 'MANGA', signal?: AbortSignal): Promise<RelatedEntry[]> {
  const data = await anilistGraphQL<RelatedResponse>(
    mediaType === 'MANGA' ? RELATED_QUERY_MANGA : RELATED_QUERY_ANIME,
    { id: anilistId },
    // CANONICAL, type-scoped cache identity: anime-16498 relations must
    // never satisfy a manga-16498 read (or vice versa). Mount scopes do NOT
    // participate — every instance of the same media shares this row.
    { cacheKey: `anilist:related:${mediaType}:${anilistId}`, useCache: true, signal },
  )
  const edges = data.Media?.relations?.edges ?? []
  const seen = new Set<number>()
  const direct: RelatedEntry[] = []
  for (const e of edges) {
    if (!e?.node?.id || e.node.id === anilistId || seen.has(e.node.id)) continue
    const entry = toEntry(e)
    if (!entry) continue
    seen.add(e.node.id)
    direct.push(entry)
  }
  // Second hop (transitive closure, depth 1): A→B→C implies A→C listing.
  // AniList relation graphs are shallow per entry, so sequels-of-sequels
  // (AOT S1→S2→S3→Final) only appear via their direct neighbors. Fetch each
  // direct neighbor's own relations (CANONICAL cache keys, so repeats are
  // free across mounts and sessions; staggered starts; failures ignored
  // per neighbor). Bounded: max HOP_MAX neighbors, skipped when direct is
  // already rich.
  const hopTargets = direct.length >= HOP_RICH ? [] : direct.slice(0, HOP_MAX)
  const hopResults: RelatedEdge[][] = await Promise.all(hopTargets.map(async (d, i) => {
    const nid = d.anime.identity.anilistId
    if (!nid) return [] as RelatedEdge[]
    if (i) await sleep(Math.min(i, 5) * HOP_STAGGER_MS)
    try {
      const nd = await anilistGraphQL<RelatedResponse>(
        mediaType === 'MANGA' ? RELATED_QUERY_MANGA : RELATED_QUERY_ANIME,
        { id: nid },
        { cacheKey: `anilist:related:${mediaType}:${nid}`, useCache: true, signal },
      )
      return nd.Media?.relations?.edges ?? []
    } catch { return [] as RelatedEdge[] }
  }))
  for (const hopEdges of hopResults) {
    for (const edge of hopEdges ?? []) {
      if (!edge?.node?.id || edge.node.id === anilistId || seen.has(edge.node.id)) continue
      const entry = toEntry(edge)
      if (!entry) continue
      seen.add(edge.node.id)
      direct.push({ ...entry, indirect: true })
    }
  }
  // Deterministic: strongest relation first, then format, then id for ties.
  // Indirect (second-hop) entries sort after all direct ones.
  direct.sort((a, b) =>
    (a.indirect ? 1 : 0) - (b.indirect ? 1 : 0) ||
    rankOf(a.relationType, a.anime.format) - rankOf(b.relationType, b.anime.format) ||
    (a.anime.identity.anilistId ?? 0) - (b.anime.identity.anilistId ?? 0),
  )
  return direct
}

/**
 * Related Entries for one AniList anime id. Informational/navigation only —
 * never identity, tracking, or streaming. Uses the entry's own `relations`
 * when the caller already holds them (zero extra requests); otherwise one
 * cached relations-only query. Deduped by media id, current entry excluded,
 * ranked strongest → weakest.
 *
 * MEDIA TYPE: pass `mediaType` matching the CURRENT entry ('ANIME' for
 * anime surfaces, 'MANGA' for manga surfaces). The fallback query asks
 * AniList for that type, and preloaded edges are trusted only when the
 * caller's own Media query supplied them (same type by construction).
 * Related nodes carry their own format, so mixed anime↔manga relations
 * (adaptations) render with the correct card + route per entry.
 *
 * The first param is a namespaced key `<scope>:<anilistId>` (scope =
 * modal-desktop, modal-mobile, page, watch) — it keys each mount's own
 * render MIRROR (mem/inflight) so instances never mix states. The network
 * and IDB cache inside anilistGraphQL is CANONICAL per media
 * (`anilist:related:<type>:<id>`): the underlying data is identical for
 * every mount, so concurrent instances share one fetch and one IDB row —
 * a cold card open costs one relations query + a capped, staggered hop
 * fan, not one set per mount.
 */
export function useRelatedEntries(
  scopedId: string | number | null | undefined,
  preloaded?: Anime['relations'],
  mediaType: 'ANIME' | 'MANGA' = 'ANIME',
): { entries: RelatedEntry[] | null; loading: boolean } {
  const [state, setState] = useState<{ entries: RelatedEntry[] | null; loading: boolean }>(
    { entries: null, loading: !!scopedId },
  )

  useEffect(() => {
    const { anilistId } = parseScopedId(scopedId)
    if (!anilistId || !Number.isFinite(anilistId) || anilistId <= 0) {
      setState({ entries: null, loading: false })
      return
    }
    let cancelled = false
    // Zero-request path: rank the already-fetched edges in memory, then
    // enrich with the transitive second hop in the background (same
    // closure rule as fetchRelated; direct entries render immediately,
    // indirect ones merge in when their cached queries resolve).
    // TRUST BOUNDARY: preloaded edges come from the caller's own Media
    // query (same AniList type by construction — MEDIA_QUERY vs
    // MEDIA_MANGA_QUERY). When the fallback query runs, it asks for
    // `mediaType` explicitly. Either way, related NODES carry their own
    // format and are routed per-entry (manga → /manga, anime → /anime/…),
    // so a manga ADAPTATION listed on an anime page still opens as manga.
    const preEdges = preloaded?.edges ?? []
    if (preEdges.length) {
      const seen = new Set<number>()
      const out: RelatedEntry[] = []
      for (const e of preEdges) {
        const id = e.node?.id
        if (id == null || id === anilistId || seen.has(id)) continue
        const cover = e.node?.coverImage
        const coverUrl = typeof cover === 'string' ? cover : (cover?.extraLarge ?? cover?.large ?? cover?.medium ?? '')
        const anime: Anime = {
          identity: { internalId: `anilist-${id}`, anilistId: id },
          title: {
            romaji: e.node?.title?.romaji ?? `Anime ${id}`,
            english: e.node?.title?.english ?? undefined,
            native: e.node?.title?.native ?? undefined,
          },
          description: '',
          coverImage: coverUrl,
          backdropImage: e.node?.bannerImage ?? coverUrl,
          bannerImage: e.node?.bannerImage ?? undefined,
          episodes: e.node?.episodes ?? undefined,
          chapters: e.node?.chapters ?? undefined,
          volumes: e.node?.volumes ?? undefined,
          status: e.node?.status ?? undefined,
          genres: [],
          format: e.node?.format ?? undefined,
        }
        seen.add(id)
        out.push({ anime, relationType: e.relationType ?? 'OTHER' })
      }
      const rankEntries = (list: RelatedEntry[]) => list.sort((a, b) =>
        (a.indirect ? 1 : 0) - (b.indirect ? 1 : 0) ||
        rankOf(a.relationType, a.anime.format) - rankOf(b.relationType, b.anime.format) ||
        (a.anime.identity.anilistId ?? 0) - (b.anime.identity.anilistId ?? 0),
      )
      rankEntries(out)
      setState({ entries: out, loading: false })
      // Background second hop: same closure rule as fetchRelated — canonical
      // cache keys (shared across all mounts), staggered starts, capped at
      // HOP_MAX network targets, skipped when the direct list is already
      // rich, and skipped entirely while the AniList cooldown is armed (a
      // throttle window is never spent on decorative enrichment). Merges
      // unseen ids as indirect; a superseded effect (cancelled) never
      // commits.
      if (!isAnilistCooling() && out.length < HOP_RICH) {
        const hopController = new AbortController()
        const hopTargets = out.slice(0, HOP_MAX).map(d => d.anime.identity.anilistId).filter((nid): nid is number => !!nid)
        void Promise.all(hopTargets.map(async (nid, i) => {
          if (i) await sleep(Math.min(i, 5) * HOP_STAGGER_MS)
          if (hopController.signal.aborted) return [] as RelatedEdge[]
          try {
            const nd = await anilistGraphQL<RelatedResponse>(
              mediaType === 'MANGA' ? RELATED_QUERY_MANGA : RELATED_QUERY_ANIME,
              { id: nid },
              { cacheKey: `anilist:related:${mediaType}:${nid}`, useCache: true, signal: hopController.signal },
            )
            return nd.Media?.relations?.edges ?? []
          } catch { return [] as RelatedEdge[] }
        })).then(hopResults => {
          if (cancelled || hopController.signal.aborted) return
          let added = false
          for (const hopEdges of hopResults) {
            for (const edge of hopEdges ?? []) {
              if (!edge?.node?.id || edge.node.id === anilistId || seen.has(edge.node.id)) continue
              const entry = toEntry(edge)
              if (!entry) continue
              seen.add(edge.node.id)
              out.push({ ...entry, indirect: true })
              added = true
            }
          }
          if (added) {
            rankEntries(out)
            setState({ entries: [...out], loading: false })
          }
        })
        return () => { cancelled = true; hopController.abort() }
      }
      return () => { cancelled = true }
    }
    const hit = mem.get(scopedId as string)
    if (hit && Date.now() - hit.at < MEM_TTL) {
      setState({ entries: hit.data, loading: false })
      return
    }
    const shared = inflight.get(scopedId as string)
    const controller = new AbortController()
    setState({ entries: null, loading: true })
    const run = shared ?? (() => {
      const p = fetchRelated(anilistId, mediaType, controller.signal)
        .then(res => {
          mem.set(scopedId as string, { at: Date.now(), data: res })
          if (mem.size > MEM_MAX) {
            const oldest = mem.keys().next().value as string | undefined
            if (oldest !== undefined) mem.delete(oldest)
          }
          try { void putCache(`anilist:related:${mediaType}:${anilistId}`, { entries: res, at: Date.now() }) } catch {}
          return res
        })
      inflight.set(scopedId as string, p)
      return p
    })()
    // IDB before network (repeat visits: zero requests) — canonical key,
    // shared by every mount of the same media.
    getCache<{ entries: RelatedEntry[]; at: number }>(`anilist:related:${mediaType}:${anilistId}`)
      .then((cached: { entries: RelatedEntry[]; at: number } | null) => {
        if (cancelled) return
        if (cached && Date.now() - cached.at < 1000 * 60 * 60 * 24) {
          mem.set(scopedId as string, { at: Date.now(), data: cached.entries })
          setState({ entries: cached.entries, loading: false })
          return
        }
        return run.then(res => {
          if (!cancelled) setState({ entries: res, loading: false })
        })
      })
      .catch(() => {
        run.then(res => {
          if (!cancelled) setState({ entries: res, loading: false })
        }).catch(() => {
          if (!cancelled) setState({ entries: [], loading: false })
        })
      })
      .finally(() => {
        if (inflight.get(scopedId as string) === run) {
          run.catch(() => {}).finally(() => {
            if (inflight.get(scopedId as string) === run) inflight.delete(scopedId as string)
          })
        }
      })
    return () => { cancelled = true; controller.abort() }
  // Stringify preloaded edges as the dep — stable identity without refetch loops.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedId, mediaType, JSON.stringify(preloaded?.edges?.map(e => [e.relationType, e.node?.id]) ?? null)])

  return state
}
