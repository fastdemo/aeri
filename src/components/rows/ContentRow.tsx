import { useRef } from 'react'

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

  const scroll = (dir: 1 | -1) => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollBy({ left: dir * 320, behavior: 'smooth' })
  }

  return (
    <section className="group/row relative">
      <div className="mb-2 flex items-baseline gap-2 px-4 sm:px-6 lg:px-0">
        <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-white">{title}</h2>
        {subtitle && <span className="text-xs text-white/50">{subtitle}</span>}
        <span className="hidden text-[12px] font-medium text-white/0 transition-colors group-hover/row:text-white/60 sm:inline">
          {/* hint */}
        </span>
      </div>

      <div className="relative">
        {/* Left/right controls — desktop only, subtle */}
        <button
          aria-label="Scroll left"
          onClick={() => scroll(-1)}
          className="absolute left-0 top-1/2 z-10 hidden h-full -translate-y-1/2 items-center justify-center bg-gradient-to-r from-black/60 to-transparent px-2 text-white opacity-0 transition hover:opacity-100 focus:opacity-100 group-hover/row:opacity-100 md:flex"
          style={{ width: 56 }}
        >
          <span className="grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white backdrop-blur">‹</span>
        </button>
        <button
          aria-label="Scroll right"
          onClick={() => scroll(1)}
          className="absolute right-0 top-1/2 z-10 hidden h-full -translate-y-1/2 items-center justify-center bg-gradient-to-l from-black/60 to-transparent px-2 text-white opacity-0 transition hover:opacity-100 focus:opacity-100 group-hover/row:opacity-100 md:flex"
          style={{ width: 56 }}
        >
          <span className="grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white backdrop-blur">›</span>
        </button>

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
