import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Anime, AnimeStatus } from '../../types/anime'
import { EpisodeList, getEpisodes } from '../episodes/EpisodeList'
import { ChapterList } from '../manga/ChapterList'
import { useTracking } from '../../contexts/TrackingContext'
import { TrackerCompact } from './TrackerCompact'
import { useRelatedEntries } from '../../hooks/useRelatedEntries'
import { RelatedEntries } from '../related/RelatedEntries'
import { displayRating, formatRating } from '../../lib/rating'
import { getTitleHierarchy } from '../../lib/titles'
import { useAeriTitle } from '../../hooks/useAeriTitle'
import { Icon } from '../ui/Icon'
import { pillSolid } from '../ui/buttonStyles'
import { getAiredTotal, sanitizeAnimeForDisplay, getStreamingEpisodeTitle } from '../../lib/episodes'
import { useKitsuEpisodes } from '../../hooks/useKitsuEpisodes'
import { resolveDisplayRecord } from '../../lib/records'
import { formatLabel, statusLabel } from '../../lib/mediaLabels'
import { resolveChaptersWithFallback } from '../../providers/manga/mangadex'
import { planResume } from '../../lib/resume'

function ScoreBadge({ anime, trackingProvider }: { anime: Anime; trackingProvider?: 'anilist' | 'mal' | null }) {
  const text = formatRating(displayRating(anime, trackingProvider))
  if (!text) return null
  return (
    <span className="inline-flex items-center gap-1 rounded bg-[color-mix(in_srgb,var(--text)_10%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text)]">
      <span className="text-[var(--text)]">★</span> {text}
    </span>
  )
}

