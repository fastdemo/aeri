import type { Anime, AnimeListEntry } from '../../types/anime'
import { anilistMetadataProvider } from '../../providers/metadata/anilistMetadata'
import { getAnilistStats } from '../../services/anilist/client'

// ANILIST IS THE SOLE METADATA BACKEND (owner 2026-10-20: "anilist for
// metadata, ALWAYS. no mal metadata") WITH ONE GUARANTEE ON TOP (owner
// 2026-10-21: "the continue watching row would just appear immediately...
// it didn't even show all the shows"): entries tracked via MyAnimeList keep
// their tracking truth (status/progress/score writes from MAL) but take ALL
// display metadata from AniList via idMal lookup — anime ids through the
// ANIME-type space, manga entries through the MANGA-type space.
//
// D111 RESOLUTION STRATEGY — batch first, per-entry as failsafe:
// 1) ONE batched request per ≤50-id chunk resolves the whole list at once
//    (`getBatchByMalIds`) — rows appear immediately after a single
//    round-trip, and every per-id cache key is pre-seeded (positives AND
//    definitive negatives), so later passes cost zero network.
// 2) Only when the batch itself died on a throttle (all patient retries
//    spent) does the per-entry pipeline run: the bounded priority burst
//    (watching/progressed, ≤12) then the network-pacing tail over the rest,
//    as a slow-drip fallback rather than the primary path.
//
// An id the batch PROVED has no AniList record is marked `noAniListRecord`
// and keeps its MAL-side record for display — a stable identity that can
// never flip (there is no AniList counterpart to late-arrive). Mapped ids
// always carry the AniList record, so the identity crisis (cards swapping
// MAL art/title for AniList ones mid-session) stays impossible: an entry
// that hasn't resolved yet is held back by the tracking context, and once
// resolved it never regresses.
export async function enrichMalEntriesWithAnilist(
  entries: AnimeListEntry[],
  opts?: {
    concurrency?: number
    signal?: AbortSignal
    onBatch?: (next: AnimeListEntry[]) => void
  },
): Promise<AnimeListEntry[]> {
  const signal = opts?.signal
  const out: AnimeListEntry[] = [...entries]
  const pending = entries
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => (e.anime.identity.malId ?? null) !== null && e.anime.identity.anilistId == null)
  if (!pending.length) return out

  const flush = () => {
    try { opts?.onBatch?.([...out]) } catch {}
  }

  // Kind detection matches the app rule everywhere else (identity mediaType
  // first, then the lowercase MAL media_type vocabulary).
  const isMangaEntry = (e: AnimeListEntry) =>
    e.anime.identity.mediaType === 'MANGA' ||
    ['manga', 'novel', 'one_shot'].includes((e.anime.format ?? '').toLowerCase())

  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

  function applyResolved(
    index: number,
    entry: AnimeListEntry,
    a: Anime,
  ): void {
    const malId = entry.anime.identity.malId!
    const manga = isMangaEntry(entry)
    const progress = entry.progress
    // Units follow the AniList record ONLY ("no mal metadata"): anime take
    // AniList episode counts, manga take AniList chapter counts. An unset
    // AniList count (e.g. an unaired S2 entry) yields 0, not the MAL number.
    const totalUnits = manga
      ? (typeof a.chapters === 'number' && a.chapters > 0 ? a.chapters : 0)
      : (typeof a.episodes === 'number' && a.episodes > 0 ? a.episodes : 0)
    const percent = totalUnits > 0 ? Math.round((progress / totalUnits) * 100) : 0
    const anime: Anime = {
      ...a,
      identity: {
        internalId: entry.anime.identity.internalId,
        malId,
        anilistId: a.identity.anilistId,
      },
      // Public score follows the tracker: MAL mean when tracking MAL,
      // AniList average when tracking AniList. Keep both so switching
      // tracker flips the displayed score.
      ratings: {
        mal: entry.anime.ratings?.mal ?? entry.anime.rating,
        anilist: a.ratings?.anilist ?? a.rating,
      },
      rating: entry.anime.rating ?? a.rating,
      progress: { episode: progress, percent },
      listStatus: entry.anime.listStatus,
      inList: true,
    }
    out[index] = { ...entry, anime }
  }

  // --- Phase A: batched resolution (the whole list in ≤3 chunk requests) ---
  const batchFailed = new Set<'anime' | 'manga'>()
  for (const kind of ['anime', 'manga'] as const) {
    const ids = pending
      .filter(({ e }) => (kind === 'manga') === isMangaEntry(e))
      .map(({ e }) => e.anime.identity.malId as number)
    if (!ids.length) continue
    try {
      await anilistMetadataProvider.getBatchByMalIds(ids, kind, {
        signal,
        onChunk: (resolved, unmapped) => {
          for (const { e, i } of pending) {
            const malId = e.anime.identity.malId as number
            if ((kind === 'manga') !== isMangaEntry(e)) continue
            if (e.anime.identity.anilistId != null) continue
            const rec = resolved.get(malId)
            if (rec) {
              applyResolved(i, e, rec)
              continue
            }
            if (unmapped.includes(malId)) {
              // Definitive AniList-side non-mapping (the chunk completed):
              // keep the MAL-side record, flagged, so the entry can display.
              out[i] = { ...e, noAniListRecord: true }
            }
          }
          flush()
        },
      })
    } catch {
      // Whole chunk failed (throttled after retries / network / aborted):
      // leave those entries to the per-entry fallback below — never mark
      // them unmapped, those negatives would be lies.
      batchFailed.add(kind)
    }
    if (signal?.aborted) return out
  }
  if (signal?.aborted) return out

  // --- Phase B: per-entry fallback for whatever the batch couldn't answer ---
  const remaining = pending
    .filter(({ e, i }) => {
      if (batchFailed.size === 0) return false
      const rely = out[i]
      return rely != null &&
        (rely.anime.identity.anilistId == null) &&
        rely.noAniListRecord !== true &&
        (batchFailed.has(isMangaEntry(e) ? 'manga' : 'anime'))
    })
  if (!remaining.length) { flush(); return out }

  const concurrency = Math.max(1, Math.min(opts?.concurrency ?? 2, 4))
  // In-progress entries drive Continue Watching and open modals — enrich
  // those first; the rest trail at drip pace. The sleep paces REAL network
  // spend only (delta on request counters) — cache-resolved ids free-ride.
  const isPriority = ({ e }: { e: AnimeListEntry }) =>
    e.status === 'watching' || e.progress > 0
  const priority = remaining.filter(isPriority).slice(0, 12)
  const priorityIdx = new Set(priority.map((p) => p.i))
  const tail = remaining.filter((p) => !priorityIdx.has(p.i))

  async function enrichOne(index: number, entry: AnimeListEntry): Promise<void> {
    const malId = entry.anime.identity.malId
    if (malId == null) return
    const manga = isMangaEntry(entry)
    try {
      const a = manga
        ? await anilistMetadataProvider.getMangaByMalId(malId, signal)
        : await anilistMetadataProvider.getAnimeByMalId(malId, signal)
      applyResolved(index, entry, a)
    } catch (e: any) {
      if (e?.code === 'NOT_FOUND') {
        // The by-MAL lookup reached AniList and got no record: definitive
        // non-mapping — keep the MAL-side record, flagged for display. This
        // is per-entry confirmation of the batch answer (or the answers the
        // batch could not attempt). Negatives stay cached per-id, so a later
        // pass never refires the lookup.
        out[index] = { ...entry, noAniListRecord: true }
      }
      // Other errors (throttle/network): leave unresolved — the tracking
      // context holds it back and a later pass resolves it via cache.
    } finally {
      // Committing every entry keeps the fallback path as responsive as the
      // original drip design (onBatch already throttles by caller).
      flush()
    }
  }

  let cursor = 0
  const queue = priority
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (cursor < queue.length) {
      if (signal?.aborted) return
      const item = queue[cursor]
      cursor += 1
      if (!item) return
      await enrichOne(item.i, item.e)
    }
  })
  await Promise.all(workers)
  for (const item of tail) {
    if (signal?.aborted) return out
    const spent = getAnilistStats().requests
    await enrichOne(item.i, item.e)
    if (signal?.aborted) return out
    if (getAnilistStats().requests > spent) await delay(2500)
  }
  return out
}
