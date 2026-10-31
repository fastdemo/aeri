import { useRef, useEffect, useState, useCallback } from 'react'
import { Icon } from '../ui/Icon'

export function ContentRow({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  const scrollerRef = useRef<HTMLDivElement>(null)
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
  }, [updateArrows, children])

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
    <section className="group/row relative">
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
          ref={scrollerRef}
          className="no-scrollbar flex snap-x gap-2 overflow-x-auto scroll-smooth pb-1 pt-1 [scroll-snap-type:x_proximity] [scroll-padding-left:0] lg:px-0"
          style={{ scrollbarWidth: 'none' }}
        >
          {children}
          {/* tail spacer */}
          <div className="w-4 shrink-0 lg:w-0" aria-hidden />
        </div>
      </div>
    </section>
  )
}
