import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { Anime } from '../types/anime'

/**
 * History state envelope for the detail overlay routes (/anime/:id,
 * /manga/:id). `background` is the list page the card was opened from —
 * the overlay keeps that page mounted underneath the floating card.
 * `anime` rides along so a card click renders instantly (no refetch);
 * deep links without it fall back to the type-scoped Media query.
 */
export interface DetailNavState {
  background?: { pathname: string; search: string }
  anime?: Anime
}

/**
 * Which detail surface a record belongs to. identity.mediaType is the
 * authoritative boundary (ANIME vs MANGA — the same numeric id under
 * different types is a different entity); format is the fallback for
 * records minted before the field existed.
 */
export function detailSurface(anime: Anime): 'anime' | 'manga' {
  if (anime.identity.mediaType) return anime.identity.mediaType === 'MANGA' ? 'manga' : 'anime'
  return ['MANGA', 'NOVEL', 'ONE_SHOT'].includes((anime.format ?? '').toUpperCase()) ? 'manga' : 'anime'
}

export function detailPath(anime: Anime): string {
  return `${detailSurface(anime) === 'manga' ? '/manga' : '/anime'}/${anime.identity.internalId}`
}

/**
 * Pushes a card open onto its canonical detail URL. Host pages keep their
 * component state (scroll position, rows) because the overlay detail route
 * renders the background page from history state — this only adds one
 * history entry on top of it. Browser Back closes the card.
 */
export function useDetailOpen() {
  const navigate = useNavigate()
  const location = useLocation()
  return useCallback(
    (anime: Anime, opts?: { replace?: boolean }) => {
      navigate(detailPath(anime), {
        replace: opts?.replace ?? false,
        state: {
          background: { pathname: location.pathname, search: location.search },
          anime,
        } satisfies DetailNavState,
      })
    },
    [navigate, location.pathname, location.search],
  )
}
