import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ContentRow } from '../rows/ContentRow'
import { AnimeCard } from '../cards/AnimeCard'
import { RowSkeleton } from '../ui/Skeleton'
import { useDetailOpen } from '../../hooks/useDetailOpen'
import type { RelatedEntry } from '../../hooks/useRelatedEntries'

/** Must match the scroller's `gap-2` (ContentRow). */
const RAIL_GAP = 8

function isMangaFormat(format?: string | null): boolean {
  return ['MANGA', 'NOVEL', 'ONE_SHOT'].includes(format?.toUpperCase() ?? '')
}

/** Home card width at the current viewport (matches AnimeCard's classes). */
function naturalCardWidth(): number {
  if (typeof window === 'undefined') return 236
  const w = window.innerWidth
  if (w >= 1024) return 236
  if (w >= 640) return 200
  return 168
}

/**
 * Related titles as a true Home-style rail: the same `ContentRow` scroller,
 * the same fixed card widths, the same hover/focus language. Used by the
 * Watch page (landscape anime cards) and the Read page (portrait manga
 * cards). Unlike the narrow detail-sidebar grid, this is a full-width
 * discovery surface.
 *
 * EDGE-ALIGNED WIDTHS (owner 2026-10-25: "the right border ended early and
 * not where it should"): a fixed 236px card repeated across a 1232px rail
 * leaves a 20–200px strip of dead space — and, worse, a sliver of the next
 * card whose right border is clipped. Home never shows this because its
 * rows always overflow; a Related row has 3–6 items. So the rail measures
 * itself and sizes its cards so a WHOLE number of them lands exactly on the
 * content edge: the last right border sits where the header's does. Spare
 * change is shared into the cards (never more than 1.5× the Home width —
 * sparse rows keep Home-sized cards rather than billboards).
 *
 * Cards open the floating detail route over the current page via
 * `useDetailOpen` — the Watch/Read background stays mounted (D097).
 */
export function RelatedRow({
  entries,
  loading,
  mediaKind,
  title,
  className,
}: {
  entries: RelatedEntry[] | null
  loading: boolean
  mediaKind: 'anime' | 'manga'
  title: string
  className?: string
}) {
  const openDetail = useDetailOpen()
  const list = (entries ?? []).filter(e =>
    mediaKind === 'manga' ? isMangaFormat(e.anime.format) : !isMangaFormat(e.anime.format),
  )
  const wrapRef = useRef<HTMLDivElement>(null)
  const [railWidth, setRailWidth] = useState(0)

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => setRailWidth(el.clientWidth)
    measure()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null
    ro?.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [list.length])

  // Width that makes `visible` whole cards fill the rail exactly. Null keeps
  // the natural Home width (row overflows, or the cards would balloon).
  const cardWidth = useMemo(() => {
    if (!railWidth || !list.length) return null
    const natural = naturalCardWidth()
    const fits = Math.max(1, Math.round(railWidth / (natural + RAIL_GAP)))
    const perCard = (railWidth - (fits - 1) * RAIL_GAP) / fits
    // A rail narrower than ~0.85 card-widths means the fit count is wrong
    // (a 1px overflow would otherwise collapse to a single wide card).
    if (perCard < natural * 0.85 || perCard > natural * 1.5) return null
    const visible = Math.min(list.length, fits)
    const exact = (railWidth - (visible - 1) * RAIL_GAP) / visible
    if (exact > natural * 1.5) return null
    return Math.max(96, Math.floor(exact))
  }, [railWidth, list.length])

  if (loading && !entries) {
    return <div className={className}><RowSkeleton title={title} /></div>
  }
  if (!list.length) return null

  return (
    <div className={className} ref={wrapRef}>
      <ContentRow title={title} tailSpacer={false}>
        {list.map(({ anime, relationType }) => (
          <div
            key={`${mediaKind}-${anime.identity.internalId}-${relationType}`}
            className="min-w-0 shrink-0"
            style={cardWidth ? { width: cardWidth } : undefined}
          >
            <AnimeCard
              anime={anime}
              mediaKind={mediaKind}
              onSelect={openDetail}
              fullWidth={!!cardWidth}
            />
          </div>
        ))}
      </ContentRow>
    </div>
  )
}