export function DetailModal({
  anime,
  onClose,
  onSelectRelated,
}: {
  anime: Anime
  onClose: () => void
  /** When provided (card-grid hosts), related clicks swap the modal content
      in place instead of navigating. Detail-page hosts omit it (links). */
  onSelectRelated?: (anime: Anime) => void
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const { isAuthenticated, combinedList, updateStatus, updateRating, updateProgress, removeEntry, error: trackingError, trackingProvider } = useTracking()
  const [syncing, setSyncing] = useState<string | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  // EXIT ANIMATION: every dismiss path — ✕, click-outside, Esc — funnels
  // through dismiss(): run the reverse keyframes on the card (scale/fade
  // out, mirroring aeri-pop-in) and on the scrim, THEN commit the real
  // close. 190ms ≈ the out duration; the guard keeps double-escapes
  // single-flight.
  const [closing, setClosing] = useState(false)
  const closingRef = useRef(false)
  const dismiss = useCallback(() => {
    if (closingRef.current) return
    closingRef.current = true
    setClosing(true)
    setTimeout(() => onClose(), 190)
  }, [onClose])
  // Base entry: prop-only match, available before grouping resolves.
  // TYPE-SAFE: malId namespaces collide across MAL anime/manga (same digits,
  // different works), so a malId hit is accepted ONLY when the media kinds
  // agree (manga-format vs anime-format). Otherwise an anime list entry
  // could replace a manga modal (HxH manga → random anime).
  const baseEntry = (() => {
    if (!isAuthenticated || !combinedList) return null
    const malId = anime.identity.malId
    const anilistId = anime.identity.anilistId
    const selfManga = ['MANGA', 'NOVEL', 'ONE_SHOT'].includes(anime.format?.toUpperCase() ?? '')
    return combinedList.find((e) => {
      const eManga = ['MANGA', 'NOVEL', 'ONE_SHOT'].includes(e.anime.format?.toUpperCase() ?? '')
      if (malId && e.anime.identity.malId === malId) return eManga === selfManga
      if (anilistId && e.anime.identity.anilistId === anilistId) return eManga === selfManga
      if (e.anime.identity.internalId === anime.identity.internalId) return true
      return false
    }) ?? null
  })()

  const currentScore = baseEntry?.score ?? null
  // RICHER-WINS DISPLAY (nothing renders until the metadata is final).
  // `baseEntry?.anime ?? anime` used to swap the list
  // copy in UNCONDITIONALLY — a MAL-lite row (no relations/season/streaming)
  // downgraded a complete AniList record the card already held, and the
  // enrichment drip only upgraded it again seconds later: the sparse-card-
  // then-fill flip. Now the complete record wins the
  // display; the list entry still owns tracking truth; identity ids are
  // unioned so tracker writes resolve through either provider.
  //
  // `rawDisplayAnime` is kept BEFORE the display sanitizer so the Kitsu
  // whole-entry gate can still see AniList data that the season/range guard
  // later discards for rendering.
  const rawDisplayAnime = useMemo(() => resolveDisplayRecord(anime, baseEntry), [anime, baseEntry])
  const displayAnime = useMemo(() => {
    if (['MANGA', 'NOVEL', 'ONE_SHOT'].includes(rawDisplayAnime.format?.toUpperCase() ?? '')) {
      return rawDisplayAnime
    }
    return sanitizeAnimeForDisplay(rawDisplayAnime)
  }, [rawDisplayAnime])
  const displayKey = displayAnime.identity.anilistId ? `anilist:${displayAnime.identity.anilistId}` : displayAnime.identity.internalId
  // E-line + episode list share the same narrow fallback: Kitsu is
  // consulted only when this entry has zero usable AniList episode
  // metadata. AniList titles/thumbs always win when present.
  const kitsuEpisodes = useKitsuEpisodes(displayAnime, rawDisplayAnime)
  const titles = getTitleHierarchy(displayAnime)
  // TAB TITLE: the overlay carries the ENTRY's name —
  // "Assassination Classroom - Aeri" — and the stack restores the page
  // beneath ("Home - Aeri") when the card closes.
  useAeriTitle(titles.primary || null, 'override')
  const isMovie = displayAnime.format?.toUpperCase() === 'MOVIE'
  const isMangaKind = ['MANGA', 'NOVEL', 'ONE_SHOT'].includes(displayAnime.format?.toUpperCase() ?? '')

  // Mobile-stack related data. Hoisted to the top level (one hook call,
  // never conditionally invoked) because the divider below it must know
  // whether related content actually follows: empty results hide the
  // divider and the block entirely; loading shows skeletons WITHOUT the
  // divider so a resolved-empty title never leaves a line above nothing.
  // Same scope key ("modal-mobile:<id>") the inline block used, so cache
  // behavior is unchanged.
  const mobileRelated = useRelatedEntries(
    displayAnime.identity.anilistId ? `modal-mobile:${displayAnime.identity.anilistId}` : null,
    displayAnime.relations,
    isMangaKind ? 'MANGA' : 'ANIME',
  )

  // Tracking: this entry's own progress only. Related entries never share.
  // Same malId-kind guard as baseEntry above.
  const entry = useMemo(() => {
    if (!isAuthenticated || !combinedList) return null
    const id = displayAnime.identity
    const selfManga = ['MANGA', 'NOVEL', 'ONE_SHOT'].includes(displayAnime.format?.toUpperCase() ?? '')
    return combinedList.find((e) => {
      const eManga = ['MANGA', 'NOVEL', 'ONE_SHOT'].includes(e.anime.format?.toUpperCase() ?? '')
      if (id.malId && e.anime.identity.malId === id.malId) return eManga === selfManga
      if (id.anilistId && e.anime.identity.anilistId === id.anilistId) return eManga === selfManga
      return e.anime.identity.internalId === id.internalId
    }) ?? null
  }, [isAuthenticated, combinedList, displayAnime])
  const trackedStatus = entry?.status ?? baseEntry?.status ?? displayAnime.listStatus ?? null
  const currentStatus: AnimeStatus | null = trackedStatus
  const numEp = entry?.progress ?? 0
  const hasWatched = numEp > 0
  // KNOWN TOTAL for this kind: episodes for anime, chapters for manga.
  const knownTotal = isMangaKind
    ? (displayAnime.chapters && displayAnime.chapters > 0 ? displayAnime.chapters : 0)
    : (displayAnime.episodes && displayAnime.episodes > 0 ? displayAnime.episodes : 0)
  // AIRED TOTAL: the progress readout and bar are measured
  // against episodes that HAVE AIRED — "3 of 3" when a show has aired 3 and
  // the viewer watched 3, never "3 of 12". Manga keeps its chapter total
  // (there is no airing schedule for chapters).
  const airedTotal = isMangaKind ? knownTotal : getAiredTotal(displayAnime, knownTotal)
  // RESUME vs RESTART: one pure rule (`planResume`) owns the decision so the
  // modal, card actions, and tests can never drift apart.
  //   • something left  → open unit progress+1, label "Resume"
  //   • nothing left    → open unit 1, label "Play"/"Read" (Netflix restart)
  const resumePlan = planResume({
    progress: numEp,
    total: knownTotal,
    nextAiringEpisode: displayAnime.nextAiringEpisode?.episode ?? null,
  })
  const restart = resumePlan.restart
  const resumeEpisodeNumber = resumePlan.target
  const resumeLabel = resumePlan.resumable ? 'Resume' : isMangaKind ? 'Read' : 'Play'
  // Finished entries always render a full bar even when no percent survived
  // mapping. AIRING TITLES are measured against aired episodes, so a
  // caught-up viewer of a releasing show sees a full bar
  // instead of a fraction of the planned season.
  const barPercent = (() => {
    if (!entry) return 0
    if (airedTotal > 0 && numEp > 0) return Math.min(100, Math.round((numEp / airedTotal) * 100))
    const p = entry.anime.progress?.percent
    if (typeof p === 'number' && p > 0) return Math.min(100, p)
    if (entry.status === 'completed') return 100
    return 0
  })()

  // E-line (E1 • title) — ALWAYS the episode Resume/continue will open: the
  // NEXT episode — one past the last completed episode, so a viewer who
  // finished episode 20 sees e21's info above the
  // description. 1 for an unstarted show, clamped to the known total,
  // hidden entirely when fully caught up. The show description paragraph
  // below stays the SHOW's description — never a placeholder.
  // The NAME comes from the ANILIST record — AniList owns all names.
  // The record reaching the modal rarely carries streamingEpisodes
  // (pool/list copies don't), so resolve it eagerly — same AniList-first
  // record the cards mount-fetch (shared IDB cache + inflight dedupe +
  // patient 429 retry, so bursts can starve it only temporarily).
  const [nextEpName, setNextEpName] = useState<string | null>(null)
  useEffect(() => {
    setNextEpName(null)
    if (isMovie || isMangaKind) return
    const aid = displayAnime.identity.anilistId
    const mid = displayAnime.identity.malId
    if (!(aid && !Number.isNaN(aid)) && !mid) return
    const metaId = aid && !Number.isNaN(aid) ? `anilist-${aid}` : `mal-${mid}`
    let cancelled = false
    void import('../../providers/metadata/anilistMetadata')
      .then(m => m.getAnimePatient(metaId))
      .then(full => {
        if (cancelled || !full) return
        const t = getStreamingEpisodeTitle(full, resumeEpisodeNumber)
        if (t) setNextEpName(t)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [isMovie, isMangaKind, displayAnime.identity.anilistId, displayAnime.identity.malId, resumeEpisodeNumber])
  const epline = (() => {
    if (isMovie || isMangaKind) return null
    // Nothing new to watch (finished, or caught up on an airing show): the
    // line would advertise a rewatch, so it hides with the restart state.
    if (restart) return null
    const showTotal = displayAnime.episodes && displayAnime.episodes > 0 ? displayAnime.episodes : 0
    if (numEp > 0 && showTotal > 0 && numEp >= showTotal) return null
    const next = resumeEpisodeNumber
    const target = getEpisodes(displayAnime, kitsuEpisodes).find(e => e.number === next) ?? null
    const title = nextEpName ?? target?.title ?? null
    if (!title && numEp <= 0 && !displayAnime.progress) return null
    return { number: target?.displayNumber ?? next, title }
  })()
  const hasEpline = !!epline
  const eplineNumber = epline?.number ?? 0
  const eplineTitle = epline?.title ?? null

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [dismiss])

  // Body lock — must not delay navigation. Save/restore overflow synchronously on mount/unmount;
  // hashchange/popstate will unmount this modal AFTER route has already changed (HashRouter push is sync).
  useEffect(() => {
    const prevBody = document.body.style.overflow
    const prevHtml = document.documentElement.style.overflow
    // Prevent background scroll without creating a stacking context that captures pointer events
    document.body.style.overflow = 'hidden'
    // iOS: also lock html to prevent rubber-band scroll from swallowing hashchange
    // but keep pointer events on fixed header (z-50) unaffected — overflow hidden does not intercept clicks
    return () => {
      document.body.style.overflow = prevBody
      document.documentElement.style.overflow = prevHtml
    }
  }, [])

  // New modal always opens at the very top: reset the overlay scroller on
  // mount (it persists across opens) and focus the dialog without scrolling
  // the page underneath (preventScroll — the background is body-locked).
  // In-card related swaps reuse this instance (same route element), so the
  // identity key also re-runs this: the swapped record starts at the top
  // and receives focus, like a freshly opened card.
  const scrollerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: 0 })
    dialogRef.current?.focus({ preventScroll: true })
  }, [displayKey])

  // SEASON + YEAR COLLAPSE: a releasing TV entry renders "TV • Fall 2026 •
  // Airing" — season and year share ONE segment ("Fall 2026") in the year's
  // slot; everything else keeps its own.
  const seasonYear = displayAnime.season && displayAnime.year
    ? `${displayAnime.season.charAt(0)}${displayAnime.season.slice(1).toLowerCase()} ${displayAnime.year}`
    : (displayAnime.year ? String(displayAnime.year) : null)
  const metaParts = [formatLabel(displayAnime.format), seasonYear, !isMovie && !isMangaKind && displayAnime.episodes ? `${displayAnime.episodes} Episodes` : null, isMangaKind && displayAnime.chapters ? `${displayAnime.chapters} Chapters` : null, isMangaKind && displayAnime.volumes ? `${displayAnime.volumes} Volumes` : null, statusLabel(displayAnime.status)].filter(Boolean).join(' • ')

  return (
    <>
      {/* VEIL = STATIC, NON-SCROLLING LAYER. The tint + blur used to live on
          the scroll container itself; `backdrop-filter` on a scroller forces
          the ENTIRE scrollable content height into one composited layer
          (measured 2880 x 38,482 px on /manga/30002 and 2880 x 173,794 px on
          /anime/21). Rasterizing that during a fast scroll is what flickered.
          A fixed, viewport-sized sibling is the same picture at 1440 x 900.
          pointer-events-none so the scroller above stays the click target. */}
      <div
        aria-hidden
        className={`pointer-events-none fixed inset-x-0 bottom-0 top-14 z-40 bg-[color-mix(in_srgb,var(--bg)_75%,transparent)] backdrop-blur-[2px] ${closing ? 'anim-fade-out' : 'anim-fade-in'}`}
      />
      {/* CLICK-OUT ANYWHERE: clicking the veil — including the
          bottom part of the overlay — closes the card. The VEIL itself is the
          close target. The old `<button fixed inset-0>` backdrop was trapped
          by this scroller's `backdrop-blur` — blur (like filter) makes the
          scroller the containing block for fixed descendants, so the button
          laid out in CONTENT coordinates and scrolled away with the card:
          only clicks near the top of an unscrolled overlay reached it. A
          scroller onClick + stopPropagation on the card closes at EVERY
          scroll position, from any band, with the same dismiss() funnel
          (✕ / Esc / outside) and the same reverse animation. The scroller is
          now paint-transparent (the veil behind it owns the background) and
          keeps NO backdrop-filter, so it cannot become a containing block
          again. */}
      <div ref={scrollerRef} onClick={dismiss} className="fixed inset-x-0 bottom-0 top-14 z-40 flex items-start justify-center overflow-y-auto p-2 sm:p-6 lg:p-8">
        <div
          ref={dialogRef}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label={titles.primary}
          tabIndex={-1}
          className={`relative my-2 flex max-h-none w-full max-w-[980px] flex-col overflow-visible rounded-xl bg-[var(--bg-soft)] shadow-[0_24px_64px_var(--shadow)] outline-none sm:my-6 ${closing ? 'anim-pop-out-center' : 'anim-pop-in-center'}`}
        >
          {/* Bare ✕ — no circular background, the glyph is 20px (up from 14),
              and a soft shadow in the THEME's own shadow color
              keeps it legible over bright art. No scale/motion on hover — a
              quiet opacity ease only. */}
          <button
            onClick={dismiss}
            aria-label="Close"
            className="absolute right-3 top-3 z-20 grid h-9 w-9 place-items-center rounded-full text-[var(--text)] transition-opacity duration-150 hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-strong)] [filter:drop-shadow(0_2px_6px_var(--shadow))]"
          >
            <Icon name="x" size={20} />
          </button>

          <div className="relative h-[360px] w-full overflow-hidden rounded-t-xl sm:h-[420px]">
            <img src={displayAnime.backdropImage || anime.backdropImage} alt="" className="h-full w-full object-cover" loading="eager" />
            <div
              aria-hidden
              className="detail-banner-scrim absolute inset-0"
            />
            <div className="absolute left-6 top-6 hidden max-w-[520px] sm:block">
              <h2 className="hero-copy-shadow text-[28px] font-semibold leading-none tracking-tighter text-[var(--text)] drop-shadow">
                {titles.primary}
              </h2>
              {titles.native && <p className="hero-copy-shadow mt-1 text-xs text-[var(--text-muted)]">{titles.native}</p>}
              {titles.romaji && <p className="hero-copy-shadow mt-1 text-[11px] tracking-wide text-[var(--text-faint)]">{titles.romaji}</p>}
            </div>

            <div className="absolute bottom-0 left-0 right-0 flex flex-wrap items-center gap-2 px-4 pb-4 sm:px-6">
              {/* Watched progress on the preview card (anime AND manga).
                  D155: neon — the fill glows in its OWN ink (6px --text),
                  matching the Continue Watching pill, instead of a --shadow
                  halo that read as a flat smear. The 2px track sits on the
                  banner's bottom gradient, so it never floats on raw art. */}
              {barPercent > 0 && (
                <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-[color-mix(in_srgb,var(--text)_15%,transparent)]">
                  <div className="h-full bg-[var(--text)] shadow-[0_0_6px_var(--text)]" style={{ width: `${barPercent}%` }} />
                </div>
              )}

              {isMangaKind ? (
                <Link
                  to={`/read/${displayAnime.identity.internalId}/${hasWatched && !restart ? `ch-${resumeEpisodeNumber}` : restart ? 'ch-1' : 'first'}`}
                  className={pillSolid}
                >
                  {/* Open-book art, matching the cards. */}
                  <Icon name="book-open" size={14} />
                  {resumeLabel}
                </Link>
              ) : (
                <Link
                  to={`/watch/${displayAnime.identity.internalId}/${resumeEpisodeNumber}`}
                  className={pillSolid}
                >
                  <Icon name="play-fill" size={14} />
                  {resumeLabel}
                </Link>
              )}
              {/* The progress line reports what WAS WATCHED (numEp), never the
                  resume target (progress+1) — "6 of 25" means six watched, not
                  "you are about to watch 6". Manga reads "N of M chapters";
                  anime keeps "N of M • P% watched". */}
              {hasWatched && (
                <span className="text-xs text-[var(--text-muted)]">
                  {isMangaKind
                    ? `${numEp} of ${knownTotal > 0 ? knownTotal : '—'}`
                    : (<>{numEp}{airedTotal > 0 ? ` of ${airedTotal}` : ''} • {barPercent}% watched</>)}
                </span>
              )}

              {/* SINGLE list control, plain two-way toggle: not in list → +
                  adds as Plan to Watch / Plan to Read; in list → ✓ removes the
                  entry entirely. No inline menu: the Status pill below the hero
                  (TrackerCompact) already owns every status change AND removal —
                  the old popup duplicated those writes one tap away. One button,
                  two functions: add, remove. */}
              {isAuthenticated && (
                <div className="ml-auto flex items-center gap-2">
                  <button
                    aria-label={currentStatus ? 'Remove from My List' : 'Add to My List'}
                    onClick={async () => {
                      setSyncing('status')
                      try {
                        if (currentStatus) {
                          await removeEntry(displayAnime)
                        } else {
                          await updateStatus(displayAnime, 'planned')
                        }
                      } catch (e) {
                        setLocalError(e instanceof Error ? e.message : 'Couldn’t update My List')
                      } finally {
                        setSyncing(null)
                      }
                    }}
                    className={`grid h-8 w-8 place-items-center rounded-full border border-[var(--border-strong)] bg-[color-mix(in_srgb,var(--bg)_30%,transparent)] text-[var(--text)] backdrop-blur hover:bg-[color-mix(in_srgb,var(--text)_10%,transparent)] ${currentStatus ? 'bg-[color-mix(in_srgb,var(--text)_10%,transparent)]' : ''}`}
                  >
                    {syncing === 'status' ? (
                      <span className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--border-strong)] border-t-[var(--text)]" />
                    ) : currentStatus ? (
                      <Icon name="check-lg" size={14} />
                    ) : (
                      <Icon name="plus-lg" size={14} />
                    )}
                  </button>
                </div>
              )}
            </div>
          </div>

          {(localError || trackingError) && (
            <div className="mx-4 mt-3 rounded border border-[var(--warn)] bg-[var(--warn)] px-3 py-2 text-xs text-[var(--warn)] sm:mx-6">
              {localError ?? trackingError}
            </div>
          )}
          {isAuthenticated && (
            <TrackerCompact
              status={currentStatus}
              score={currentScore}
              progress={numEp}
              total={isMangaKind ? (displayAnime.chapters ?? null) : (displayAnime.episodes ?? null)}
              isManga={isMangaKind}
              syncing={syncing}
              onStatus={async (s) => {
                setSyncing('status')
                try { await updateStatus(displayAnime, s) }
                catch (e) { setLocalError(e instanceof Error ? e.message : 'Couldn’t update status') }
                finally { setSyncing(null) }
              }}
              onRemove={async () => {
                setSyncing('status')
                try { await removeEntry(displayAnime) }
                catch (e) { setLocalError(e instanceof Error ? e.message : 'Couldn’t remove from list') }
                finally { setSyncing(null) }
              }}
              onScore={async (n) => {
                setSyncing('score')
                try { await updateRating(displayAnime, n) }
                catch (e) { setLocalError(e instanceof Error ? e.message : 'Couldn’t update score') }
                finally { setSyncing(null) }
              }}
              onProgress={async (n) => {
                setSyncing('progress')
                // Manual edit — still syncs while Incognito is on.
                try { await updateProgress(displayAnime, n, { manual: true }) }
                catch (e) { setLocalError(e instanceof Error ? e.message : 'Couldn’t update progress') }
                finally { setSyncing(null) }
              }}
            />
          )}

          {/* Content grid: row 1 = description | metadata, row 2 =
              episodes/chapters | related. Row 2 is a SINGLE shared grid row,
              so the Episodes header and the Related Shows header start at
              exactly the same y by construction — the conditional E-line lives
              in row 1 and shifts row 2 down for BOTH columns equally.
              DOM order (D,M,E,R,mobile) is the mobile stacking order;
              lg placement puts D|M on row 1 and E|R on row 2.
              No offsets, no spacers, no per-state tuning. */}
          <div className="grid gap-6 px-4 py-5 sm:px-6 lg:grid-cols-[1.7fr_0.9fr]">
            {/* Row 1, col 1: title/meta/E-line/description. */}
            <div className="min-w-0 lg:col-start-1 lg:row-start-1">
              {/* Mobile title hierarchy — visible only when desktop overlay hidden */}
              <div className="mb-3 sm:hidden">
                <h2 className="text-[20px] font-semibold leading-none tracking-tighter text-[var(--text)]">{titles.primary}</h2>
                {titles.native && <p className="mt-1 text-xs text-[var(--text-muted)]">{titles.native}</p>}
                {titles.romaji && <p className="mt-1 text-[11px] tracking-wide text-[var(--text-faint)]">{titles.romaji}</p>}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-muted)]">
                <span>{metaParts}</span>
                <ScoreBadge anime={displayAnime} trackingProvider={trackingProvider} />
              </div>

              {/* E-line renders only with real content — never a spacer. */}
              {!isMovie && !isMangaKind && hasEpline && (
                <p className="mt-2 text-[12px] font-semibold text-[var(--text)]">
                  Episode {eplineNumber} {eplineTitle ? `• ${eplineTitle}` : ''}
                </p>
              )}
              {/* Manga mirror of the E-line: the NEXT chapter's info
                  above the description — Chapter <next> + the provider unit's
                  own title when it carries one. Hidden when nothing new is
                  left (the button restarts at chapter 1 instead). */}
              {isMangaKind && !restart && (
                <MangaNextLine manga={displayAnime} next={resumeEpisodeNumber} watched={numEp} />
              )}
              <p className="mt-1 line-clamp-3 text-[13px] leading-6 text-[var(--text-muted)]">
                {displayAnime.description || 'No description available.'}
              </p>
            </div>

            {/* Row 1, col 2: metadata (desktop only). Row 1's height is
                shared by both columns, so metadata length can never shift
                the row-2 headers relative to each other. */}
            <div className="hidden min-w-0 text-xs leading-5 lg:col-start-2 lg:row-start-1 lg:block">
              <div className="space-y-2">
                <SidebarMeta anime={displayAnime} />
              </div>
            </div>

            {/* Row 2, col 1: episodes/chapters — THE shared header row. */}
            <div className="min-w-0 lg:col-start-1 lg:row-start-2">
              {isMangaKind ? (
                <ChapterList key={displayKey} manga={displayAnime} />
              ) : (
                !isMovie && (
                  <EpisodeList key={displayKey} anime={displayAnime} rawAnime={rawDisplayAnime} />
                )
              )}
            </div>

            {/* Row 2, col 2: related — same grid row as episodes, so headers
                start at exactly the same y. Anime surfaces query type: ANIME;
                manga surfaces query type: MANGA (mixed adaptation relations
                render per-entry with the correct card + route either way). */}
            {displayAnime.identity.anilistId && (
              <div className="hidden min-w-0 text-xs leading-5 lg:col-start-2 lg:row-start-2 lg:block">
                {isMangaKind ? (
                  <MangaRelatedEntriesBlock
                    key={`d-${displayKey}`}
                    anilistId={displayAnime.identity.anilistId}
                    relations={displayAnime.relations}
                    onSelectManga={onSelectRelated}
                    scope="modal-desktop"
                  />
                ) : (
                  <RelatedEntriesBlock
                    key={`d-${displayKey}`}
                    anilistId={displayAnime.identity.anilistId}
                    relations={displayAnime.relations}
                    onSelectAnime={onSelectRelated}
                    scope="modal-desktop"
                  />
                )}
              </div>
            )}
            {/* Mobile stack: metadata, then related in normal flow.
                Separate mobile-only instance (no shared state). The divider
                between metadata rows and Related (stacked layout only)
                renders ONLY while content follows it: loading skeletons
                appear without the divider, final emptiness hides divider
                and block — never a line above nothing. */}
            <div className="min-w-0 space-y-2 border-t border-[var(--border)] pt-4 text-xs leading-5 lg:hidden">
              <SidebarMeta anime={displayAnime} />
              {mobileRelated && (mobileRelated.loading || (mobileRelated.entries?.length ?? 0) > 0) && (
                <div className={mobileRelated.loading ? '' : 'mt-4 border-t border-[var(--border)] pt-4'}>
                  <RelatedEntries
                    entries={mobileRelated.entries}
                    loading={mobileRelated.loading}
                    onSelect={onSelectRelated ? (id) => {
                      const found = mobileRelated.entries?.find(e => e.anime.identity.anilistId === id)
                      if (found) onSelectRelated(found.anime)
                    } : undefined}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

// Manga mirror of the E-line: `Ch <next>` of the chapter Resume will open —
// progress+1 (clamped, computed by the parent's resumeEpisodeNumber) — with
// the provider unit's own title when that unit carries a distinguishing
// name (the provider label IS the chapter name; a bare "Chapter N" adds
// nothing after "Ch N"). Resolution shares ChapterList's resolver and its
// Worker caching. Degradation is honest: the tracker-derived next number is
// a real fact and always shown while reading; with no tracker progress and
// no unit title the line stays hidden (never noise), mirroring the anime
// E-line gate.
function MangaNextLine({ manga, next, watched }: { manga: Anime; next: number; watched: number }) {
  const [unitExtra, setUnitExtra] = useState<string | null>(null)
  useEffect(() => {
    const ctrl = new AbortController()
    let cancelled = false
    resolveChaptersWithFallback(manga, ctrl.signal, {
      mangaTitle: manga.title.romaji,
      mangaEnglish: manga.title.english,
      mangaNative: manga.title.native,
    })
      .then((r) => {
        const u = r.chapters.find(c => c.unitType !== 'volume' && c.number === next)
        let extra: string | null = null
        if (u) {
          const label = (u.label ?? '').trim()
          extra = label && !/^chapter\s*\d*\s*[-–—:.]?\s*$/i.test(label)
            ? label.replace(/^chapter\s*\d*\s*[-–—:.]?\s*/i, '').trim() || null
            : null
        }
        if (!cancelled) setUnitExtra(extra)
      })
      .catch(() => {})
    return () => { cancelled = true; ctrl.abort() }
  }, [manga.identity.internalId, next])
  if (!watched && !unitExtra) return null
  return (
    <p className="mt-2 text-[12px] font-semibold text-[var(--text)]">
      Chapter {next} {unitExtra ? `• ${unitExtra}` : ''}
    </p>
  )
}

function SidebarMeta({ anime }: { anime: Anime }) {
  const displayAnime = anime
  // Manga catalogue rows (AniList staff/tags/endDate). Catalogue display
  // ONLY — these never imply readable chapters (see ChapterList header).
  const isManga = ['MANGA', 'NOVEL', 'ONE_SHOT'].includes(displayAnime.format?.toUpperCase() ?? '')
  const staffLine = isManga && displayAnime.staff?.length
    ? displayAnime.staff.map(s => s.role && s.role.toLowerCase() !== s.name.toLowerCase() ? `${s.name} — ${s.role}` : s.name).join(', ')
    : null
  const tagsLine = isManga && displayAnime.tags?.length
    ? displayAnime.tags.map(t => t.name).join(', ')
    : null
  const endYear = isManga ? displayAnime.endDate?.year : null
  return (
    <>
      {displayAnime.genres.length > 0 && (
        <div className="flex items-baseline gap-1.5">
          <span className="shrink-0 text-[var(--text-faint)]">Genres: </span>
          <span className="no-scrollbar min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-[var(--text)] [scrollbar-width:none]">{displayAnime.genres.join(', ')}</span>
        </div>
      )}
      {tagsLine && (
        <div className="flex items-baseline gap-1.5">
          <span className="shrink-0 text-[var(--text-faint)]">Tags: </span>
          <span className="no-scrollbar min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-[var(--text)] [scrollbar-width:none]">{tagsLine}</span>
        </div>
      )}
      {displayAnime.studios && displayAnime.studios.length > 0 && (
        <div className="flex items-baseline gap-1.5">
          <span className="shrink-0 text-[var(--text-faint)]">Studios: </span>
          <span className="no-scrollbar min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-[var(--text)] [scrollbar-width:none]">{displayAnime.studios.join(', ')}</span>
        </div>
      )}
      {staffLine && (
        <div className="flex items-baseline gap-1.5">
          <span className="shrink-0 text-[var(--text-faint)]">Authors: </span>
          <span className="no-scrollbar min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-[var(--text)] [scrollbar-width:none]">{staffLine}</span>
        </div>
      )}
      {formatLabel(displayAnime.format) && (
        <div className="flex items-baseline gap-1.5">
          <span className="shrink-0 text-[var(--text-faint)]">Format: </span>
          <span className="no-scrollbar min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-[var(--text)] [scrollbar-width:none]">{formatLabel(displayAnime.format)}</span>
        </div>
      )}
      {statusLabel(displayAnime.status) && (
        <div className="flex items-baseline gap-1.5">
          <span className="shrink-0 text-[var(--text-faint)]">Status: </span>
          <span className="no-scrollbar min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-[var(--text)] [scrollbar-width:none]">{statusLabel(displayAnime.status)}</span>
        </div>
      )}
      {displayAnime.year && (
        <div className="flex items-baseline gap-1.5">
          <span className="shrink-0 text-[var(--text-faint)]">Year: </span>
          <span className="no-scrollbar min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-[var(--text)] [scrollbar-width:none]">{displayAnime.year}{displayAnime.season ? ` • ${displayAnime.season.charAt(0) + displayAnime.season.slice(1).toLowerCase()}` : ''}{endYear && endYear !== displayAnime.year ? ` – ${endYear}` : ''}</span>
        </div>
      )}
    </>
  )
}

function RelatedEntriesBlock({ anilistId, relations, onSelectAnime, showsOnly, mangaOnly, hideHeader, scope }: { anilistId: number; relations: Anime['relations']; onSelectAnime?: (anime: Anime) => void; showsOnly?: boolean; mangaOnly?: boolean; hideHeader?: boolean; scope?: string }) {
  const { entries, loading } = useRelatedEntries(scope ? `${scope}:${anilistId}` : anilistId, relations, 'ANIME')
  // In-place swap needs the full Anime object, not just the id.
  const byId = new Map((entries ?? []).map(e => [e.anime.identity.anilistId!, e.anime]))
  return <RelatedEntries entries={entries} loading={loading} showsOnly={showsOnly} mangaOnly={mangaOnly} hideHeader={hideHeader} onSelect={onSelectAnime ? (id) => {
    const found = byId.get(id)
    if (found) onSelectAnime(found)
  } : undefined} />
}

/** Manga-surface related block: queries type: MANGA, renders Related Manga + Related Anime. */
export function MangaRelatedEntriesBlock({ anilistId, relations, onSelectManga, scope }: { anilistId: number; relations: Anime['relations']; onSelectManga?: (anime: Anime) => void; scope?: string }) {
  const { entries, loading } = useRelatedEntries(scope ? `${scope}:${anilistId}` : anilistId, relations, 'MANGA')
  const byId = new Map((entries ?? []).map(e => [e.anime.identity.anilistId!, e.anime]))
  return <RelatedEntries entries={entries} loading={loading} onSelect={onSelectManga ? (id) => {
    const found = byId.get(id)
    if (found) onSelectManga(found)
  } : undefined} />
}
