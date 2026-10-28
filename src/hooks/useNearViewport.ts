import { useEffect, useRef, useState } from 'react'

/**
 * VIEWPORT PROXIMITY GATE. Home used to take a long time to settle and show
 * many blank cards: card artwork is a full AniList banner (~1.8k px wide,
 * ~170 KB) even though it paints in a ~240 px tile. `loading="lazy"` alone is not enough: Chrome's
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
 *
 * ONE OBSERVER PER ROOT MARGIN (2026-10-27 scroll pass): this used to create
 * an IntersectionObserver per card — 108 observers on Home, each with its own
 * callback delivery on every scroll frame. Callbacks are cheap on their own,
 * but they are not free at 108×, and they compete with the pulse animations
 * for the same main thread. All cards share one observer per `rootMargin`
 * now; the element → callback mapping is a WeakMap so unmounted cards cannot
 * leak, and the observer itself is torn down when the last card using that
 * margin unmounts.
 */

type ProximityCallback = () => void

interface MarginObserver {
  io: IntersectionObserver
  /** element → its one-shot "came near" callback */
  targets: WeakMap<Element, ProximityCallback>
  /** live element count, so the observer is released when the page empties */
  count: number
}

const observers = new Map<string, MarginObserver>()

function acquire(rootMargin: string): MarginObserver {
  const existing = observers.get(rootMargin)
  if (existing) return existing

  const targets = new WeakMap<Element, ProximityCallback>()
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const cb = targets.get(entry.target)
        // Unobserve before firing: the gate is one-shot, and leaving a
        // delivered element observed would keep costing intersection
        // computation for the rest of the session.
        if (cb) {
          targets.delete(entry.target)
          io.unobserve(entry.target)
          cb()
        }
      }
    },
    { root: null, rootMargin },
  )

  const record: MarginObserver = { io, targets, count: 0 }
  observers.set(rootMargin, record)
  return record
}

function release(rootMargin: string, record: MarginObserver) {
  record.count -= 1
  if (record.count > 0) return
  record.io.disconnect()
  // Only drop the entry if it is still the one we created — a newer observer
  // may already have replaced it after a full unmount.
  if (observers.get(rootMargin) === record) observers.delete(rootMargin)
}

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
    const record = acquire(rootMargin)
    record.count += 1
    let active = true
    record.targets.set(el, () => {
      if (active) setSeen(true)
    })
    record.io.observe(el)
    return () => {
      active = false
      record.targets.delete(el)
      record.io.unobserve(el)
      release(rootMargin, record)
    }
  }, [priority, rootMargin, seen])

  // `priority` short-circuits the gate during render (no state write needed).
  return { ref, near: priority || seen }
}
