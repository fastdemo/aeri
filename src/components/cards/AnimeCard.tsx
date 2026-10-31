import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import type { Anime } from '../../types/anime'
import { getPrimaryTitle } from '../../lib/titles'
import { cleanEpisodeTitle, getAiredProgressPercent, getDisplayEpisodeNumber, getStreamingEpisodeTitle, sanitizeAnimeForDisplay } from '../../lib/episodes'
import { findFallbackEpisode } from '../../lib/episodes'
import { useKitsuEpisodes } from '../../hooks/useKitsuEpisodes'
import { formatLabel } from '../../lib/mediaLabels'
import { Icon } from '../ui/Icon'
import { useTracking } from '../../contexts/TrackingContext'
import { getReadPos } from '../../storage/db'
import { detailPath } from '../../hooks/useDetailOpen'
import { useNearViewport } from '../../hooks/useNearViewport'
import { planResume } from '../../lib/resume'
import { CARD_ART_ASPECT, CARD_ART_DIMS, CARD_WIDTH } from './cardGeometry'

type Variant = 'default' | 'continue' | 'compact'

export type MediaKind = 'anime' | 'manga'

function kindOf(anime: Anime, override?: MediaKind): MediaKind {
  if (override) return override
  const f = anime.format?.toUpperCase() ?? ''
  return f === 'MANGA' || f === 'NOVEL' || f === 'ONE_SHOT' ? 'manga' : 'anime'
}

function QuickMenu({ anime }: { anime: Anime }) {
  const [open, setOpen] = useState(false)
  const { isAuthenticated, updateProgress, updateStatus } = useTracking()
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        btnRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open ])

  if (!isAuthenticated) return null
  const total = anime.episodes && anime.episodes > 0 ? anime.episodes : undefined
  const current = anime.progress?.episode ?? 0

  const run = (fn: () => Promise<unknown>) => {
    setOpen(false)
    btnRef.current?.focus()
    fn().catch(() => {})
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={`Actions for ${getPrimaryTitle(anime)}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          e.preventDefault()
          setOpen((v) => !v)
        }}
        // BARE DOTS — no glass chip, no border — with a DOUBLE drop-shadow
        // for contrast on bright thumbnails. 24px box.
        // z-40: the row's scroll arrow is z-30 (D141) and covers the right
        // edge of a partially visible continue card. The ⋮ is a legitimate
        // 24px control in that strip and must stay clickable; only the
        // large centre play glyph is meant to lose to the arrow.
        // The glyphs and dots are hover/focus-only at EVERY width; touch
        // never shows them (tapping a card opens its preview instead).
        // The ⋮ stays OUTSIDE the frame (menu + shadow
        // must not clip), so its ART-hover reveal is driven from
        // globals.css: `.group\/card:has(.group\/art:hover)
        // .card-dots-trigger` — the card ROOT carries `group/card`, the
        // art div carries `group/art`, and hovering that (the thumbnail)
        // reveals the ⋮. Hovering the bottom caption block never does.
        // `aria-expanded:opacity-100` keeps the trigger visible while its
        // own menu is open (the pointer often moves down onto the menu,
        // which rests outside the art hover region). Keyboard: the
        // `:focus-within` branch in globals.css reveals regardless of
        // caption/art geometry.
        className={`absolute right-1 top-1 z-40 grid h-6 w-6 place-items-center rounded-full card-dots-trigger hover-only-control text-[var(--text)] opacity-0 group-focus-visible/card:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100 transition duration-200 hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-strong)] [filter:drop-shadow(0_1px_3px_rgba(0,0,0,1))_drop-shadow(0_3px_18px_rgba(0,0,0,0.9))]`}
      >
        <Icon name="three-dots-vertical" size={12} />
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation()
              e.preventDefault()
              setOpen(false)
            }}
            className="fixed inset-0 z-20 cursor-default bg-transparent"
          />
          {/* Same glass language as the profile popup (HeaderPopup):
              translucent bg + backdrop-blur-2xl + deep shadow. The old
              solid surface-elevated panel read as an opaque grey slab. */}
          <div
            role="menu"
            aria-label={`Actions for ${getPrimaryTitle(anime)}`}
            className="anim-pop-in absolute right-1 top-7 z-30 w-44 overflow-hidden rounded-xl border border-[var(--border)] bg-[color-mix(in_srgb,var(--bg)_70%,transparent)] shadow-[0_16px_48px_var(--shadow)] backdrop-blur-2xl"
            onClick={(e) => {
              e.stopPropagation()
              e.preventDefault()
            }}
          >
            <div className="p-1">
            <button
              type="button"
              role="menuitem"
              onClick={() => run(async () => {
                if (total) await updateProgress(anime, total, { manual: true })
                else if (current > 0) await updateProgress(anime, current, { manual: true })
                await updateStatus(anime, 'completed')
              })}
              className="flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--text)_10%,transparent)]"
            >
              Mark as watched
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => run(async () => updateStatus(anime, 'on_hold'))}
              className="flex w-full items-center rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--text)_10%,transparent)]"
            >
              Remove from Continue Watching
            </button>
            </div>
          </div>
        </>
      )}
    </>
  )
}

