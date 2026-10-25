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

  if (loading && !entries) {
    return <div className={className}><RowSkeleton title={title} /></div>
  }
  if (!list.length) return null

  return (
    <div className={className}>
      <ContentRow title={title}>
        {list.map(({ anime, relationType }) => (
          <AnimeCard
            key={`${mediaKind}-${anime.identity.internalId}-${relationType}`}
            anime={anime}
            mediaKind={mediaKind}
            onSelect={openDetail}
          />
        ))}
      </ContentRow>
    </div>
  )
}
