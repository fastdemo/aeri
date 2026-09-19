import { AnimeCard } from '../cards/AnimeCard'
import type { RelatedEntry } from '../../hooks/useRelatedEntries'
import { formatLabel } from '../../lib/mediaLabels'

function relationLabel(relationType: string): string {
  switch (relationType) {
    case 'SEQUEL': return 'Sequel'
    case 'PREQUEL': return 'Prequel'
    case 'PARENT': return 'Parent story'
    case 'ALTERNATIVE': return 'Alternative'
    case 'SPIN_OFF': return 'Spin-off'
    case 'SIDE_STORY': return 'Side story'
    case 'CHARACTER': return 'Character'
    case 'SUMMARY': return 'Summary'
    case 'ADAPTATION': return 'Adaptation'
    case 'OVA': return 'OVA'
    case 'ONA': return 'ONA'
    case 'SPECIAL': return 'Special'
    case 'MOVIE': return 'Movie'
    default: return 'Related'
  }
}

function isMangaFormat(format?: string | null): boolean {
  return ['MANGA', 'NOVEL', 'ONE_SHOT'].includes(format?.toUpperCase() ?? '')
}

function RelatedGrid({
  entries,
  onSelect,
}: {
  entries: RelatedEntry[]
  onSelect?: (anilistId: number) => void
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {entries.map(({ anime, relationType }) => {
        const id = anime.identity.anilistId
        if (!id) return null
        const meta = [
          relationLabel(relationType),
          formatLabel(anime.format) ?? anime.format,
          anime.episodes ? `${anime.episodes} Episodes` : null,
        ].filter(Boolean).join(' • ')
        const inner = (
          <>
            <AnimeCard
              anime={anime}
              onSelect={onSelect ? () => onSelect(id) : undefined}
              mediaKind={isMangaFormat(anime.format) ? 'manga' : 'anime'}
              fullWidth
            />
            {meta && <p className="mt-1 truncate px-0.5 text-[11px] text-[var(--text-faint)]">{meta}</p>}
          </>
        )
        return (
          <div key={`related-${id}`} className="min-w-0">
            {onSelect ? (
              inner
            ) : (
              <a
                href={`#/anime/anilist-${id}`}
                aria-label={`Open related entry ${anime.title.english ?? anime.title.romaji}`}
                className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-strong)]"
              >
                {inner}
              </a>
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Related Entries — navigation/discovery only, split into Related Shows
 * (anime formats) and Related Manga (MANGA/NOVEL/ONE_SHOT). Each entry links
 * directly to its own AniList id; nothing mutates the current entry, groups
 * identities, or transfers progress. Reuses the shared AnimeCard.
 *
 * NOTE: Related links must NOT go through react-router <Link>: the parent
 * DetailModal closes on ANY hashchange (including same-hash route swaps),
 * which would kill the modal before the new entry's modal can open. A plain
 * anchor performs the hash navigation natively; the page-level modal host
 * (Search/Browse/Home) then opens the new entry's modal from the route.
 */
export function RelatedEntries({
  entries,
  loading,
  onSelect,
}: {
  entries: RelatedEntry[] | null
  loading: boolean
  onSelect?: (anilistId: number) => void
}) {
  if (!loading && (!entries || !entries.length)) return null
  const shows = (entries ?? []).filter(e => !isMangaFormat(e.anime.format))
  const manga = (entries ?? []).filter(e => isMangaFormat(e.anime.format))
  return (
    <>
      {(!loading && !shows.length && manga.length) ? null : (
        <section aria-label="Related Shows" className="mt-4">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h2 className="min-w-0 flex-1 truncate text-[14px] font-semibold tracking-[-0.01em] text-[var(--text)]">
              Related Shows
            </h2>
            {shows.length > 0 && (
              <span className="shrink-0 text-[14px] text-[var(--text-faint)]">{shows.length}</span>
            )}
          </div>
          {loading && !entries ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-label="Loading related shows">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="aspect-[16/9] w-full animate-pulse rounded-[6px] bg-[var(--surface)]" />
              ))}
            </div>
          ) : shows.length ? (
            <RelatedGrid entries={shows} onSelect={onSelect} />
          ) : null}
        </section>
      )}
      {manga.length > 0 && (
        <section aria-label="Related Manga" className="mt-4">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h2 className="min-w-0 flex-1 truncate text-[14px] font-semibold tracking-[-0.01em] text-[var(--text)]">
              Related Manga
            </h2>
            <span className="shrink-0 text-[14px] text-[var(--text-faint)]">{manga.length}</span>
          </div>
          <RelatedGrid entries={manga} onSelect={onSelect} />
        </section>
      )}
    </>
  )
}
