import { useLocation, useNavigate } from 'react-router-dom'
import { AnimeCard } from '../cards/AnimeCard'
import type { RelatedEntry } from '../../hooks/useRelatedEntries'
import { detailPath } from '../../hooks/useDetailOpen'
import { formatLabel } from '../../lib/mediaLabels'

/** Router-navigating anchor: real href (a11y, middle-click, file:// dev),
 * left click pushed via the router with `background` so the floating
 * detail card opens above the current page (D097). Plain-href hash links
 * died with the HashRouter era. */
function RelatedAnchor({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  return (
    <a
      href={href}
      aria-label={label}
      onClick={(e) => {
        const modified = e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0
        if (modified) return
        e.preventDefault()
        navigate(href, { state: { background: { pathname: location.pathname, search: location.search } } })
      }}
      className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-strong)]"
    >
      {children}
    </a>
  )
}

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
    <div className="grid grid-cols-2 gap-3">
      {entries.map(({ anime, relationType }) => {
        const id = anime.identity.anilistId
        if (!id) return null
        // Type-safe destination: manga relations MUST resolve as manga.
        // Same numeric id under ANIME vs MANGA is a DIFFERENT entity, so
        // the /manga/:id route (not the /manga BROWSE page — the old
        // `/manga` bare href navigated away from the current card/page
        // entirely; 2026-10-18 fix). detailPath resolves the mediaType/
        // format boundary and builds canonical `/manga/anilist-<id>`.
        const href = detailPath(anime)
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
              disableLink={!onSelect}
              // D113 (owner 2026-10-23): Related ANIME tiles carry NO hover
              // caption (name + meta already exist outside the art); the
              // Related MANGA portrait tiles keep their caption untouched.
              hideHoverCaption={!isMangaFormat(anime.format)}
            />
            {meta && <p className="mt-1 truncate px-0.5 text-[11px] text-[var(--text-faint)]">{meta}</p>}
          </>
        )
        return (
          <div key={`related-${id}-${relationType}`} className="min-w-0">
            {onSelect ? (
              inner
            ) : (
              <RelatedAnchor
                href={href}
                label={`Open related entry ${anime.title.english ?? anime.title.romaji}`}
              >
                {inner}
              </RelatedAnchor>
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
 * Media-type routing: manga relations link to `/manga` (which resolves
 * type: MANGA) and anime relations to `/anime/...` (type: ANIME). The
 * numeric id alone is NOT sufficient — HxH anime vs HxH manga share
 * nothing but digits. onSelect callers receive the full Anime (with
 * identity.mediaType) so in-place modal swaps preserve the type.
 *
 * NOTE: these anchor fallbacks (Watch/Read pages — no onSelect host) keep a
 * REAL href for accessibility and middle/new-tab, but route through the
 * router on left click, carrying the current location as background so the
 * floating detail card opens above this page (D097), same as every other
 * surface. plain-href hash links died with the HashRouter era.
 */
export function RelatedEntries({
  entries,
  loading,
  onSelect,
  showsOnly,
  mangaOnly,
  hideHeader,
}: {
  entries: RelatedEntry[] | null
  loading: boolean
  onSelect?: (anilistId: number) => void
  showsOnly?: boolean
  mangaOnly?: boolean
  /** Hide the section header (parent renders a shared header row). */
  hideHeader?: boolean
}) {
  if (!loading && (!entries || !entries.length)) return null
  const shows = (entries ?? []).filter(e => !isMangaFormat(e.anime.format))
  const manga = (entries ?? []).filter(e => isMangaFormat(e.anime.format))
  if (showsOnly && !loading && !shows.length) return null
  if (mangaOnly && !loading && !manga.length) return null
  // Empty sections render nothing (not even headers): a show with only
  // manga relations shows no "Related Anime" header, and vice versa.
  // The sidebar below stays clean instead of showing a dead header.
  // Related Manga is capped at 2 per row everywhere (sidebar slot is
  // narrow; 4-across portrait cards would be unreadable).
  // ALIGNMENT: the parent places this block in a shared grid row with
  // Episodes/Chapters (row-start-2 both columns). No padding/margin here —
  // both headers use the identical mb-2 header row, so Related starts at
  // exactly the Episodes line (delta 0). Any pt/mt would offset it.
  // Mobile stacks naturally (grid becomes single column).
  return (
    <>
      {(!mangaOnly) && ((!loading && !shows.length && manga.length) ? null : (
        <section aria-label="Related Anime" className="mt-0">
          {!hideHeader && shows.length > 0 && (
            // Same fixed 20px header geometry as Episodes/Chapters (2026-10-19
            // owner note: headers must share one line, entries share one top).
            <div className="mb-2 flex h-5 items-center justify-between gap-2">
              <h3 className="min-w-0 flex-1 truncate text-[14px] font-semibold leading-5 text-[var(--text)]">
                Related Anime
              </h3>
            </div>
          )}
          {loading && !entries ? (
            <div className="grid grid-cols-2 gap-3" aria-label="Loading related shows">
              {[1, 2].map(i => (
                <div key={i} className="aspect-[16/9] w-full animate-pulse rounded-[6px] bg-[var(--surface)]" />
              ))}
            </div>
          ) : shows.length ? (
            <RelatedGrid entries={shows} onSelect={onSelect} />
          ) : null}
        </section>
      ))}
      {(!showsOnly) && manga.length > 0 && (
        <section aria-label="Related Manga" className="mt-4">
          <div className="mb-2 flex h-5 items-center justify-between gap-2">
            <h3 className="min-w-0 flex-1 truncate text-[14px] font-semibold leading-5 text-[var(--text)]">
              Related Manga
            </h3>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <RelatedGridContents entries={manga} onSelect={onSelect} />
          </div>
        </section>
      )}
    </>
  )
}

function RelatedGridContents({
  entries,
  onSelect,
}: {
  entries: RelatedEntry[]
  onSelect?: (anilistId: number) => void
}) {
  return (
    <>
      {entries.map(({ anime, relationType }) => {
        const id = anime.identity.anilistId
        if (!id) return null
        // Canonical detail URL (manga relations → /manga/:id, never the
        // bare /manga BROWSE page — 2026-10-18 fix; see the first grid).
        const href = detailPath(anime)
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
              disableLink={!onSelect}
              // D113 (owner 2026-10-23): Related ANIME tiles carry NO hover
              // caption (name + meta already exist outside the art); the
              // Related MANGA portrait tiles keep their caption untouched.
              hideHoverCaption={!isMangaFormat(anime.format)}
            />
            {meta && <p className="mt-1 truncate px-0.5 text-[11px] text-[var(--text-faint)]">{meta}</p>}
          </>
        )
        return (
          <div key={`related-manga-${id}-${relationType}`} className="min-w-0">
            {onSelect ? (
              inner
            ) : (
              <RelatedAnchor
                href={href}
                label={`Open related entry ${anime.title.english ?? anime.title.romaji}`}
              >
                {inner}
              </RelatedAnchor>
            )}
          </div>
        )
      })}
    </>
  )
}
