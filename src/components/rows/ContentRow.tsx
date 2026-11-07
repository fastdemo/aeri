import { useRef, useEffect, useState, useCallback } from 'react'
import { Icon } from '../ui/Icon'
import { useNearViewport } from '../../hooks/useNearViewport'
import { CARD_ART_ASPECT, CARD_WIDTH, type CardMediaKind } from '../cards/cardGeometry'

/**
 * DEFERRED CARDS (D165, owner report 2026-11-05: "it still feels laggy as
 * hell as cards are loaded in"). Home mounts nine rows at once — 108
 * AnimeCards, each with its own hooks, effects, proximity observer and image
 * gate — even though only the first row or two are on screen. The initial
 * commit, style and layout of those offscreen cards is the load-phase jank
 * (measured at 4x CPU: 133ms of blocking time and a ~400ms style/layout
 * frame). A row now mounts its cards only when it comes within 700px of the
 * viewport; until then it paints static, same-geometry placeholders (no
 * shimmer, no pulse), so the page height and scrollbar are unchanged.
 *
 * RUNWAY (owner 2026-11-06: "i can see rows appearing as i scroll down
 * appearing out of nowhere, make it load slightly more"): the first gate was
 * 400px — under three row pitches on a phone (measured: 157px per row at
 * 375px wide), so a flick reached a row before React had committed it and the
 * placeholders visibly turned into cards mid-scroll. 700px mounts roughly four
 * rows ahead of the thumb. It cannot be much larger than this: the phone feed
 * is only ~1.8k px tall, so a one-screen runway would mount every row and
 * bring back the original load freeze.
 */
function DeferredCards({ mediaKind }: { mediaKind: CardMediaKind }) {
  return (
    <>
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          aria-hidden
          className={`${CARD_ART_ASPECT[mediaKind]} ${CARD_WIDTH.rail} shrink-0 rounded-[6px] bg-[var(--surface)]`}
        />
      ))}
    </>
  )
}

export function ContentRow({
  title,
  subtitle,
  children,
  mediaKind = 'anime',
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
  /** Shape of the placeholder cards painted before the row mounts. */
  mediaKind?: CardMediaKind
}) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const { ref: gateRef, near } = useNearViewport<HTMLDivElement>({ rootMargin: '700px 0px' })
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)
  const [scrollable, setScrollable] = useState(false)

  const updateArrows = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    setScrollable(max > 4)
    setCanLeft(el.scrollLeft > 4)
    setCanRight(el.scrollLeft < max - 4)
  }, [])

  useEffect(() => {
    // Deferred rows have no cards yet: measuring them would force a layout
    // for a scroller that is about to be replaced (and 9 of those on Home's
    // first commit is real work). Measure once the row is mounted.
    if (!near) return
    updateArrows()
    const el = scrollerRef.current
    if (!el) return
    el.addEventListener('scroll', updateArrows, { passive: true })
    window.addEventListener('resize', updateArrows)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(updateArrows) : null
    if (ro) ro.observe(el)
    return () => {
      el.removeEventListener('scroll', updateArrows)
      window.removeEventListener('resize', updateArrows)
      if (ro) ro.disconnect()
    }
  }, [updateArrows, children, near])

  const scroll = (dir: 1 | -1) => {
    const el = scrollerRef.current
    if (!el) return
    // Move exactly one card so items stay aligned after every click.
    const first = el.firstElementChild as HTMLElement | null
    const gap = parseFloat(getComputedStyle(el).columnGap || '8') || 0
    const step = (first ? first.getBoundingClientRect().width : 320) + gap
    const target = Math.round((el.scrollLeft + dir * step) / step) * step
    el.scrollTo({ left: Math.max(0, target), behavior: 'smooth' })
  }

  return (
    <section className="content-row group/row relative">
      <div className="mb-2 flex items-baseline justify-between gap-2 lg:px-0">
        <h2 className="min-w-0 flex-1 truncate text-[14px] font-semibold tracking-[-0.01em] text-[var(--text)]">{title}</h2>
        {subtitle && <span className="shrink-0 text-[14px] text-[var(--text-faint)]">{subtitle}</span>}
      </div>

      <div className="relative">
        {/* Left/right controls — desktop only, on row hover. BOTH stay
            mounted while the row can scroll: the unusable side is dimmed and
            inert instead of unmounting. The old bounds-gated render made the
            clicked arrow vanish mid smooth-scroll (the scroll crossed the
            4px threshold and canRight flipped false) and reappear — owner
            report 2026-10-29. z-30 keeps the scrim + glyph above the card's
            hover play glyph (z-10) and dots trigger (z-20) — the card paints
            later in DOM order, so an equal z-index would let the play button
            swallow the click. The scrim is the only chrome: no circle behind
            the chevron. */}
        {scrollable && (
          <button
            aria-label="Scroll left"
            aria-disabled={!canLeft}
            tabIndex={canLeft ? 0 : -1}
            onClick={() => { if (canLeft) scroll(-1) }}
            className={`row-arrow row-arrow-fade-l hover-only-control absolute left-0 top-1/2 z-30 hidden h-full -translate-y-1/2 items-center justify-center px-2 text-[var(--text)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--border-strong)] md:flex ${
              canLeft ? 'opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100' : 'pointer-events-none cursor-default opacity-0 group-hover/row:opacity-30'
            }`}
            style={{ width: 56 }}
          >
            <Icon name="chevron-left" size={24} className="[filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.55))]" />
          </button>
        )}
        {scrollable && (
          <button
            aria-label="Scroll right"
            aria-disabled={!canRight}
            tabIndex={canRight ? 0 : -1}
            onClick={() => { if (canRight) scroll(1) }}
            className={`row-arrow row-arrow-fade-r hover-only-control absolute right-0 top-1/2 z-30 hidden h-full -translate-y-1/2 items-center justify-center px-2 text-[var(--text)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--border-strong)] md:flex ${
              canRight ? 'opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100' : 'pointer-events-none cursor-default opacity-0 group-hover/row:opacity-30'
            }`}
            style={{ width: 56 }}
          >
            <Icon name="chevron-right" size={24} className="[filter:drop-shadow(0_1px_2px_rgba(0,0,0,0.55))]" />
          </button>
        )}

        <div
          ref={(el) => {
            scrollerRef.current = el
            gateRef.current = el
          }}
          className="no-scrollbar flex snap-x gap-2 overflow-x-auto scroll-smooth pb-1 pt-1 [scroll-snap-type:x_proximity] [scroll-padding-left:0] lg:px-0"
          style={{ scrollbarWidth: 'none' }}
        >
          {near ? children : <DeferredCards mediaKind={mediaKind} />}
          {/* tail spacer */}
          <div className="w-4 shrink-0 lg:w-0" aria-hidden />
        </div>
      </div>
    </section>
  )
}
