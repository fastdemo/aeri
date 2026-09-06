import { useRef, useEffect, useState, useCallback } from 'react'

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

  const updateArrows = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    setCanLeft(el.scrollLeft > 4)
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
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
      <div className="mb-2 flex items-baseline justify-between gap-2 px-4 sm:px-6 lg:px-0">
        <h2 className="min-w-0 flex-1 truncate text-[14px] font-semibold tracking-[-0.01em] text-white">{title}</h2>
        {subtitle && <span className="shrink-0 text-[14px] text-white/50">{subtitle}</span>}
      </div>

      <div className="relative">
        {/* Left/right controls — desktop only, on row hover, and only in the
            direction that can actually scroll */}
        {canLeft && (
          <button
            aria-label="Scroll left"
            onClick={() => scroll(-1)}
            className="absolute left-0 top-1/2 z-10 hidden h-full -translate-y-1/2 items-center justify-center bg-gradient-to-r from-black/60 to-transparent px-2 text-white opacity-0 transition hover:opacity-100 focus-visible:opacity-100 group-hover/row:opacity-100 md:flex"
            style={{ width: 56 }}
          >
            <span className="grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white backdrop-blur">‹</span>
          </button>
        )}
        {canRight && (
          <button
            aria-label="Scroll right"
            onClick={() => scroll(1)}
            className="absolute right-0 top-1/2 z-10 hidden h-full -translate-y-1/2 items-center justify-center bg-gradient-to-l from-black/60 to-transparent px-2 text-white opacity-0 transition hover:opacity-100 focus-visible:opacity-100 group-hover/row:opacity-100 md:flex"
            style={{ width: 56 }}
          >
            <span className="grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white backdrop-blur">›</span>
          </button>
        )}

        <div
          ref={scrollerRef}
          className="no-scrollbar flex snap-x snap-mandatory gap-2 overflow-x-auto scroll-smooth px-4 pb-1 pt-1 sm:px-6 lg:px-0"
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
