/**
 * RESUME / RESTART DECISION.
 *
 * The preview card's Play/Read action is "the next unit" — one past the last
 * completed episode/chapter (watching 20 episodes resumes at episode 21). But
 * when NOTHING NEW is left, that rule has
 * no valid target: the old code clamped to the known total and parked the
 * button on the finale forever, so Resume replayed the last episode.
 *
 * Netflix behavior instead: once a title is exhausted — every known unit
 * watched, or an airing show caught up to the latest aired episode — the
 * action RESTARTS at unit 1 and the label drops "Resume" (Play / Read).
 *
 * Kept pure so the rule is testable without a tracker session.
 */
export interface ResumePlanInput {
  /** Units already watched (AniList/MAL list progress). */
  progress: number
  /** Known unit count: episodes for anime, chapters for manga. 0 = unknown. */
  total: number
  /**
   * `nextAiringEpisode.episode` from AniList: the number of the NEXT episode
   * to air. Airing shows have no entry for already-aired episodes in
   * `episodes`, so "caught up" = progress >= nextAiringEpisode - 1.
   * 0 / undefined = not airing.
   */
  nextAiringEpisode?: number | null
}

export interface ResumePlan {
  /** Nothing new remains: the action restarts at unit 1, label is Play/Read. */
  restart: boolean
  /** Unit the Play/Read action opens. */
  target: number
  /** Something is left to resume (label "Resume"). */
  resumable: boolean
}

export function planResume({ progress, total, nextAiringEpisode }: ResumePlanInput): ResumePlan {
  const watched = Math.max(0, progress || 0)
  const knownTotal = Math.max(0, total || 0)
  const latestAired = nextAiringEpisode && nextAiringEpisode > 0 ? nextAiringEpisode - 1 : 0
  const restart =
    watched > 0 &&
    ((knownTotal > 0 && watched >= knownTotal) || (latestAired > 0 && watched >= latestAired))
  const target = watched <= 0 || restart
    ? 1
    : knownTotal > 0
      ? Math.min(watched + 1, knownTotal)
      : watched + 1
  return { restart, target, resumable: watched > 0 && !restart }
}
