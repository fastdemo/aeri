import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Anime } from '../../types/anime'
import { getPrimaryTitle } from '../../lib/titles'
import { getDisplayEpisodeNumber, getStreamingEpisodeTitle } from '../../lib/episodes'
import { formatLabel } from '../../lib/mediaLabels'
import { Icon } from '../ui/Icon'
import { useTracking } from '../../contexts/TrackingContext'
import { getReadPos } from '../../storage/db'

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
        className="absolute right-1 top-1 z-20 grid h-6 w-6 place-items-center text-[var(--text)] drop-shadow-[0_1px_2px_var(--shadow)] transition hover:text-[var(--text)] focus-visible:opacity-100 md:opacity-0 md:group-hover/card:opacity-100 md:focus-within:opacity-100"
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
          <div
            role="menu"
            aria-label={`Actions for ${getPrimaryTitle(anime)}`}
            className="anim-pop-in absolute right-1 top-7 z-30 w-44 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] py-1 shadow-xl"
            onClick={(e) => {
              e.stopPropagation()
              e.preventDefault()
            }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => run(async () => {
                if (total) await updateProgress(anime, total)
                else if (current > 0) await updateProgress(anime, current)
                await updateStatus(anime, 'completed')
              })}
              className="flex w-full items-center px-2.5 py-1.5 text-left text-[11px] text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--text)_10%,transparent)] hover:text-[var(--text)]"
            >
              Mark as watched
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => run(async () => updateStatus(anime, 'on_hold'))}
              className="flex w-full items-center px-2.5 py-1.5 text-left text-[11px] text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--text)_10%,transparent)] hover:text-[var(--text)]"
            >
              Remove from Continue Watching
            </button>
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
  const epTitle = progressEp > 0 ? getStreamingEpisodeTitle(anime, progressEp) : null
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

  // Card edge: a real 1px border drawn INSIDE the frame (inset
  // box-shadow, not Tailwind's outside ring). An outside ring paints past
  // the scroller's clip origin on edge-flush rows (Home/Profile) and gets
  // its left 1px cut — the chop. Inset keeps the full edge visible on
  // every row at every viewport, same color/radius, zero layout shift.
  const content = (
    <div className="group group/card relative w-full min-w-0 flex-shrink-0">
      <div
        className={`relative w-full min-w-0 flex-shrink-0 overflow-hidden rounded-[6px] bg-[var(--surface)] shadow-[inset_0_0_0_1px_var(--border-strong)] ${width}`}
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

        {/* Hover affordance — play for anime, book for manga.
            Small, quiet, desktop only (no touch equivalent, and :hover
            sticks on tap which looks broken) */}
        <div className="absolute inset-0 hidden place-items-center opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100 md:grid">
          <div className="grid h-6 w-6 place-items-center rounded-full bg-[color-mix(in_srgb,var(--bg)_55%,transparent)] text-[var(--text)] shadow-[0_2px_10px_var(--shadow)]">
            <Icon name={isManga ? 'book' : 'play-fill'} size={10} />
          </div>
        </div>

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
      </div>

      {/* Captions ONLY on Continue Watching (clean rows everywhere else).
          Manga continue cards show the provider unit label; anime shows E number.
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
              : (<>Episode {displayEp}{epTitle ? ` • ${epTitle}` : ''}</>)}
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
        className={`min-w-0 shrink-0 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-strong)] ${fullWidth ? 'w-full' : ''} ${width}`}
        aria-label={`Open ${primaryTitle}`}
      >
        {content}
      </button>
    )
  }

  if (disableLink) {
    return (
      <div className={`min-w-0 ${fullWidth ? 'w-full' : ''}`}>
        {content}
      </div>
    )
  }

  // Type-safe destination: a manga card must never link to the anime
  // route (same numeric id under ANIME vs MANGA is a DIFFERENT entity —
  // HxH anime vs HxH manga). Manga surfaces resolve as manga.
  const linkTo = kind === 'manga' ? `/manga` : `/anime/${anime.identity.internalId}`

  return (
    <Link
      to={linkTo}
      onMouseEnter={prewarm}
      onFocus={prewarm}
      aria-label={`Open ${primaryTitle}`}
      className={`focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-strong)] block ${fullWidth ? 'w-full' : ''}`}
    >
      {content}
    </Link>
  )
}
