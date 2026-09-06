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

  let done = 0
  const flush = () => {
    try { opts?.onBatch?.([...out]) } catch {}
  }

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
  const workers = Array.from({ length: Math.min(concurrency, pending.length) }, async () => {
    while (cursor < pending.length) {
      if (signal?.aborted) return
      const item = pending[cursor]
      cursor += 1
      if (!item) return
      await enrichOne(item.i, item.e)
    }
  })
  await Promise.all(workers)
  return out
}
