import { useEffect, useRef, useState } from 'react'
import { getSeriesGroup, type AnimeSeriesGroup } from '../services/anilist/series'

// Group load must never hold the UI hostage: after GROUP_TIMEOUT_MS the page
// falls back to single-season display instead of spinning forever.
const GROUP_TIMEOUT_MS = 8000

export interface SeriesGroupState {
  /** Complete normalized model, or null (single-season / unavailable). */
  group: AnimeSeriesGroup | null
  /** True once the model is settled OR the bounded wait expired OR no id.
      Season UI must not animate/populate until ready is true. */
  ready: boolean
}

/**
 * Starts season/relationship resolution the moment the AniList media id is
 * known (route param — NOT after page metadata arrives), in parallel with all
 * other page data. Results are shared via the series model cache, so the
 * detail modal, detail page and watch page never each walk the chain.
 */
export function useSeriesGroup(anilistId: number | null | undefined): SeriesGroupState {
  const [state, setState] = useState<SeriesGroupState>({ group: null, ready: !anilistId })
  const reqIdRef = useRef(0)

  useEffect(() => {
    if (!anilistId || !Number.isFinite(anilistId) || anilistId <= 0) {
      setState({ group: null, ready: true })
      return
    }
    const reqId = ++reqIdRef.current
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(new DOMException('Season load timed out', 'AbortError')), GROUP_TIMEOUT_MS)
    setState({ group: null, ready: false })
    getSeriesGroup(anilistId, { signal: controller.signal })
      .then(group => {
        if (controller.signal.aborted || reqId !== reqIdRef.current) return
        clearTimeout(timeoutId)
        setState({
          group: group && group.seasons.length > 1 ? group : null,
          ready: true,
        })
      })
      .catch(() => {
        if (reqId !== reqIdRef.current) return
        clearTimeout(timeoutId)
        // Bounded fallback: single-season display, never an infinite skeleton.
        // Never invented — just the absence of a multi-season model.
        setState({ group: null, ready: true })
      })
    return () => {
      clearTimeout(timeoutId)
      controller.abort()
    }
  }, [anilistId])

  return state
}
