import { CARD_ART_ASPECT, CARD_WIDTH, type CardMediaKind } from '../cards/cardGeometry'

export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded bg-[var(--surface)] ${className}`} aria-hidden>
      <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.4s_infinite] bg-gradient-to-r from-transparent via-[var(--border-strong)] to-transparent" />
    </div>
  )
}

/**
 * CARD SKELETON — the card's silhouette before the data exists.
 *
 * Shape comes from `cardGeometry.ts` (the same module AnimeCard reads), so a
 * skeleton can never disagree with the card it becomes. That was a real bug
 * on 2026-10-27: `/manga` loaded with `aspect-[16/9]` anime boxes over a
 * grid that renders 3:4 portrait covers, so the page visibly "morphed" from
 * landscape tiles to portrait ones.
 *
 * Rule: skeletons never spell an aspect ratio themselves. If a new card
 * shape appears, add it to `cardGeometry.ts` and every skeleton follows.
 *
 * Two appearances, because the two places a skeleton shows are different
 * surfaces (both were already in the product before this refactor):
 * - framed (default): rail/row card — the card frame with a shimmer sweep.
 * - flat: grid cell — a quiet surface block that pulses.
 */
export function CardSkeleton({
  mediaKind = 'anime',
  fullWidth = false,
  flat = false,
}: {
  mediaKind?: CardMediaKind
  /** Fill the grid cell (Browse/Manga/Search) instead of the fixed rail width. */
  fullWidth?: boolean
  /** Grid look: no card frame, no shimmer — a quiet pulsing block. */
  flat?: boolean
}) {
  const width = fullWidth ? CARD_WIDTH.full : `${CARD_WIDTH.rail} shrink-0`
  const aspect = CARD_ART_ASPECT[mediaKind]

  if (flat) {
    return (
      <div
        aria-hidden
        data-card-skeleton={mediaKind}
        className={`${aspect} ${width} animate-pulse rounded-[6px] bg-[color-mix(in_srgb,var(--text)_5%,transparent)]`}
      />
    )
  }

  return (
    <div aria-hidden data-card-skeleton={mediaKind} className={`${width} overflow-hidden rounded-[6px] bg-[var(--surface)] ring-1 ring-[var(--border-strong)]`}>
      <Skeleton className={`${aspect} w-full rounded-none`} />
    </div>
  )
}

export function RowSkeleton({
  title = 'Loading',
  mediaKind = 'anime',
}: {
  title?: string
  /** Row content shape — Watch's Related Anime passes anime, Read's passes manga. */
  mediaKind?: CardMediaKind
}) {
  // No horizontal padding here — callers (Home rows container, MyList
  // container) already pad to the hero edge. Own px-* would double-pad
  // below lg and push bar + first card right of the hero/row-title edge.
  return (
    <section>
      <div className="mb-2 flex items-baseline gap-2">
        <div className="h-3 w-28 rounded bg-[color-mix(in_srgb,var(--text)_10%,transparent)]" />
      </div>
      <div className="flex gap-2 overflow-hidden">
        {Array.from({ length: 6 }).map((_, i) => (
          <CardSkeleton key={i} mediaKind={mediaKind} />
        ))}
      </div>
      <p className="sr-only">{title}</p>
    </section>
  )
}
