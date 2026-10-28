/**
 * CARD GEOMETRY — single source of truth for card artwork shape.
 *
 * Every surface that has to *look like a card before the card exists*
 * (loading skeletons on Browse/Manga/Search/Related rows, Home row
 * skeletons) reads these maps. The card itself reads them too, so a future
 * card-shape change updates the silhouette automatically instead of leaving
 * an anime-shaped block on the manga grid (the 2026-10-27 bug: `/manga`
 * loading showed 16:9 anime boxes over a 3:4 portrait grid).
 *
 * Rule: never hardcode `aspect-[16/9]` / `aspect-[3/4]` in a skeleton.
 */
export type CardMediaKind = 'anime' | 'manga'

/** Tailwind aspect class for the artwork frame. */
export const CARD_ART_ASPECT: Record<CardMediaKind, string> = {
  anime: 'aspect-[16/9]',
  manga: 'aspect-[3/4]',
}

/** Intrinsic size handed to <img width height> (prevents layout shift). */
export const CARD_ART_DIMS: Record<CardMediaKind, { width: number; height: number }> = {
  anime: { width: 400, height: 225 },
  manga: { width: 300, height: 400 },
}

/**
 * Width classes for a standalone card. `fullWidth` cards fill their grid
 * cell (Browse/Manga/Search); rail cards keep the fixed row width.
 */
export const CARD_WIDTH = {
  rail: 'w-[168px] sm:w-[200px] lg:w-[236px]',
  compact: 'w-[148px] sm:w-[180px]',
  full: 'w-full',
} as const
