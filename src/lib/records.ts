import type { Anime, AnimeListEntry } from '../types/anime'

/**
 * Completeness gate (owner rule 2026-10-18: "don't load the entire preview
 * card when all the info is not enough yet — wait until all the metadata is
 * good to go, then load"). A record is good-to-go when its core metadata is
 * all fielded: real artwork plus a relations field (rail- and detail-fetched
 * AniList Media records always carry it; lite copies — tracker list rows,
 * related tiles, MAL-sourced entries — never do, so they fail this test).
 * Shared by DetailRoute (ready gate) and DetailModal (richer-wins display
 * pick) so both sides agree on what "final" means.
 */
export function isCompleteRecord(a: Anime | null | undefined): boolean {
  if (!a) return false
  if (!a.coverImage && !a.backdropImage) return false
  return a.relations !== undefined
}

/**
 * Richer-wins display pick (owner rule 2026-10-18). The preview card must
 * never DOWNGRADE a complete AniList record to a lite tracker-list copy —
 * that unconditional swap was the sparse-card-then-fill regression: the
 * list copy won the display, and the MAL enrichment drip only "fixed" the
 * card when it finally reached the entry (tens of seconds later).
 *
 * Resolution: the complete record wins the display surface; the list entry
 * keeps owning tracking truth (list status, progress, in-list flag) no
 * matter which record won; both identity ids are unioned so tracker writes
 * resolve through either provider.
 */
export function resolveDisplayRecord(passed: Anime, entry: AnimeListEntry | null | undefined): Anime {
  const entryAnime = entry?.anime ?? null
  const base = isCompleteRecord(entryAnime) ? entryAnime! : isCompleteRecord(passed) ? passed : (entryAnime ?? passed)
  const merged: Anime = {
    ...base,
    // Tracking truth always rides from the list entry when one exists.
    listStatus: entryAnime?.listStatus ?? base.listStatus,
    progress: entryAnime?.progress ?? base.progress,
    inList: entryAnime?.inList ?? base.inList,
    identity: {
      ...base.identity,
      anilistId: base.identity.anilistId ?? passed.identity.anilistId,
      malId: base.identity.malId ?? passed.identity.malId,
    },
  }
  return merged
}