export function AnimeCard({
  anime,
  variant = 'default',
  onSelect,
  fullWidth,
  mediaKind,
  disableLink,
  hideHoverCaption,
  priority,
}: {
  anime: Anime
  variant?: Variant
  onSelect?: (a: Anime) => void
  fullWidth?: boolean
  /** Overrides auto-detection from format. Manga cards pass 'manga'. */
  mediaKind?: MediaKind
  /** Render static content (no inner <Link>). For use inside an outer <a>
      (e.g. RelatedEntries grids) where a nested anchor would be invalid HTML
      and cause hydration errors + ambiguous taps on mobile. */
  disableLink?: boolean
  /** D113: Related ANIME tiles show no hover caption at
      all — name and meta both live outside the art (name in the aria-label
      and the grid's meta line below). Manga tiles keep their caption. */
  hideHoverCaption?: boolean
  /** Above-the-fold tile: skip the proximity gate and load its art eagerly
      at high network priority (Home's first row). Every other card waits
      until it is near the viewport — see useNearViewport. */
  priority?: boolean
}) {
  const kind = kindOf(anime, mediaKind)
  const isManga = kind === 'manga'
  const navigate = useNavigate()
  const { isAuthenticated } = useTracking()
  const width = fullWidth
    ? CARD_WIDTH.full
    : variant === 'compact'
      ? CARD_WIDTH.compact
      : CARD_WIDTH.rail

  // Manga uses portrait cover art; anime uses landscape backdrop art.
  // All other card language (ring, hover, caption, progress) is shared.
  // Shape lives in cardGeometry.ts so skeletons cannot drift from cards.
  const fallbackSrc = isManga
    ? (anime.coverImage || anime.backdropImage || '')
    : (anime.backdropImage || anime.coverImage || '')
  const artAspect = CARD_ART_ASPECT[kind]
  const artDims = CARD_ART_DIMS[kind]
  const primaryTitle = getPrimaryTitle(anime)
  // ART LOADING: the tile only asks for its artwork once
  // it is near the viewport. `loading="lazy"` alone queued ~50 full-size
  // banners on a cold Home (every row is a scroller and Chrome's lazy
  // distance spans the whole feed), so in-view tiles stayed blank behind
  // offscreen downloads. `priority` tiles (Home's first row) skip the gate
  // and load eagerly at high priority.
  const { ref: artRef, near: artNear } = useNearViewport<HTMLDivElement>({ priority })
  // Broken banner URLs (deleted AniList art) fall back ONCE to the same
  // record's other image before giving up — never a fabricated image.
  const [imgSrc, setImgSrc] = useState(fallbackSrc)
  const triedAlternateArt = useRef(false)
  const [artLoaded, setArtLoaded] = useState(false)
  useEffect(() => {
    setImgSrc(fallbackSrc)
    setArtLoaded(false)
    triedAlternateArt.current = false
  }, [fallbackSrc])
  const progressEp = anime.progress?.episode ?? 0
  const displayEp = progressEp > 0 ? getDisplayEpisodeNumber(anime, progressEp) : 0
  // CONTINUE = NEXT EPISODE: the caption + play target both point at
  // progress+1 (episode 1 for an unstarted show) — watching 20 episodes
  // resumes at 21. Episode NAMES and the true episode count come from the
  // ANILIST RECORD ALWAYS — the tracker (MAL or AniList) is only the progress
  // source. The tracker's thin list copy rarely carries streamingEpisodes,
  // which is why names used to appear only after a hover prewarm filled the
  // cache. Fetching the full AniList record on mount (shared cache, inflight
  // dedupe) makes the name deterministic for every card.
  const [episodeMeta, setEpisodeMeta] = useState<Anime | null>(null)
  useEffect(() => {
    if (variant !== 'continue' || isManga) return
    const aid = anime.identity.anilistId
    const mid = anime.identity.malId
    if (!(aid && !Number.isNaN(aid)) && !mid) return
    // ANILIST-FIRST: anilist-… id when present, else AniList's idMal lookup
    // (the MAL numeric id is just the resolve key; the record is AniList's).
    const metaId = aid && !Number.isNaN(aid) ? `anilist-${aid}` : `mal-${mid}`
    let cancelled = false
    void import('../../providers/metadata/anilistMetadata')
      .then(m => m.getAnimePatient(metaId))
      .then(full => { if (!cancelled && full) setEpisodeMeta(full) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [variant, isManga, anime.identity.anilistId, anime.identity.malId])
  const meta = episodeMeta ?? anime
  // DISPLAY RECORD: the fetched AniList record must pass
  // the SAME display guards as every other surface. Code Geass R2's AniList
  // entry carries season 1's 25 Crunchyroll rows — reading them raw showed
  // S1 episode 4's name on an R2 continue card. sanitizeAnimeForDisplay
  // drops that list, so the caption is either the correct AniList name, a
  // Kitsu name (below), or an honest "Episode N".
  const displayMeta = useMemo(
    () => (episodeMeta ? sanitizeAnimeForDisplay(episodeMeta) : anime),
    [episodeMeta, anime],
  )
  const epTotal = typeof meta.episodes === 'number' && meta.episodes > 0 ? meta.episodes : 0
  // AIRED DENOMINATOR: the continue bar measures against episodes that HAVE
  // AIRED, not the planned season total, so a caught-up airing show reads
  // full instead of a quarter-full. Uses the enriched AniList record when it
  // has landed (MAL list copies carry no airing schedule) and falls back to
  // the list record until then.
  const barPercent = getAiredProgressPercent(displayMeta, progressEp, epTotal, anime.progress?.percent ?? 0)
  // RESUME / RESTART: the same pure rule as the preview
  // card. A part-watched show opens progress+1; a show with nothing new
  // left (finished, or airing-and-caught-up) restarts at episode 1 instead
  // of pointing the glyph at a finale — or at an episode that has not aired.
  const resume = planResume({
    progress: progressEp,
    total: epTotal,
    nextAiringEpisode: meta.nextAiringEpisode?.episode ?? null,
  })
  const watchEp = resume.target
  const displayWatchEp = getDisplayEpisodeNumber(meta, watchEp)
  // KITSU FALLBACK: only when the AniList record resolved
  // AND the display guards discard its episode metadata (CG R2). Gating on
  // `episodeMeta` keeps cold Home loads at zero extra requests: thin
  // tracker copies never trigger a Kitsu lookup, and cards whose AniList
  // list survives never touch it either (the hook decides per record).
  const kitsuGate = variant === 'continue' && !isManga
    ? (episodeMeta ?? (anime.streamingEpisodes?.length ? anime : null))
    : null
  const kitsu = useKitsuEpisodes(kitsuGate, kitsuGate)
  const kitsuEpisode = findFallbackEpisode(kitsu.episodes, watchEp)
  const watchName = getStreamingEpisodeTitle(displayMeta, watchEp)
    ?? (kitsuEpisode?.title ? cleanEpisodeTitle(kitsuEpisode.title) : null)
  // Watch target id — ANILIST-FIRST, preferring the full AniList record's
  // canonical id when it arrived; MAL is a fallback key only.
  const watchId = (() => {
    const w = episodeMeta ?? anime
    return w.identity.anilistId && !Number.isNaN(w.identity.anilistId)
      ? `anilist-${w.identity.anilistId}`
      : w.identity.internalId
  })()
  // Manga READ target — same next-unit semantics as the
  // anime play button: the first unread chapter — progress+1, clamped to
  // the tracker's chapter count — or 'first' for an unstarted OR exhausted
  // title (Netflix restart). The Read route contract is the same one
  // DetailModal's Resume uses: 'ch-N' targets unit number N, 'first' the
  // oldest provider unit.
  const readTarget = (() => {
    const chTotal = typeof anime.chapters === 'number' && anime.chapters > 0 ? anime.chapters : 0
    const plan = planResume({ progress: progressEp, total: chTotal })
    if (plan.restart || progressEp <= 0) return 'first'
    return `ch-${plan.target}`
  })()
  // ONE overlay language for EVERY card on EVERY surface (home rows, /anime,
  // /manga browse, My List, Search, profile, related tiles — they all render
  // AnimeCard). A background-free glyph — play for anime, book for manga —
  // 30px, 25% larger than the original 24px box. No shadow and no
  // self-scale: the dark ~50% card scrim + 8px blur behind them (the hover
  // treatment above) carries legibility on bright art.
  // HOVER/FOCUS-ONLY AT EVERY WIDTH: no md: gate and no touch fallback — the
  // glyph is invisible until the card is hovered or focus is within it, on
  // desktop and phone alike. Tap still opens the preview card; play/read
  // live in the preview on touch. The hover trigger is the ART div
  // (`group-hover/art` — hovering a continue card's bottom caption must not
  // reveal the treatment); the card ROOT carries `group/card`, whose
  // focus-within keeps keyboard reveal.
  // D113 (revised 2026-10-23): the glyph is DEAD CENTER on every
  // card, at every size, for both kinds — no exceptions. The narrow-tile
  // overlap fix lives in the hover band instead (bottom gradient gets
  // tighter, meta line drops) and applies to ANIME tiles only: portrait
  // manga art is tall enough that the collision never existed there.
  // TOUCH POLICY: hover affordances DO NOT EXIST on
  // devices without hover — no tap fallback, no reveal. Tailwind v4 already
  // media-gates `group-hover/*` reveal; `hover-only-control` (globals.css)
  // also removes pointer hit-testing there, so the invisible glyph can
  // never intercept a tap meant for the card. `group-focus-visible` keeps
  // KEYBOARD reveal working; pointer focus (tap) never matches it, so
  // tapping a card no longer flashes the hover treatment on phones.
  const HOVER_GLYPH =
    'absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 grid place-items-center text-[var(--text)] hover-only-control ' +
    'opacity-0 group-hover/art:opacity-100 group-focus-visible/card:opacity-100 focus-visible:opacity-100 ' +
    'transition duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-strong)]'
  // the hover glyph is 25% SMALLER than the 30px box
  // (30 → 22) and the manga read glyph keeps the SAME size as play. The
  // 30px art read as a billboard over the thumbnail.
  const GLYPH_ICON_PX = 22
  const BOOK_GLYPH_ICON_PX = GLYPH_ICON_PX
  // Manga continue caption: provider's own unit label from the IDB read
  // position (e.g. "Volume 3", "Chapter 12"). Never "E12" for manga, never
  // a volume renamed to a chapter. Falls back to tracker progress text.
  const [mangaUnitLabel, setMangaUnitLabel] = useState<string | null>(null)
  useEffect(() => {
    // GUEST MODE (owner 2026-10-28): no local read-position lookup while
    // signed out — a guest's card language comes from the record only.
    if (variant !== 'continue' || !isManga || !isAuthenticated) return
    let cancelled = false
    getReadPos(anime.identity.internalId.replace(/^read:/, ''))
      .then(pos => { if (!cancelled && pos?.chapterLabel) setMangaUnitLabel(pos.chapterLabel) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [variant, isManga, anime.identity.internalId, isAuthenticated])

  // Captions exist ONLY on Continue Watching cards (below). All other
  // rows are clean thumbnails; name/year/category appear in the hover
  // overlay on desktop (see below).
  const hoverMeta = `${anime.year ?? ''}${anime.year ? ' • ' : ''}${formatLabel(anime.format) ?? anime.format ?? ''}${anime.genres?.[0] ? ` • ${anime.genres[0]}` : ''}`

  // Card edge: a real 1px CSS border (border-box, painted INSIDE the
  // frame). Unlike Tailwind's outside ring (box-shadow overhangs the
  // border box and gets its left 1px cut by edge-flush scrollers on
  // Home/Profile — the chop), a real border can never extend past the
  // box, so it stays fully visible on every row at every viewport.
  // Visible by design: --border-strong on dark surfaces.
  // FIX-ME (engine, 2026-10-18 re-verified): `display: -webkit-box`
  // computes to `flow-root` engine-wide, which kills the LEGACY box
  // renderer, but Chromium 130+ still clamps via the unprefixed
  // -webkit-line-clamp on normal blocks — silently (no ellipsis) unless
  // the new-model `line-clamp: N ellipsis` is ALSO declared and the
  // authored display chain is -webkit-box (plain block aliases the
  // ellipsis off). globals.css .clamp-* carries both; the line-clamp-*
  // utilities below only work because the plain classes won the cascade
  // or nothing overrides them — see globals.css for the full mechanism.
  const content = (
    // the hover treatment must trigger
    // from the THUMBNAIL only — hovering the bottom caption block of a
    // continue card never reveals the scrim/glyph/⋮. So the hover trigger
    // is the ART div via `group/art` (the thumbnail), NOT the card root;
    // the root keeps `group/card` for the FOCUS reveal (keyboard focus on
    // the card must still surface the controls: group-focus-within/card)
    // and as the has() ancestor for the ⋮ — the ⋮ QuickMenu stays a
    // content-level sibling of the frame (outside overflow-hidden, so its
    // dropdown + shadow never clip) and reveals through the
    // `.card-dots-trigger` rule in globals.css (pure-CSS `:has()`
    // bridging the sibling gap).
    <div className="relative w-full min-w-0 flex-shrink-0">
      <div
        className={`relative w-full min-w-0 flex-shrink-0 overflow-hidden rounded-[6px] bg-[var(--surface)] ${width}`}
      >
      <div ref={artRef} className={`card-art group/art relative ${artAspect} w-full min-w-0 overflow-hidden bg-[var(--surface-elevated)] @container`}>
        {/* Quiet placeholder while the art is gated/loading — a flat empty
            box read as a broken card. Same final box, so nothing shifts.
            SCROLL COST: this pulse only renders when the card is actually near the
            viewport. An offscreen card is never visible, so its skeleton
            does not need to animate — and 80+ simultaneous infinite
            animations were the single largest scroll cost on Home
            (measured: 6.61s → 0.86s main-thread task time with the pulse
            animations off). The art div's own background is the same
            colour, so the resting state is unchanged. */}
        {!artLoaded && artNear && (
          <div aria-hidden className="absolute inset-0 animate-pulse bg-[var(--surface-elevated)]" />
        )}
        {artNear && imgSrc && (
          <img
            src={imgSrc}
            alt={primaryTitle}
            loading={priority ? 'eager' : 'lazy'}
            fetchPriority={priority ? 'high' : 'low'}
            decoding="async"
            width={artDims.width}
            height={artDims.height}
            onError={() => {
              const alternate = isManga ? anime.backdropImage : anime.coverImage
              if (!triedAlternateArt.current && alternate && alternate !== imgSrc) {
                triedAlternateArt.current = true
                setImgSrc(alternate)
                return
              }
              // No usable art left: stop the placeholder pulse (a permanently
              // pulsing empty tile reads as perpetual loading).
              setImgSrc('')
              setArtLoaded(true)
            }}
            onLoad={(e) => {
              e.currentTarget.classList.add('is-loaded')
              setArtLoaded(true)
            }}
            className="img-fade relative h-full w-full object-cover opacity-[0.96] transition group-hover/art:opacity-100"
          />
        )}

        {/* HOVER TREATMENT: the old bottom-up gradient
            is REPLACED by a uniform whole-card treatment — the card
            darkens (~50% of the theme bg) and frosts (backdrop-blur
            ~8px) on hover, with the centered play/read glyph staying on
            top. Fades in via opacity so the blur eases rather than
            snapping. Same on EVERY card — it lives in the shared card.
            2026-10-20: triggered by the ART group only (continue cards'
            caption hover must not trigger it).
            2026-10-27 (scroll perf): the blur is applied ONLY while the
            card is hovered, and only on devices that can hover. An
            always-mounted `backdrop-filter` gave every card its own
            compositing layer (108 on Home) and cost ~18% of scroll
            main-thread time; touch devices never hover, so they no
            longer pay for a treatment they cannot see. The scrim itself
            keeps its 200ms opacity fade, so the visible hover result is
            the same. */}
        <div className="card-frost pointer-events-none absolute inset-0 bg-[color-mix(in_srgb,var(--bg)_50%,transparent)] opacity-0 transition-opacity duration-200 group-hover/art:opacity-100" />

        {/* Hover affordance — UNIFIED: play for anime,
            book for manga, on EVERY card (default + continue + compact).
            Hover/focus-revealed at pointer widths, always visible on
            touch. Tap → straight to the next watch/read target; Artwork
            taps elsewhere still open the floating preview. The cursor /
            title text overlay (below) is a SEPARATE affordance. */}
        {!isManga && (
          <button
            type="button"
            aria-label={`Play episode ${watchEp} of ${primaryTitle}`}
            onClick={(e) => {
              e.stopPropagation()
              e.preventDefault()
              navigate(`/watch/${watchId}/${watchEp}`)
            }}
            className={HOVER_GLYPH}
          >
            <Icon name="play-fill" size={GLYPH_ICON_PX} />
          </button>
        )}
        {isManga && (
          <button
            type="button"
            aria-label={`Continue reading ${primaryTitle}`}
            onClick={(e) => {
              e.stopPropagation()
              e.preventDefault()
              navigate(`/read/${anime.identity.internalId}/${readTarget}`)
            }}
            className={HOVER_GLYPH}
          >
            {/* Open-book art at the play button's size. */}
            <Icon name="book-open" size={BOOK_GLYPH_ICON_PX} />
          </button>
        )}

        {/* Title overlay on hover — name + year + format + first genre.
            Desktop only (touch uses tap → detail). CONTINUE cards show the
            same band, but the second line is the NEXT episode/chapter name
            (the play/read target) instead of the year/format line — the
            caption block under the card is gone, so this is the only place
            the episode lives (owner 2026-10-29).
            Rendered ONLY on devices that
            can actually hover: a `hidden` + `md:block` overlay still sits in
            layout on touch (opacity-0, zero-size) and its text reports
            getBoundingClientRect().left = 0, which trips overflow/clip
            audits and can paint during scroll. can-hover gate renders it
            only where a real hover exists (see globals.css).
            The band NO LONGER paints its own bottom-up
            gradient. It doubled the whole-card scrim into a heavy strip with
            a hard horizontal edge — the blur looked like an artifact on both
            anime and manga tiles. One uniform hover treatment carries the
            text instead (the player's own bottom gradient is unrelated). */}
        {!hideHoverCaption && (
          <div
            className={`card-hover-caption absolute inset-x-0 bottom-0 hidden translate-y-1 p-2 opacity-0 transition can-hover:block group-hover/art:translate-y-0 group-hover/art:opacity-100 ${!isManga ? '@max-[160px]:py-1' : ''}`}
          >
            <p className="line-clamp-1 text-[11px] font-medium leading-tight text-[var(--text)]">
              {primaryTitle}
            </p>
            {/* D113 (revised): on NARROW ANIME tiles this meta line
                only lengthens the band toward the dead-center glyph — and
                related grids already print relation/format/episodes UNDER
                the card. Manga bands are untouched (portrait art never
                collides). */}
            {variant === 'continue' ? (
              <p className={`truncate text-[10px] text-[var(--text-muted)] ${!isManga ? '@max-[160px]:hidden' : ''}`}>
                {isManga
                  ? (mangaUnitLabel ?? `Chapter ${displayEp || progressEp}`)
                  : (watchName ? watchName : `Episode ${displayWatchEp}`)}
              </p>
            ) : hoverMeta ? (
              <p className={`truncate text-[10px] text-[var(--text-muted)] ${!isManga ? '@max-[160px]:hidden' : ''}`}>{hoverMeta}</p>
            ) : null}
          </div>
        )}

        {/* Continue Watching progress — a FLOATING pill a few px above the
            thumbnail's bottom edge, inset from both sides (owner 2026-10-29).
            It hides on art hover so the hover caption (title + next episode)
            can take the bottom band. `.continue-progress` keeps it visible
            while a row is scrolling (scroll-quiet), where the caption is
            suppressed — a card passing under a parked cursor must not lose
            its progress.
            D155: back to the theme-ink NEON pill (15% `--text` track, `--text`
            fill, 6px `--text` glow) — the D154 fixed-neutral palette and its
            8px track frost are gone. Contrast is now carried by a BOTTOM
            SCRIM behind the bar, the same theme gradient the Watch page's
            episode thumbnails use (`from var(--bg)` → transparent): the bar
            always sits on a bed of the page's own colour, so a white bar on a
            white thumbnail (dark theme) or a near-black bar on a black one
            (light theme) can no longer disappear, and the theme-ink neon look
            survives. The scrim is a child of the pill wrapper so it inherits
            the same hover fade and the same scroll-quiet pin. */}
        {variant === 'continue' && anime.progress && (
          <div
            className="continue-progress pointer-events-none absolute inset-x-0 bottom-0 z-10 h-10 transition-opacity duration-200 group-hover/art:opacity-0"
            aria-hidden
          >
            <div
              data-continue-scrim
              className="continue-scrim absolute inset-0"
            />
            <div
              data-continue-bar
              className="absolute inset-x-2 bottom-2 h-[3px] rounded-full bg-[color-mix(in_srgb,var(--text)_15%,transparent)]"
            >
              <div className="h-full rounded-full bg-[var(--text)] shadow-[0_0_6px_var(--text)] transition-[width] duration-300" style={{ width: `${Math.min(100, Math.max(0, barPercent))}%` }} />
            </div>
          </div>
        )}

        {/* CONTINUE cards previously carried a persistent play glyph; the SAME
            unified glyph (above) covers them — hover-revealed at pointer
            widths like every other card, with the same next-episode target. */}
      </div>

      {/* Soft frame (hairline + short inner glow — see .frame-soft). Cards
          cannot carry a per-tile backdrop blur: 100+ backdrop captures
          tiled the artwork and cost paint time on Home. The hero keeps the
          literal frosted rim; cards match it visually and frost fully on
          hover via the existing whole-card treatment.
          CONTINUE CARDS now use the SAME .frame-soft frame as every other
          card (2026-10-29): the old caption block under the artwork — the
          reason for the crisp-only frame — is gone. */}
      <div aria-hidden className="frame-soft z-20" />
      </div>
      {/* The ⋮ QuickMenu stays a SIBLING of the frame
          (content-level) on purpose — its dropdown + 48px shadow must not
          clip inside the frame's overflow-hidden. Its REVEAL is driven
          from the thumbnail via the `.card-dots-trigger` globals.css rule
          (root `group/card` :has(art `group/art` :hover)) so hovering the
          bottom caption block NEVER opens the controls. */}
      {variant === 'continue' && <QuickMenu anime={anime} />}
    </div>
  )

  // Hover/focus prewarm: the user is demonstrably navigating toward this
  // title (card interaction precedes route change by ~100-500ms). Warms the
  // shared media cache so the destination reveals with metadata ready.
  // No-op without an id; shared cache + inflight make repeats free.
  // Type-scoped: manga cards prewarm the MANGA record, anime cards the
  // ANIME record — never cross-type (same numeric id, different entity).
  const prewarmId = anime.identity.anilistId ?? null
  const prewarm = () => {
    if (!prewarmId || Number.isNaN(prewarmId)) return
    try {
      void import('../../providers/metadata/anilistMetadata').then((m) => {
        if (isManga) m.anilistMetadataProvider.getManga(`anilist-${prewarmId}`).catch(() => {})
        else m.anilistMetadataProvider.getAnime(`anilist-${prewarmId}`).catch(() => {})
      })
    } catch {}
  }

  if (onSelect) {
    return (
      <button
        onClick={() => onSelect(anime)}
        onMouseEnter={prewarm}
        onFocus={prewarm}
        className={`group/card min-w-0 shrink-0 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-strong)] ${fullWidth ? 'w-full' : ''} ${width}`}
        aria-label={`Open ${primaryTitle}`}
      >
        {content}
      </button>
    )
  }

  if (disableLink) {
    return (
      <div className={`group/card min-w-0 ${fullWidth ? 'w-full' : ''}`}>
        {content}
      </div>
    )
  }

  // Fallback link (no onSelect host): land on the floating detail card via
  // the type-safe detail path (a manga card must never hit the anime route
  // — same numeric id under ANIME vs MANGA is a DIFFERENT entity), and
  // carry the D097 nav state (current page as background + this record) so
  // the card floats over THIS page and opens instantly — identical to what
  // useDetailOpen does for onSelect hosts. Raw <Link> without state would
  // swap the background to Home and re-shuffle it — the "page refresh"
  // users saw.
  const linkTo = detailPath(anime)
  const location = useLocation()

  return (
    <Link
      to={linkTo}
      state={{ background: { pathname: location.pathname, search: location.search }, anime }}
      onMouseEnter={prewarm}
      onFocus={prewarm}
      aria-label={`Open ${primaryTitle}`}
      className={`group/card focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-strong)] block ${fullWidth ? 'w-full' : ''}`}
    >
      {content}
    </Link>
  )
}
