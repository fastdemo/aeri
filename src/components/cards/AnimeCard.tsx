import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Anime } from '../../types/anime'
import { getPrimaryTitle } from '../../lib/titles'
import { getDisplayEpisodeNumber, getStreamingEpisodeTitle } from '../../lib/episodes'
import { formatLabel } from '../../lib/mediaLabels'
import { useTracking } from '../../contexts/TrackingContext'

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
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <circle cx="12" cy="5" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="12" cy="19" r="2" />
        </svg>
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
}: {
  anime: Anime
  variant?: Variant
  onSelect?: (a: Anime) => void
  fullWidth?: boolean
  /** Overrides auto-detection from format. Manga cards pass 'manga'. */
  mediaKind?: MediaKind
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

  // Captions exist ONLY on Continue Watching cards (below). All other
  // rows are clean thumbnails; name/year/category appear in the hover
  // overlay on desktop (see below).
  const hoverMeta = `${anime.year ?? ''}${anime.year ? ' • ' : ''}${formatLabel(anime.format) ?? anime.format ?? ''}${anime.genres?.[0] ? ` • ${anime.genres[0]}` : ''}`

  const content = (
    <div className="group group/card relative flex-shrink-0">
      <div
        className={`relative flex-shrink-0 overflow-hidden rounded-[6px] bg-[var(--surface)] ring-1 ring-[var(--border-strong)] transition-[ring-color] duration-200 hover:z-10 hover:ring-[var(--border-strong)] ${width}`}
      >
      <div className={`relative ${artAspect} w-full overflow-hidden bg-[var(--surface-elevated)]`}>
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

        {/* Hover affordance — play triangle for anime, book glyph for manga.
            Small, quiet, desktop only (no touch equivalent, and :hover
            sticks on tap which looks broken) */}
        <div className="absolute inset-0 hidden place-items-center opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100 md:grid">
          <div className="grid h-6 w-6 place-items-center rounded-full bg-[color-mix(in_srgb,var(--bg)_55%,transparent)] text-[var(--text)] shadow-[0_2px_10px_var(--shadow)]">
            {isManga ? (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V4a2 2 0 0 0-2-2H6.5A2.5 2.5 0 0 0 4 4.5v15z" />
                <path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />
              </svg>
            ) : (
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5.14v13.72L19 12z" />
              </svg>
            )}
          </div>
        </div>

        {/* Title overlay on hover — name + year + format + first genre.
            Desktop only (touch uses tap → detail). Continue cards keep their
            own metadata block below instead. */}
        {variant !== 'continue' && (
          <div className="absolute inset-x-0 bottom-0 hidden translate-y-1 bg-gradient-to-t from-[color-mix(in_srgb,var(--bg)_75%,transparent)] to-transparent p-2 opacity-0 transition group-hover:translate-y-0 group-hover:opacity-100 md:block">
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
          Manga continue cards show chapter progress; anime shows E number. */}
      {variant === 'continue' && anime.progress && (
        <div className="space-y-1 bg-[var(--surface)] px-2.5 py-2">
          <div className="flex items-center justify-between">
            <p className="line-clamp-1 text-[11px] font-medium text-[var(--text)]">{primaryTitle}</p>
          </div>
          <p className="truncate text-[11px] text-[var(--text-muted)]">
            {isManga
              ? (epTitle ? epTitle : `Ch ${displayEp || progressEp}`)
              : (<>E{displayEp}{epTitle ? ` • ${epTitle}` : ''}</>)}
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
  const prewarmId = anime.identity.anilistId ?? null
  const prewarm = () => {
    if (!prewarmId || Number.isNaN(prewarmId)) return
    try {
      void import('../../providers/metadata/anilistMetadata').then((m) => {
        m.anilistMetadataProvider.getAnime(`anilist-${prewarmId}`).catch(() => {})
      })
    } catch {}
  }

  if (onSelect) {
    return (
      <button
        onClick={() => onSelect(anime)}
        onMouseEnter={prewarm}
        onFocus={prewarm}
        className={`text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-strong)] ${fullWidth ? 'w-full' : ''}`}
        aria-label={`Open ${primaryTitle}`}
      >
        {content}
      </button>
    )
  }

  return (
    <Link
      to={`/anime/${anime.identity.internalId}`}
      onMouseEnter={prewarm}
      onFocus={prewarm}
      aria-label={`Open ${primaryTitle}`}
      className={`focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-strong)] block ${fullWidth ? 'w-full' : ''}`}
    >
      {content}
    </Link>
  )
}
