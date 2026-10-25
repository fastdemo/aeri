import { useEffect, useMemo, useState } from 'react'
import type { Anime } from '../types/anime'
import {
  anilistEpisodeMetadataSurvivesGuards,
  type EpisodeFallbackInput,
  type EpisodeFallbackStatus,
} from '../lib/episodes'
import { getKitsuEpisodes, type KitsuEpisodeMetadata } from '../services/kitsu/client'

interface KitsuEpisodesState extends EpisodeFallbackInput {
  status: EpisodeFallbackStatus
  episodes: KitsuEpisodeMetadata[] | null
  allowed: boolean
}

/**
 * Fetch Kitsu episode names/thumbnails ONLY when AniList's episode metadata
 * will not survive the display guards. The decision is made on the RAW
 * AniList streaming list (only trailers removed) AND the guards that
 * actually render it: a season-polluted list (Code Geass R2's S1
 * Crunchyroll rows) or an out-of-range list is discarded on screen, so
 * treating it as "usable" left the UI with bare "Episode N" placeholders
 * forever and never asked Kitsu. AniList data that IS displayed always
 * wins; Kitsu never mixes into a partial AniList list.
 *
 * `anime` is the record used for identity/fetching (it may be sanitized).
 * `gateAnime` is the pre-sanitize record; callers that already ran
 * sanitizeAnimeForDisplay for rendering MUST pass it so the gate can run
 * the guards on the original list.
 *
 * The hook is display-only. It never feeds tracking, identity, totals, or
 * discovery. Components that do not render episode metadata (cards) must
 * not call it.
 */
export function useKitsuEpisodes(anime: Anime | null, gateAnime?: Anime | null): KitsuEpisodesState {
  const gate = gateAnime ?? anime
  const needsFallback = useMemo(() => {
    if (!gate) return false
    const format = (gate.format ?? '').toUpperCase()
    if (format === 'MANGA' || format === 'NOVEL' || format === 'ONE_SHOT') return false
    return !anilistEpisodeMetadataSurvivesGuards(gate)
  }, [gate])

  const [state, setState] = useState<KitsuEpisodesState>(() => ({
    status: needsFallback ? 'loading' : 'idle',
    episodes: null,
    allowed: needsFallback,
  }))

  useEffect(() => {
    if (!anime || !gate || !needsFallback) {
      setState({ status: 'idle', episodes: null, allowed: false })
      return
    }

    let cancelled = false
    const controller = new AbortController()
    setState({ status: 'loading', episodes: null, allowed: true })

    getKitsuEpisodes(gate, controller.signal)
      .then((result) => {
        if (cancelled) return
        if (result.status === 'ok' && result.episodes.length > 0) {
          setState({ status: 'resolved', episodes: result.episodes, allowed: true })
        } else if (result.status === 'error') {
          setState({ status: 'error', episodes: null, allowed: true })
        } else {
          setState({ status: 'unavailable', episodes: null, allowed: true })
        }
      })
      .catch((error) => {
        if (cancelled || error?.name === 'AbortError') return
        setState({ status: 'error', episodes: null, allowed: true })
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [anime, gate, needsFallback])

  return state
}
