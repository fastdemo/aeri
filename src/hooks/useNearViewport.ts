import { useEffect, useRef, useState } from 'react'

/**
 * VIEWPORT PROXIMITY GATE (owner 2026-10-25 — Home "takes forever and shows
 * many blank cards").
 *
 * Card artwork is a full AniList banner (~1.8k px wide, ~170 KB) even though
 * it paints in a ~240 px tile. `loading="lazy"` alone is not enough: Chrome's
 * lazy distance is generous (up to ~3000 px on fast connections), and every
 * Home row is a horizontal scroller, so a cold Home start queued ~50 large
 * images at once and the few tiles actually in view had to compete with all
 * of them — they stayed blank while offscreen art downloaded.
 *
 * This hook reports when an element has come within `rootMargin` of the
 * viewport (both axes, clipped by any scroll container), and stays true once
 * it has. Cards render their <img> only when near, so the first paint
 * requests only what can be seen (plus a short preload runway) and the
 * browser's queue serves those first.
 */
export function useNearViewport<T extends Element = HTMLDivElement>(opts?: {
  /** Skip the observer entirely: render media immediately (above-the-fold). */
  priority?: boolean
  /** Preload runway around the viewport. Default `300px 600px`. */
  rootMargin?: string
}): { ref: React.RefObject<T | null>; near: boolean } {
  const priority = opts?.priority ?? false
  const rootMargin = opts?.rootMargin ?? '300px 600px'
  const ref = useRef<T | null>(null)
  const [seen, setSeen] = useState(false)

  useEffect(() => {
    if (priority || seen) return
    const el = ref.current
    if (!el) return
    // No IntersectionObserver (very old engines / tests): behave like plain
    // lazy loading — render and let the browser decide.
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true)
      return
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true)
          io.disconnect()
        }
      },
      { root: null, rootMargin },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [priority, rootMargin, seen])

  // `priority` short-circuits the gate during render (no state write needed).
  return { ref, near: priority || seen }
}
