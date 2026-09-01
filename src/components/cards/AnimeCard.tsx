import { Link } from 'react-router-dom'
import type { Anime } from '../../types/anime'
import { getPrimaryTitle } from '../../lib/titles'
import { getSmartSeasonNumber, getDisplayEpisodeNumber } from '../../lib/episodes'

type Variant = 'default' | 'continue' | 'compact'

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
  const content = (
    <div
      className={`group relative flex-shrink-0 overflow-hidden rounded-[6px] bg-[var(--surface)] ring-1 ring-white/5 transition-all duration-200 hover:z-10 hover:scale-[1.03] hover:ring-white/15 ${width}`}
    >
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-[var(--surface-elevated)]">
        <img
          src={fallbackSrc}
          alt={primaryTitle}
          loading="lazy"
          decoding="async"
          onError={(e) => {
            const t = e.currentTarget
            t.style.display = 'none'
          }}
          className="h-full w-full object-cover opacity-[0.96] transition group-hover:opacity-100"
        />

        {/* subtle inner gradient for text legibility if needed */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/55 via-transparent to-transparent opacity-60 group-hover:opacity-70 transition-opacity" />

        {/* Hover play affordance */}
        <div className="absolute inset-0 grid place-items-center opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
          <div className="grid h-8 w-8 place-items-center rounded-full bg-white text-black shadow-lg">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5.14v13.72L19 12z" />
            </svg>
          </div>
        </div>

        {/* Title overlay on hover — subtle */}
        <div className="absolute inset-x-0 bottom-0 translate-y-1 bg-gradient-to-t from-black/75 to-transparent p-2 opacity-0 transition group-hover:translate-y-0 group-hover:opacity-100">
          <p className="line-clamp-1 text-[11px] font-medium leading-tight text-white">
            {primaryTitle}
          </p>
          <p className="text-[10px] text-white/70">{anime.year} · {anime.format}</p>
        </div>
      </div>

      {/* Continue variant progress */}
      {variant === 'continue' && anime.progress && (
        <div className="space-y-1 bg-[var(--surface)] px-2.5 py-2">
          <div className="flex items-center justify-between">
            <p className="line-clamp-1 text-[11px] font-medium text-white/90">{primaryTitle}</p>
          </div>
          <p className="text-[11px] text-white/55">
            S{getSmartSeasonNumber(anime)}:E{getDisplayEpisodeNumber(anime, anime.progress.episode)}
          </p>
          <div className="h-0.5 w-full overflow-hidden rounded-full bg-white/10">
            <div className="h-full bg-[#e50914]" style={{ width: `${anime.progress.percent}%` }} />
          </div>
        </div>
      )}
    </div>
  )

  if (onSelect) {
    return (
      <button
        onClick={() => onSelect(anime)}
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
      aria-label={`Open ${primaryTitle}`}
      className={`focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60 block ${fullWidth ? 'w-full' : ''}`}
    >
      {content}
    </Link>
  )
}
