import { useEffect, useState } from 'react'
import type { Anime } from '../types/anime'
import { anilistGraphQL } from '../services/anilist/client'
import { mapAniListMediaToAnime, type AniListMedia, type AniListRelationEdge } from '../services/anilist/mapper'
import { getCache, putCache } from '../storage/db'

export interface RelatedEntry {
  anime: Anime
  relationType: string
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

const RELATED_QUERY = `
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

type RelatedResponse = {
  Media: {
    id: number
    relations?: {
      edges?: {
        relationType: string
        node: AniListMedia & { id: number }
      }[]
    } | null
  } | null
}

const MEM_TTL = 1000 * 60 * 30
const MEM_MAX = 100
// Instance-scoped caches: each RelatedEntries mount (modal desktop,
// modal mobile, detail page, watch page) gets its own namespace so one
// instance's data can never satisfy another's request. Key format:
// `<scope>:<anilistId>` (scope = caller-provided namespace).
const mem = new Map<string, { at: number; data: RelatedEntry[] }>()
const inflight = new Map<string, Promise<RelatedEntry[]>>()

function toEntry(edge: AniListRelationEdge): RelatedEntry | null {
  const node = edge.node
  const nodeId = node?.id
  if (nodeId == null) return null
  const anime = mapAniListMediaToAnime({ ...(node as AniListMedia), id: nodeId })
  return { anime, relationType: edge.relationType ?? 'OTHER' }
}

async function fetchRelated(anilistId: number, signal?: AbortSignal): Promise<RelatedEntry[]> {
  const data = await anilistGraphQL<RelatedResponse>(
    RELATED_QUERY,
    { id: anilistId },
    { cacheKey: `anilist:related:${anilistId}`, useCache: true, signal },
  )
  const edges = data.Media?.relations?.edges ?? []
  const seen = new Set<number>()
  const out: RelatedEntry[] = []
  for (const e of edges) {
    if (!e?.node?.id || e.node.id === anilistId || seen.has(e.node.id)) continue
    const entry = toEntry(e)
    if (!entry) continue
    seen.add(e.node.id)
    out.push(entry)
  }
  // Deterministic: strongest relation first, then format, then id for ties.
  out.sort((a, b) =>
    rankOf(a.relationType, a.anime.format) - rankOf(b.relationType, b.anime.format) ||
    (a.anime.identity.anilistId ?? 0) - (b.anime.identity.anilistId ?? 0),
  )
  return out
}

/**
 * Related Entries for one AniList anime id. Informational/navigation only —
 * never identity, tracking, or streaming. Uses the entry's own `relations`
 * when the caller already holds them (zero extra requests); otherwise one
 * cached relations-only query. Deduped by media id, current entry excluded,
 * ranked strongest → weakest.
 *
 * The first param is a namespaced key `<scope>:<anilistId>` (scope =
 * modal-desktop, modal-mobile, page, watch). Each mount gets its own
 * namespace, so two instances for the SAME anime can never share mem,
 * inflight, or IDB rows — no stale cross-instance results, ever. The
 * numeric id is parsed back out for fetching.
 */
export function useRelatedEntries(
  scopedId: string | number | null | undefined,
  preloaded?: Anime['relations'],
): { entries: RelatedEntry[] | null; loading: boolean } {
  const [state, setState] = useState<{ entries: RelatedEntry[] | null; loading: boolean }>(
    { entries: null, loading: !!scopedId },
  )

  useEffect(() => {
    const { scope, anilistId } = parseScopedId(scopedId)
    if (!anilistId || !Number.isFinite(anilistId) || anilistId <= 0) {
      setState({ entries: null, loading: false })
      return
    }
    // Zero-request path: rank the already-fetched edges in memory.
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
      out.sort((a, b) =>
        rankOf(a.relationType, a.anime.format) - rankOf(b.relationType, b.anime.format) ||
        (a.anime.identity.anilistId ?? 0) - (b.anime.identity.anilistId ?? 0),
      )
      setState({ entries: out, loading: false })
      return
    }
    const hit = mem.get(scopedId as string)
    if (hit && Date.now() - hit.at < MEM_TTL) {
      setState({ entries: hit.data, loading: false })
      return
    }
    const shared = inflight.get(scopedId as string)
    const controller = new AbortController()
    let cancelled = false
    setState({ entries: null, loading: true })
    const run = shared ?? (() => {
      const p = fetchRelated(anilistId, controller.signal)
        .then(res => {
          mem.set(scopedId as string, { at: Date.now(), data: res })
          if (mem.size > MEM_MAX) {
            const oldest = mem.keys().next().value as string | undefined
            if (oldest !== undefined) mem.delete(oldest)
          }
          try { void putCache(`anilist:related:${scope}:${anilistId}`, { entries: res, at: Date.now() }) } catch {}
          return res
        })
      inflight.set(scopedId as string, p)
      return p
    })()
    // IDB before network (repeat visits: zero requests)
    getCache<{ entries: RelatedEntry[]; at: number }>(`anilist:related:${scope}:${anilistId}`)
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
  }, [scopedId, JSON.stringify(preloaded?.edges?.map(e => [e.relationType, e.node?.id]) ?? null)])

  return state
}
