import { useMemo } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { useTracking } from '../contexts/TrackingContext'
import { useAniList } from '../contexts/AniListContext'
import { useMAL } from '../contexts/MALContext'
import { AnimeCard } from '../components/cards/AnimeCard'
import { ContentRow } from '../components/rows/ContentRow'
import { RowSkeleton } from '../components/ui/Skeleton'
import { formatRating } from '../lib/rating'
import { useDetailOpen } from '../hooks/useDetailOpen'
import type { Anime, AnimeListEntry } from '../types/anime'
import { pillSolid, pillSoft } from '../components/ui/buttonStyles'

// Profile (owner 2026-10-20): the home page's row MATERIALS on the user's
// own page — a home-styled "Currently Watching" row with NORMAL cards (not
// the continue variant), user-score-sorted "Highest Rated" / "Lowest Rated"
// rows, and the home page's "My List" row verbatim at the bottom. All four
// rows derive from the ACTIVE tracker's list (exactly one writer per
// reads/writes rule), so switching MAL ↔ AniList swaps every row, the
// avatar, and the profile links.
export function Profile() {
  const { isAuthenticated, trackingProvider, combinedList, loading, error, authExpired } = useTracking()
  const { user: anilistUser, refresh: refreshAniList, loadingList: loadingAniList } = useAniList()
  const { user: malUser } = useMAL()
  const openDetail = useDetailOpen()
  // Avatar + name follow the ACTIVE tracker (switching MAL/AniList swaps
  // both) — same precedence as the navbar (active account first).
  const user = trackingProvider === 'mal' ? (malUser ?? anilistUser) : (anilistUser ?? malUser)
  const trackerName = trackingProvider === 'mal' ? 'MyAnimeList' : 'AniList'

  // REAL PROFILE LINK (owner: "when i click on my username ... lead to my
  // real profile (on mal/anilist)"). URLs verified per provider:
  // MAL profile is name-addressed (https://myanimelist.net/profile/<name>,
  // name from /users/@me), AniList is id-addressed
  // (https://anilist.co/user/<id>, numeric id from Viewer).
  const profileUrl = user
    ? trackingProvider === 'mal'
      ? user.name ? `https://myanimelist.net/profile/${encodeURIComponent(user.name)}` : null
      : user.id ? `https://anilist.co/user/${user.id}` : null
    : null

  const isAnimeEntry = (e: AnimeListEntry) => {
    // PROFILE RULE: anime only — same boundary as Home + the My List tab
    // (manga has the reader + My List manga tab as its own surfaces).
    const mt = e.anime.identity.mediaType
    if (mt) return mt === 'ANIME'
    return !['MANGA', 'NOVEL', 'ONE_SHOT'].includes((e.anime.format ?? '').toUpperCase())
  }

  // Continuation of the home Continue Watching row (D101): strict status
  // watch (statuses normalized at the provider boundary — works for both
  // trackers), most-recently-updated first, list order as tiebreak.
  // ONLY the card variant changes on profile: these are NORMAL anime cards.
  const currentlyWatching: Anime[] = useMemo(() => {
    if (!combinedList) return []
    const filtered = combinedList
      .map((e, idx) => ({ e, idx }))
      .filter(({ e }) => e.status === 'watching')
      .filter(({ e }) => isAnimeEntry(e))
    const sorted = [...filtered].sort((a, b) => (b.e.updatedAt ?? 0) - (a.e.updatedAt ?? 0) || a.idx - b.idx)
    return sorted.map(({ e }) => e.anime)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combinedList])

  // User-score rows with the owner's TIER-FILL rule (2026-10-20): take whole
  // score tiers starting from the extreme until the row holds AT LEAST 10
  // titles — the tier that crosses the minimum is included whole ("8×10★ +
  // 2×9★ → 10 shows; 11×10★ → 11; 1×10★ + 13×9★ → 14"). Fewer than 10
  // scored titles in total → all of them (a minimum can't be met).
  // Scores arrive normalized 0–10 at both provider boundaries (MAL raw 0–10;
  // AniList 0–100 ÷ 10) so tier grouping is tracker-agnostic. Order within
  // a tier: most recently updated first.
  const RANK_MIN = 10
  const tierFill = (entries: AnimeListEntry[], order: 'desc' | 'asc'): Anime[] => {
    const sorted = [...entries].filter(e => (e.score ?? 0) > 0 && isAnimeEntry(e))
      .sort((a, b) => order === 'desc'
        ? (b.score ?? 0) - (a.score ?? 0) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
        : (a.score ?? 0) - (b.score ?? 0) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
    if (sorted.length <= RANK_MIN) return sorted.map(e => e.anime)
    // Walk tier by tier (a tier = every title sharing one score) until the
    // running total crosses RANK_MIN; include that crossing tier WHOLE.
    let count = 0
    for (let i = 0; i < sorted.length; i++) {
      const score = sorted[i].score
      let j = i
      while (j < sorted.length && sorted[j].score === score) j++
      if (count + (j - i) >= RANK_MIN) {
        // Crossing tier: include it whole and stop.
        return sorted.slice(0, j).map(e => e.anime)
      }
      count += j - i
      i = j - 1
    }
    return sorted.map(e => e.anime)
  }

  const highestRated: Anime[] = useMemo(() => {
    if (!combinedList) return []
    return tierFill(combinedList, 'desc')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combinedList])

  const lowestRated: Anime[] = useMemo(() => {
    if (!combinedList) return []
    return tierFill(combinedList, 'asc')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combinedList])

  // The home page's "My List" row, verbatim (anime-only, every entry).
  const myList: Anime[] = useMemo(() => {
    if (!combinedList) return []
    return combinedList.filter(isAnimeEntry).map(e => e.anime)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combinedList])

  // HONEST EMPTY STATE (owner 2026-10-25). Both score rows are hidden when
  // nothing is scored — that is correct, but on its own it reads as "the
  // rows are broken" (the reported Highest/Lowest bug). Report the real
  // reason instead: the rows need scores, and scores added on anilist.co are
  // pulled on the next sync. `refresh` forces past the 24 h list cache.
  const scoredAnimeCount = useMemo(() => {
    if (!combinedList) return 0
    return combinedList.filter(e => (e.score ?? 0) > 0 && isAnimeEntry(e)).length
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combinedList])
  const listedAnimeCount = useMemo(() => {
    if (!combinedList) return 0
    return combinedList.filter(isAnimeEntry).length
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combinedList])

  const stats = useMemo(() => {
    // PROFILE RULE: anime only — same boundary as Home + My List tab.
    const list = (combinedList ?? []).filter(isAnimeEntry)
    const byStatus = (s: string) => list.filter(e => e.status === s).length
    const scores = list.map(e => e.score ?? 0).filter(s => s > 0)
    const mean = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null
    const eps = list.reduce((a, e) => a + (e.progress ?? 0), 0)
    return { total: list.length, watching: byStatus('watching'), completed: byStatus('completed'), planned: byStatus('planned'), mean, eps }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combinedList])

  if (!isAuthenticated) {
    return <Navigate to="/" replace />
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-12 lg:py-8">
      {/* Header: avatar + name + tracker + stats inline (no dead space) */}
      <div className="flex flex-wrap items-center gap-4 sm:gap-5">
        {user?.avatar?.large ? (
          <img src={user.avatar.large} alt={user.name ?? 'Profile'} className="h-16 w-16 shrink-0 rounded-full object-cover sm:h-20 sm:w-20" loading="lazy" />
        ) : (
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--text)_10%,transparent)] text-lg font-bold text-[var(--text)] sm:h-20 sm:w-20">
            {(user?.name ?? '?').slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          {/* OWNER (2026-10-20): the username opens the real profile on the
              active tracker (new tab). Plain-text fallback when the
              identity has no usable id/name yet. */}
          {profileUrl && user?.name ? (
            <h1 className="truncate text-[20px] font-semibold tracking-tight sm:text-[24px]">
              <a
                href={profileUrl}
                target="_blank"
                rel="noreferrer"
                aria-label={`Open ${user.name} on ${trackerName} (opens ${trackerName} in a new tab)`}
                title={`Opens ${trackerName} in a new tab`}
                className="text-[var(--text)] underline-offset-4 transition-colors duration-200 hover:text-[var(--text)] hover:underline"
              >
                {user.name}
              </a>
            </h1>
          ) : (
            <h1 className="truncate text-[20px] font-semibold tracking-tight text-[var(--text)] sm:text-[24px]">{user?.name ?? 'Profile'}</h1>
          )}
          <p className="mt-0.5 text-xs text-[var(--text-faint)] sm:text-[13px]">
            {trackerName}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              to="/list"
              className={pillSolid}
            >
              My List
            </Link>
            <Link
              to="/settings"
              className={pillSoft}
            >
              Settings
            </Link>
          </div>
        </div>
      </div>

      {/* Statistics (kept, same numbers) */}
      <section aria-label="Statistics" className="mt-6">
        <h2 className="mb-2 text-[14px] font-semibold text-[var(--text)]">Statistics</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {[
            { label: 'Watching', value: stats.watching },
            { label: 'Completed', value: stats.completed },
            { label: 'Planned', value: stats.planned },
            { label: 'Episodes', value: stats.eps },
            { label: 'Total', value: stats.total },
            { label: 'Mean score', value: stats.mean != null ? (formatRating(stats.mean) ?? stats.mean) : '—' },
          ].map(s => (
            <div key={s.label} className="rounded-xl border border-[var(--border)] bg-[var(--text)]/[0.02] p-4">
              <p className="text-xl font-semibold text-[var(--text)]">{s.value}</p>
              <p className="mt-0.5 text-xs text-[var(--text-faint)]">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      <div className="mt-8 space-y-6 lg:space-y-7">
        {!loading && (error || authExpired) && (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--text)]/[0.03] px-4 py-3 text-xs text-[var(--text-muted)]">
            {authExpired ? 'Session expired. Reconnect in My List.' : error}
          </div>
        )}

        {loading ? (
          <>
            <RowSkeleton title="Currently Watching" />
            <RowSkeleton title="Highest Rated" />
            <RowSkeleton title="Lowest Rated" />
            <RowSkeleton title="My List" />
          </>
        ) : (
          <>
            {/* OWNER (2026-10-20): right-side descriptions are personal
                labels, replacing the "N titles • tracker" count — exactly
                these three; the row TITLES keep the functional names.
                OWNER (2026-10-19): "rip a row from the home page to replace
                the 'Currently Watching', stylize like that too" — home's
                Continue Watching muscle (same filter + ordering + row
                chrome) on normal cards. "that will also act as currently
                watching". */}
            {currentlyWatching.length > 0 ? (
              <ContentRow title="Currently Watching" subtitle="Shows I'm binging">
                {currentlyWatching.map(a => (
                  <AnimeCard key={a.identity.internalId} anime={a} onSelect={openDetail} />
                ))}
              </ContentRow>
            ) : (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--text)]/[0.02] px-4 py-8 text-center">
                <p className="text-sm font-medium text-[var(--text)]">Nothing in progress</p>
                <p className="mt-1 text-xs text-[var(--text-faint)]">Titles you mark as watching will appear here.</p>
                <Link
                  to="/anime"
                  className={`${pillSolid} mt-4`}
                >
                  Browse anime
                </Link>
              </div>
            )}

            {/* OWNER (2026-10-20): score-sorted rows from the active
                tracker's list (MAL 0–10 / AniList 0–100 → 0–10 at the
                boundary). Hidden until at least one title is scored. */}
            {highestRated.length > 0 && (
              <ContentRow title="Highest Rated" subtitle="Shows I enjoyed">
                {highestRated.map(a => (
                  <AnimeCard key={a.identity.internalId} anime={a} onSelect={openDetail} />
                ))}
              </ContentRow>
            )}
            {lowestRated.length > 0 && (
              <ContentRow title="Lowest Rated" subtitle="Shows I hated">
                {lowestRated.map(a => (
                  <AnimeCard key={a.identity.internalId} anime={a} onSelect={openDetail} />
                ))}
              </ContentRow>
            )}
            {scoredAnimeCount === 0 && listedAnimeCount > 0 && (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--text)]/[0.02] px-4 py-6 text-center">
                <p className="text-sm font-medium text-[var(--text)]">No scores yet</p>
                <p className="mx-auto mt-1 max-w-[46ch] text-xs leading-5 text-[var(--text-faint)]">
                  Highest Rated and Lowest Rated are built from the scores on your {trackerName} list.
                  {trackingProvider === 'anilist'
                    ? ' Rate titles in My List — or on anilist.co — and refresh to pull them in.'
                    : ' Rate a title in My List and it will show up here.'}
                </p>
                {trackingProvider === 'anilist' && (
                  <button
                    type="button"
                    onClick={() => { void refreshAniList() }}
                    disabled={loadingAniList}
                    className={`${pillSolid} mt-4 disabled:opacity-60`}
                  >
                    {loadingAniList && (
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--on-text)]/30 border-t-[var(--on-text)]" />
                    )}
                    {loadingAniList ? 'Refreshing…' : 'Refresh scores'}
                  </button>
                )}
              </div>
            )}

            {/* OWNER (2026-10-20): the home page's "My List" row, directly
                ripped and placed at the bottom (same filter, chrome, and
                empty state). */}
            {myList.length ? (
              <ContentRow title="My List" subtitle={`${myList.length} titles • ${trackerName}`}>
                {myList.map(a => (
                  <AnimeCard key={a.identity.internalId} anime={a} onSelect={openDetail} />
                ))}
              </ContentRow>
            ) : (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--text)]/[0.02] px-4 py-6 text-center text-xs text-[var(--text-faint)]">
                Your list is empty. Add titles from Trending or Search.
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
