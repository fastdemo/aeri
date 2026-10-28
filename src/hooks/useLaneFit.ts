import { useLayoutEffect, useRef, useState } from 'react'

/**
 * Two-lane fit test for the Anime/Manga filter bars.
 *
 * The bar is categories on the left and filters on the right, spread with
 * `justify-between`. That spread closes continuously as the window narrows,
 * so the only real question is when the two lanes would actually touch: at
 * that exact width they merge into one horizontal scroller.
 *
 * The answer is measured, never guessed from a breakpoint. A hidden copy of
 * both lanes — same children, same 8px gap — is laid out at its natural
 * width (`w-max`) and compared with the row's content box. Because the copy
 * is the same JSX as the live row, a filter that appears or disappears (the
 * Clear button) is counted automatically and the measurement can never drift
 * from what is on screen.
 *
 * `useLayoutEffect` runs the first measurement before paint, so the bar never
 * shows the wrong mode for a frame. The copy is `fixed` and hidden, which
 * keeps it out of layout and out of the document's scrollable overflow even
 * when its natural width exceeds the viewport.
 */
export function useLaneFit() {
  const rowRef = useRef<HTMLDivElement | null>(null)
  const measurerRef = useRef<HTMLDivElement | null>(null)
  const [fits, setFits] = useState(true)

  useLayoutEffect(() => {
    const measure = () => {
      const row = rowRef.current
      const m = measurerRef.current
      if (!row || !m) return
      // Compare against the CONTENT box: any padding on the row itself is
      // not free space for the lanes.
      const cs = getComputedStyle(row)
      const inner =
        row.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0)
      if (!inner || inner <= 0) return
      // 1px rounding buffer: scrollWidth is an integer, the lanes are not.
      const next = m.scrollWidth <= inner + 1
      setFits((prev) => (prev === next ? prev : next))
    }

    measure()
    let ro: ResizeObserver | null = null
    try {
      ro = new ResizeObserver(measure)
      if (rowRef.current) ro.observe(rowRef.current)
      if (measurerRef.current) ro.observe(measurerRef.current)
    } catch {
      // No ResizeObserver: the window listener below still covers the only
      // thing that can change this row's width.
    }
    window.addEventListener('resize', measure)
    try {
      ;(document as any).fonts?.ready?.then?.(() => measure())?.catch?.(() => {})
    } catch {
      // Font loading is a best-effort re-measure; the listeners above remain.
    }
    return () => {
      window.removeEventListener('resize', measure)
      try {
        ro?.disconnect()
      } catch {
        // Already disconnected.
      }
    }
  }, [])

  return { rowRef, measurerRef, fits }
}
