import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Anime } from '../../types/anime'
import { getPrimaryTitle } from '../../lib/titles'
import { getSmartSeasonNumber, getDisplayEpisodeNumber, getStreamingEpisodeTitle } from '../../lib/episodes'
import { formatLabel } from '../../lib/mediaLabels'
import { useTracking } from '../../contexts/TrackingContext'

type Variant = 'default' | 'continue' | 'compact'

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
        className="absolute right-1 top-1 z-20 grid h-6 w-6 place-items-center text-white/80 drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)] transition hover:text-white focus-visible:opacity-100 md:opacity-0 md:group-hover/card:opacity-100 md:focus-within:opacity-100"
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
            className="anim-pop-in absolute right-1 top-7 z-30 w-44 overflow-hidden rounded-lg border border-white/10 bg-[#1c1c1e] py-1 shadow-xl"
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
              className="flex w-full items-center px-2.5 py-1.5 text-left text-[11px] text-white/80 hover:bg-white/10 hover:text-white"
            >
              Mark as watched
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => run(async () => updateStatus(anime, 'on_hold'))}
              className="flex w-full items-center px-2.5 py-1.5 text-left text-[11px] text-white/80 hover:bg-white/10 hover:text-white"
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
}: {
  anime: Anime
  variant?: Variant
  onSelect?: (a: Anime) => void
  fullWidth?: boolean
}) {
  const width = fullWidth
    ? 'w-full'
    : variant === 'compact'
      ? 'w-[148px] sm:w-[180px]'
      : 'w-[168px] sm:w-[200px] lg:w-[236px]'

  const fallbackSrc = anime.backdropImage || anime.coverImage || ""
  const primaryTitle = getPrimaryTitle(anime)
  const progressEp = anime.progress?.episode ?? 0
  const seasonNum = getSmartSeasonNumber(anime)
  const displayEp = progressEp > 0 ? getDisplayEpisodeNumber(anime, progressEp) : 0
  const epTitle = progressEp > 0 ? getStreamingEpisodeTitle(anime, progressEp) : null

  // Desktop-only caption under the thumbnail: touch has no hover, so the
  // title/year is always visible (was hover-overlay only ⇒ invisible on
  // mobile, the "missing titles" report).
  const showCaption = variant !== 'continue'

  const content = (
    <div className="group group/card relative flex-shrink-0">
      <div
        className={`relative flex-shrink-0 overflow-hidden rounded-[6px] bg-[var(--surface)] ring-1 ring-white/5 transition-all duration-200 hover:z-10 hover:scale-[1.03] hover:ring-white/15 ${width}`}
      >
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-[var(--surface-elevated)]">
        <img
          src={fallbackSrc}
          alt={primaryTitle}
          loading="lazy"
          decoding="async"
          width={400}
          height={225}
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
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent opacity-60 group-hover:opacity-70 transition-opacity" />

        {/* Hover play affordance — small, quiet (desktop only: no touch
            equivalent, and :hover sticks on tap which looks broken) */}
        <div className="absolute inset-0 hidden place-items-center opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100 md:grid">
          <div className="grid h-6 w-6 place-items-center rounded-full bg-black/55 text-white shadow-[0_2px_10px_rgba(0,0,0,0.5)]">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5.14v13.72L19 12z" />
            </svg>
          </div>
        </div>

        {/* Title overlay on hover — desktop only; touch uses the always-visible
            caption below instead (no hover state to get stuck) */}
        {variant !== 'continue' && (
          <div className="absolute inset-x-0 bottom-0 hidden translate-y-1 bg-gradient-to-t from-black/75 to-transparent p-2 opacity-0 transition group-hover:translate-y-0 group-hover:opacity-100 md:block">
            <p className="line-clamp-1 text-[11px] font-medium leading-tight text-white">
              {primaryTitle}
            </p>
            <p className="text-[10px] text-white/70">{anime.year} • {formatLabel(anime.format) ?? anime.format}</p>
          </div>
        )}

        {/* Progress bar — thin, flush with the thumbnail's bottom edge, soft glow */}
        {variant === 'continue' && anime.progress && (
          <div className="absolute inset-x-0 bottom-0 h-[2px] bg-[#333333]" aria-hidden>
            <div className="h-full bg-white shadow-[0_0_8px_rgba(255,255,255,0.7)] transition-[width] duration-300" style={{ width: `${Math.min(100, Math.max(0, anime.progress.percent))}%` }} />
          </div>
        )}
      </div>

      {/* Continue variant metadata */}
      {variant === 'continue' && anime.progress && (
        <div className="space-y-1 bg-[var(--surface)] px-2.5 py-2">
          <div className="flex items-center justify-between">
            <p className="line-clamp-1 text-[11px] font-medium text-white">{primaryTitle}</p>
          </div>
          <p className="truncate text-[11px] text-[#A0A0A0]">
            S{seasonNum}:E{displayEp}{epTitle ? ` • ${epTitle}` : ''}
          </p>
        </div>
      )}
      {/* Default/compact caption: always visible on touch (no hover there),
          hover-overlay handles desktop. */}
      {showCaption && (
        <div className="px-0.5 pb-0.5 pt-1.5 md:hidden">
          <p className="line-clamp-1 text-[11px] font-medium leading-tight text-white">{primaryTitle}</p>
          <p className="text-[10px] text-white/50">{anime.year} • {formatLabel(anime.format) ?? anime.format}</p>
        </div>
      )}
      </div>
      {variant === 'continue' && <QuickMenu anime={anime} />}
    </div>
  )

  // Hover/focus prewarm: the user is demonstrably navigating toward this
  // anime (card interaction precedes route change by ~100-500ms). Starts the
  // series-group spine walk early so the destination reveals with seasons
  // ready. No-op without an id; shared cache + inflight make repeats free.
  const prewarmId = anime.identity.anilistId ?? null
  const prewarm = () => {
    if (!prewarmId || Number.isNaN(prewarmId)) return
    try {
      void import('../../services/anilist/series').then((m) => {
        m.getSeriesGroup(prewarmId).catch(() => {})
      })
    } catch {}
  }

  if (onSelect) {
    return (
      <button
        onClick={() => onSelect(anime)}
        onMouseEnter={prewarm}
        onFocus={prewarm}
        className={`text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 ${fullWidth ? 'w-full' : ''}`}
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
      className={`focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 block ${fullWidth ? 'w-full' : ''}`}
    >
      {content}
    </Link>
  )
}
