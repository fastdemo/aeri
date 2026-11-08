import { ContentRow } from '../rows/ContentRow'
import { AnimeCard } from '../cards/AnimeCard'
import { RowSkeleton } from '../ui/Skeleton'
import { useDetailOpen } from '../../hooks/useDetailOpen'
import type { RelatedEntry } from '../../hooks/useRelatedEntries'

function isMangaFormat(format?: string | null): boolean {
  return ['MANGA', 'NOVEL', 'ONE_SHOT'].includes(format?.toUpperCase() ?? '')
}

/**
 * Related titles as a true Home-style rail: the same `ContentRow` scroller,
 * the same fixed card widths, the same hover/focus language. Used by the
 * Watch page (landscape anime cards) and the Read page (portrait manga
 * cards). Unlike the narrow detail-sidebar grid, this is a full-width
 * discovery surface.
 *
 * STANDARD WIDTHS (owner 2026-10-28): every card uses the site's Home rail
 * width (`CARD_WIDTH.rail`) - the same 236/200/168px breakpoint table as
 * every other row. The old per-row edge-fit sizing gave Related Anime and
 * Related Manga different card widths on the same page (236px vs 245px in
 * the reader), so the two rows read as inconsistent. Item counts differ
 * between the rails, so a short row may end before the content edge; the
 * cards themselves never resize to compensate.
 *
 * Cards open the floating detail route over the current page via
 * `useDetailOpen` - the Watch/Read background stays mounted (D097).
 */
export function RelatedRow({
  entries,
  loading,
  mediaKind,
  title,
  className,
  matchEpisodeGrid,
}: {
  entries: RelatedEntry[] | null
  loading: boolean
  mediaKind: 'anime' | 'manga'
  title: string
  className?: string
  /** Watch page only (D170): at >=1024px, size each card and its 8px gap
      exactly like the Episodes grid cell (five columns, 8px gaps, same page
      width). Below 1024 the normal rail width is untouched. */
  matchEpisodeGrid?: boolean
}) {
  const openDetail = useDetailOpen()
  // `(100% - 4 gaps of 8px) / 5` is the episode grid's own cell width at the
  // `lg` breakpoint. The rail and the grid share the same page width and
  // `gap-2`, so the two surfaces agree to the pixel at every desktop width.
  const cardWidth = matchEpisodeGrid
    ? 'w-[168px] sm:w-[200px] lg:w-[calc((100%_-_2rem)/5)]'
    : undefined
  const list = (entries ?? []).filter(e =>
    mediaKind === 'manga' ? isMangaFormat(e.anime.format) : !isMangaFormat(e.anime.format),
  )
  // Owner 2026-11-06: singular/plural on both counts - "1 anime" / "11
  // animes", "1 manga" / "25 mangas".
  const unit = mediaKind === 'manga' ? 'manga' : 'anime'
  const countLabel = `${list.length} ${unit}${list.length === 1 ? '' : 's'}`

  if (loading && !entries) {
    return <div className={className}><RowSkeleton title={title} mediaKind={mediaKind} /></div>
  }
  if (!list.length) return null

  return (
    <div className={className}>
      <ContentRow
        title={title}
        mediaKind={mediaKind}
        cardWidthClass={cardWidth}
        // Count on the right, matching the Episodes header's "N episodes"
        // line (owner 2026-11-06).
        subtitle={countLabel}
      >
        {list.map(({ anime, relationType }) => (
          <AnimeCard
            key={`${mediaKind}-${anime.identity.internalId}-${relationType}`}
            anime={anime}
            mediaKind={mediaKind}
            onSelect={openDetail}
            widthClass={cardWidth}
          />
        ))}
      </ContentRow>
    </div>
  )
}
