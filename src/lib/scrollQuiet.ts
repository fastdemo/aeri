/**
 * SCROLL-QUIET GATE (owner report 2026-10-28: cards flickered while
 * scrolling a preview card / row).
 *
 * Root cause: D137 made `.card-frost`'s 8px `backdrop-filter` hover-only.
 * That is the right call for idle cost, but during a scroll every card
 * passing under a parked cursor enters/leaves :hover repeatedly, so a large
 * backdrop blur is created and destroyed many times per second — the whole
 * tile flashes as the compositor re-blurs it.
 *
 * Fix: a single document-level capture listener marks
 * `html[data-scrolling="1"]` for the duration of any scroll (any scroller —
 * window, the detail card, a horizontal row), and globals.css turns the
 * hover frost/controls off while that flag is set. When scrolling stops the
 * flag clears and the normal hover treatment returns. Capture phase is
 * required because `scroll` does not bubble; capture still sees scrolls from
 * every descendant scroller.
 *
 * Installed once from main.tsx. No React state, no re-render, no timers
 * while idle.
 */
let installed = false

export function installScrollQuiet(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  const root = document.documentElement
  let timer = 0
  const settle = () => {
    timer = window.setTimeout(() => {
      timer = 0
      if (root.dataset.scrolling) delete root.dataset.scrolling
    }, 140)
  }
  const onScroll = () => {
    if (!root.dataset.scrolling) root.dataset.scrolling = '1'
    if (timer) window.clearTimeout(timer)
    settle()
  }
  document.addEventListener('scroll', onScroll, { capture: true, passive: true })
}
