import type { Anime, AnimeListEntry } from '../../types/anime'
import { anilistMetadataProvider } from '../../providers/metadata/anilistMetadata'

// AniList is the sole metadata backbone: entries tracked via MyAnimeList keep
// their tracking truth (status/progress/score from MAL) but take all display
// metadata (titles, cover/banner, season/year, episodes, genres, studios)
// from AniList via idMal lookup. Entries with no AniList match keep their MAL
// fallbacks. All lookups reuse the shared AniList cache (memory 5m + IDB 24h).
export async function enrichMalEntriesWithAnilist(
  entries: AnimeListEntry[],
  opts?: {
    concurrency?: number
    signal?: AbortSignal
    onBatch?: (next: AnimeListEntry[]) => void
  },
): Promise<AnimeListEntry[]> {
  const concurrency = Math.max(1, Math.min(opts?.concurrency ?? 4, 8))
  const signal = opts?.signal
  const out: AnimeListEntry[] = [...entries]
  const pending = entries
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => (e.anime.identity.malId ?? null) !== null && e.anime.identity.anilistId == null)
  if (!pending.length) return out

  // In-progress / currently-watching entries drive Continue Watching and open
  // modals — enrich them first so the visible UI turns AniList-backed fast.
  // Everything runs under AniList's ~90 req/min limit: a fast bounded burst
  // for the priority set, then a paced drip for the long tail. 429s still fall
  // back per entry (retried on a later visit via cache miss).
  const isPriority = ({ e }: { e: AnimeListEntry }) =>
    e.status === 'watching' || e.progress > 0
  const priority = pending.filter(isPriority).slice(0, 40)
  const priorityIdx = new Set(priority.map((p) => p.i))
  const tail = pending.filter((p) => !priorityIdx.has(p.i))

  let done = 0
  const flush = () => {
    try { opts?.onBatch?.([...out]) } catch {}
  }
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

  async function enrichOne(index: number, entry: AnimeListEntry): Promise<void> {
    const malId = entry.anime.identity.malId
    if (malId == null) return
    try {
      const a = await anilistMetadataProvider.getAnimeByMalId(malId, signal)
      const progress = entry.progress
      const episodes = a.episodes ?? entry.anime.episodes ?? 0
      const percent = episodes > 0
        ? Math.round((progress / episodes) * 100)
        : entry.anime.progress?.percent ?? 0
      const anime: Anime = {
        ...a,
        identity: {
          internalId: entry.anime.identity.internalId,
          malId,
          anilistId: a.identity.anilistId,
        },
        progress: { episode: progress, percent },
        listStatus: entry.anime.listStatus,
        inList: true,
      }
      out[index] = { ...entry, anime }
    } catch {
      // No AniList match (or rate-limited): keep MAL fallback for this entry
    } finally {
      done += 1
      if (done % 8 === 0 || done === pending.length) flush()
    }
  }

  // Bounded pool over pending entries, in list order
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
  // Long tail: paced sequential drip (~80 req/min max) so big lists converge
  // across the session without tripping the rate limit.
  for (const item of tail) {
    if (signal?.aborted) return out
    await enrichOne(item.i, item.e)
    if (signal?.aborted) return out
    await delay(750)
  }
  return out
}
