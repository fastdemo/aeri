import type { Anime } from '../../types/anime'

export interface MangaChapter {
  id: string
  mangaId: string
  /** Provider chapter id (WeebCentral ULID). */
  providerChapterId: string
  /** Display label, e.g. "Chapter 386", "Prologue 2". Never a volume number. */
  label: string
  /** Numeric chapter number when parseable, else null. */
  number: number | null
  /** Chapter "type" prefix from provider (Chapter/Prologue/etc), if any. */
  kind?: string
  publishedAt?: string
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

export interface MangaProvider {
  id: string
  name: string
  resolveManga(manga: Anime, options?: MangaSourceOptions): Promise<MangaProviderMatch | null>
  getChapters(manga: Anime, options?: MangaSourceOptions): Promise<MangaChapter[]>
  getChapterPages(chapter: MangaChapter, options?: MangaSourceOptions): Promise<MangaPage[]>
}

export function isMangaKind(anime: Anime | null | undefined): boolean {
  if (!anime?.format) return false
  return ['MANGA', 'NOVEL', 'ONE_SHOT'].includes(anime.format.toUpperCase())
}
