import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import type { Anime } from '../../types/anime'
import { getPrimaryTitle } from '../../lib/titles'
import { getDisplayEpisodeNumber, getStreamingEpisodeTitle } from '../../lib/episodes'
import { formatLabel } from '../../lib/mediaLabels'
import { Icon } from '../ui/Icon'
import { useTracking } from '../../contexts/TrackingContext'
import { getReadPos } from '../../storage/db'
import { detailPath } from '../../hooks/useDetailOpen'

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
        // OWNER (2026-10-18, same style as the play/read glyphs): bare
        // dots — no glass chip, no border — with a DOUBLE drop-shadow for
        // contrast on bright thumbnails, and the same hover-gating as the
        // glyphs (permanently visible on touch widths; hover/focus only at
        // pointer widths). 24px box as restored.
        className={`absolute right-1 top-1 z-20 grid h-6 w-6 place-items-center rounded-full text-[var(--text)] opacity-100 md:opacity-0 md:group-hover/card:opacity-100 md:group-focus-within/card:opacity-100 md:focus-visible:opacity-100 transition duration-200 hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-strong)] [filter:drop-shadow(0_1px_3px_rgba(0,0,0,1))_drop-shadow(0_3px_18px_rgba(0,0,0,0.9))]`}
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
                if (total) await updateProgress(anime, total)
                else if (current > 0) await updateProgress(anime, current)
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
}) {
  const kind = kindOf(anime, mediaKind)
  const isManga = kind === 'manga'
  const navigate = useNavigate()
  const width = fullWidth
    ? 'w-full'
    : variant === 'compact'
      ? 'w-[148px] sm:w-[180px]'
      : 'w-[168px] sm:w-[200px] lg:w-[236px]'

  // Manga uses portrait cover art; anime uses landscape backdrop art.
  // All other card language (ring, hover, caption, progress) is shared.
  const fallbackSrc = isManga
    ? (anime.coverImage || anime.backdropImage || '')
    : (anime.backdropImage || anime.coverImage || '')
  const artAspect = isManga ? 'aspect-[3/4]' : 'aspect-[16/9]'
  const artDims = isManga ? { width: 300, height: 400 } : { width: 400, height: 225 }
  const primaryTitle = getPrimaryTitle(anime)
  const progressEp = anime.progress?.episode ?? 0
  const displayEp = progressEp > 0 ? getDisplayEpisodeNumber(anime, progressEp) : 0
  // CONTINUE = NEXT EPISODE (owner 2026-10-18): "if I watched 20 episodes,
  // the card should show episode 21". Caption + play target both point at
  // progress+1 (episode 1 for an unstarted show). Episode NAMES and the
  // true episode count come from the ANILIST RECORD ALWAYS — the tracker
  // (MAL or AniList) is only the progress source. The tracker's thin list
  // copy rarely carries streamingEpisodes, which is why names worked "half
  // the time": they appeared only after a hover prewarm filled the cache.
  // Fetching the full AniList record on mount (shared cache, inflight
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
  const epTotal = typeof meta.episodes === 'number' && meta.episodes > 0 ? meta.episodes : 0
  const nextEpRaw = progressEp > 0 ? progressEp + 1 : 1
  const watchEp = epTotal > 0 ? Math.min(nextEpRaw, epTotal) : nextEpRaw
  const displayWatchEp = getDisplayEpisodeNumber(meta, watchEp)
  const watchName = getStreamingEpisodeTitle(meta, watchEp)
  // Watch target id — ANILIST-FIRST, preferring the full AniList record's
  // canonical id when it arrived; MAL is a fallback key only.
  const watchId = (() => {
    const w = episodeMeta ?? anime
    return w.identity.anilistId && !Number.isNaN(w.identity.anilistId)
      ? `anilist-${w.identity.anilistId}`
      : w.identity.internalId
  })()
  // Manga READ target (owner 2026-10-18 — same next-unit semantics as the
  // anime play button): the first unread chapter — progress+1, clamped to
  // the tracker's chapter count — or 'first' for an unstarted title. The
  // Read route contract is the same one DetailModal's Resume uses:
  // 'ch-N' targets unit number N, 'first' the oldest provider unit.
  const readTarget = (() => {
    if (progressEp <= 0) return 'first'
    const chTotal = typeof anime.chapters === 'number' && anime.chapters > 0 ? anime.chapters : 0
    const n = chTotal > 0 ? Math.min(progressEp + 1, chTotal) : progressEp + 1
    return `ch-${n}`
  })()
  // OWNER (2026-10-18 evening): one overlay language for EVERY card on
  // EVERY surface (home rows, /anime, /manga browse, My List, Search,
  // profile, related tiles — they all render AnimeCard). A background-free
  // glyph — play for anime, book for manga — 30px (owner: "+25%"). The
  // DOUBLE drop-shadow is bigger and softer than the first pass (owner: it
  // was "too much"): a tight dark contact layer that keeps legibility on
  // bright art, plus a wide, much more transparent halo. Hover-gated at
  // pointer widths (md+), permanently visible on touch where hover does
  // not exist and the tap IS the affordance. A tap goes straight through:
  // play → /watch/<next episode>, book → /read/<next chapter>; every
  // other part of the card still opens the floating preview.
  const HOVER_GLYPH =
    'absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 grid place-items-center text-[var(--text)] ' +
    'opacity-100 md:opacity-0 md:group-hover/card:opacity-100 md:group-focus-within/card:opacity-100 md:focus-visible:opacity-100 ' +
    'transition duration-200 hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-strong)] ' +
    '[filter:drop-shadow(0_1px_3px_rgba(0,0,0,0.85))_drop-shadow(0_4px_30px_rgba(0,0,0,0.6))]'
  const GLYPH_ICON_PX = 30
  // INK PARITY (owner 2026-10-18: "make sure the read icon filled is the
  // same size as the play icon"; 2026-10-19: the FILLED art was reverted
  // to the hollow `book` — the MEASUREMENTS hold for both arts): both
  // icons share the 16-unit viewBox, but their DRAWN ink differs wildly
  // — bootstrap play-fill ink is 8×9 (≈56% → 16.9px at a 30px box) while
  // the book art spans the FULL 16×13.1 (→ 30px at the same box, nearly
  // 3× the triangle's area). Measured via getBBox in chromium
  // (OpenCode/scratch; D103). An 18px box puts the book's ink at
  // ~18×14.8px — visually equal weight to the play triangle's ~15×17px
  // ink. Strict parity would be a 17px box; 18 keeps a hair of presence
  // the owner approved when the filled book was sized the same way.
  const BOOK_GLYPH_ICON_PX = 18
  // Manga continue caption: provider's own unit label from the IDB read
  // position (e.g. "Volume 3", "Chapter 12"). Never "E12" for manga, never
  // a volume renamed to a chapter. Falls back to tracker progress text.
  const [mangaUnitLabel, setMangaUnitLabel] = useState<string | null>(null)
  useEffect(() => {
    if (variant !== 'continue' || !isManga) return
    let cancelled = false
    getReadPos(anime.identity.internalId.replace(/^read:/, ''))
      .then(pos => { if (!cancelled && pos?.chapterLabel) setMangaUnitLabel(pos.chapterLabel) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [variant, isManga, anime.identity.internalId])

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
    // NOTE: the hover GROUP for the overlay glyphs (play/read + ⋮) lives on
    // the card ROOT (button/link/div below) — `group/card` — because the ⋮
    // QuickMenu is a sibling of this content div, not a descendant, and a
    // group only matches its descendants.
    <div className="group relative w-full min-w-0 flex-shrink-0">
      <div
        className={`relative w-full min-w-0 flex-shrink-0 overflow-hidden rounded-[6px] border border-[var(--border-strong)] bg-[var(--surface)] transition-colors duration-200 hover:z-10 hover:border-[color-mix(in_srgb,var(--text)_35%,transparent)] ${width}`}
      >
      <div className={`relative ${artAspect} w-full min-w-0 overflow-hidden bg-[var(--surface-elevated)]`}>
        <img
          src={fallbackSrc}
          alt={primaryTitle}
          loading="lazy"
          decoding="async"
          width={artDims.width}
          height={artDims.height}
          onError={(e) => {
            const t = e.currentTarget
            t.style.display = 'none'
          }}
          onLoad={(e) => {
            e.currentTarget.classList.add('is-loaded')
          }}
          className="img-fade h-full w-full object-cover opacity-[0.96] transition group-hover:opacity-100"
        />

        {/* subtle inner gradient for text legibility if needed */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[color-mix(in_srgb,var(--bg)_55%,transparent)] via-transparent to-transparent opacity-60 group-hover:opacity-70 transition-opacity" />

        {/* Hover affordance — UNIFIED (owner 2026-10-18): play for anime,
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
            {/* OWNER 2026-10-18 (evening, revert): the hover read glyph is
                back to the HOLLOW book. The ink-parity BOX stays — both
                book arts span the same 16×13.1 geometry in the 16-unit
                viewBox, so an 18px box keeps the book's ink visually equal
                to the play triangle's (a same-size 30px box would render
                the book ~3× the triangle's area — measured via getBBox). */}
            <Icon name="book" size={BOOK_GLYPH_ICON_PX} />
          </button>
        )}

        {/* Title overlay on hover — name + year + format + first genre.
            Desktop only (touch uses tap → detail). Continue cards keep their
            own metadata block below instead. Rendered ONLY on devices that
            can actually hover: a `hidden` + `md:block` overlay still sits in
            layout on touch (opacity-0, zero-size) and its text reports
            getBoundingClientRect().left = 0, which trips overflow/clip
            audits and can paint during scroll. can-hover gate renders it
            only where a real hover exists (see globals.css). */}
        {variant !== 'continue' && (
          <div className="absolute inset-x-0 bottom-0 hidden translate-y-1 bg-gradient-to-t from-[color-mix(in_srgb,var(--bg)_75%,transparent)] to-transparent p-2 opacity-0 transition can-hover:block group-hover:translate-y-0 group-hover:opacity-100">
            <p className="line-clamp-1 text-[11px] font-medium leading-tight text-[var(--text)]">
              {primaryTitle}
            </p>
            {hoverMeta && <p className="truncate text-[10px] text-[var(--text-muted)]">{hoverMeta}</p>}
          </div>
        )}

        {/* Progress bar — thin (2px) with a soft glow, flush with the
            thumbnail's bottom edge */}
        {variant === 'continue' && anime.progress && (
          <div className="absolute inset-x-0 bottom-0 h-[2px] bg-[color-mix(in_srgb,var(--text)_15%,transparent)]" aria-hidden>
            <div className="h-full bg-[var(--text)] shadow-[0_0_6px_var(--text)] transition-[width] duration-300" style={{ width: `${Math.min(100, Math.max(0, anime.progress.percent))}%` }} />
          </div>
        )}

        {/* CONTINUE cards previously carried a persistent play glyph;
            owner 2026-10-18: the SAME unified glyph (above) covers them —
            hover-revealed at pointer widths like every other card, with
            the same next-episode target. */}
      </div>

      {/* Captions ONLY on Continue Watching (clean rows everywhere else).
          Manga continue cards show the provider unit label; anime points at
          the NEXT episode (progress+1, or 1 for an unstarted show) with the
          episode NAME from the AniList record when one exists — bare
          "Episode N" only for unnamed episodes. ANILIST-FIRST: names are
          AniList data; the tracker supplies progress only.
          Caption uses --surface-0 (the page-background step): Mocha Base
          #1E1E2E, so the rectangle melts into the page exactly. Token
          (not hex) so every theme renders its own background step. */}
      {variant === 'continue' && anime.progress && (
        <div className="w-full min-w-0 space-y-1 bg-[var(--surface-0)] px-2.5 py-2">
          <div className="flex min-w-0 items-center justify-between">
            <p className="min-w-0 flex-1 line-clamp-1 text-[11px] font-medium text-[var(--text)]">{primaryTitle}</p>
          </div>
          <p className="truncate text-[11px] text-[var(--text-muted)]">
            {isManga
              ? (mangaUnitLabel ?? `Chapter ${displayEp || progressEp}`)
              : (watchName ? watchName : `Episode ${displayWatchEp}`)}
          </p>
        </div>
      )}
      </div>
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
  // the owner reported (2026-10-18).
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
