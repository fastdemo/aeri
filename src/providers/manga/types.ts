import type { Anime } from '../../types/anime'

export interface MangaChapter {
  id: string
  mangaId: string
  /** Provider unit id (WeebCentral ULID). Opaque — one unit is NOT always one chapter (may be a volume). */
  providerChapterId: string
  /** Provider's original label, preserved verbatim: "Chapter 386", "Vol. 3", "Volume 3", "Prologue 2". */
  label: string
  /** Numeric unit number when parseable, else null (provider order kept). */
  number: number | null
  /** Unit "type" prefix from provider (Chapter/Prologue/Volume/Vol/etc), if any. */
  kind?: string
  /**
   * Provider's own unit type. 'volume' for Volume/Vol labels, else
   * 'chapter'. Drives display wording ("Volume 3" vs "Chapter 12") —
   * never rename a volume to a chapter.
   */
  unitType?: 'volume' | 'chapter'
  publishedAt?: string
}

/**
 * Display label for a provider unit. Uses the provider's own label when it
 * already names the unit ("Chapter 12", "Volume 3", "Prologue 2"); only
 * synthesizes one when the label is bare. Never converts volume↔chapter.
 */
export function unitDisplayLabel(u: Pick<MangaChapter, 'label' | 'number' | 'kind' | 'unitType'>): string {
  const label = (u.label ?? '').trim()
  if (label) return label
  if (u.unitType === 'volume') return u.number != null ? `Volume ${u.number}` : 'Volume'
  return u.number != null ? `Chapter ${u.number}` : 'Chapter'
}

/**
 * Sort key for provider units: numeric when the number parses, else null
 * (caller keeps provider order for those). Volumes and chapters sort in
 * separate runs — never interleaved by raw number.
 */
export function unitSortKey(u: Pick<MangaChapter, 'number' | 'unitType'>): number | null {
  return typeof u.number === 'number' && Number.isFinite(u.number) ? u.number : null
}

/**
 * Presentation-layer ordering for provider units. Numeric within each
 * unit-type run (1,2,3,10,11 — never lexicographic); units without a
 * parseable number keep provider order at the end of their run. Volumes
 * sort as their own run after chapters in oldest-first mode (provider's
 * volumes are typically compilations, not the serial sequence).
 * Does NOT mutate the input.
 */
export function sortProviderUnits<T extends Pick<MangaChapter, 'number' | 'unitType'>>(
  units: T[],
  direction: 'asc' | 'desc' = 'asc',
): T[] {
  const chapters = units.filter(u => u.unitType !== 'volume')
  const volumes = units.filter(u => u.unitType === 'volume')
  const sortRun = (run: T[]): T[] => {
    const numbered = run.filter(u => unitSortKey(u) != null)
      .sort((a, b) => (unitSortKey(a) as number) - (unitSortKey(b) as number))
    const unnumbered = run.filter(u => unitSortKey(u) == null)
    const ordered = [...numbered, ...unnumbered]
    return direction === 'desc' ? ordered.reverse() : ordered
  };
  return [...sortRun(chapters), ...sortRun(volumes)]
}

export interface MangaPage {
  index: number
  url: string
}

export interface MangaProviderMatch {
  providerId: string
  providerMangaId: string
  title?: string
}

export interface MangaSourceOptions {
  signal?: AbortSignal
  mangaTitle?: string | null
  mangaEnglish?: string | null
  mangaNative?: string | null
  mangaChapters?: number | null
  mangaVolumes?: number | null
  mangaFormat?: string | null
  mangaYear?: number | null
}

export type MediaKind = 'anime' | 'manga'

/**
 * Verification status of a provider. Only `verified` providers appear in
 * Settings — `unverified`/`broken` exist in code but are never user-facing.
 * Verified = full end-to-end flow confirmed in the CURRENT architecture
 * (manga: search→match→units→pages→rendered images; anime: match→episodes→
 * sources→advancing playback), with date recorded in agents/changelog.md.
 */
export type ProviderStatus = 'verified' | 'unverified' | 'broken'

export interface MediaProviderMeta {
  id: string
  name: string
  kind: MediaKind
  status: ProviderStatus
  /** Shown in Settings; false for user-configured endpoints (custom). */
  enabledByDefault: boolean
  /** One-line capability note for the Settings row subtitle. */
  blurb: string
}

export interface MangaProvider extends MediaProviderMeta {
  kind: 'manga'
  resolveManga(manga: Anime, options?: MangaSourceOptions): Promise<MangaProviderMatch | null>
  getChapters(manga: Anime, options?: MangaSourceOptions): Promise<MangaChapter[]>
  getChapterPages(chapter: MangaChapter, options?: MangaSourceOptions): Promise<MangaPage[]>
}

export function isMangaKind(anime: Anime | null | undefined): boolean {
  if (!anime?.format) return false
  return ['MANGA', 'NOVEL', 'ONE_SHOT'].includes(anime.format.toUpperCase())
}
