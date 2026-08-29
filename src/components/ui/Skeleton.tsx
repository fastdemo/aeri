export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div className={`relative overflow-hidden rounded bg-[var(--surface)] ${className}`} aria-hidden>
      <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.4s_infinite] bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
    </div>
  )
}

export function CardSkeleton() {
  return (
    <div className="w-[168px] sm:w-[200px] lg:w-[236px] shrink-0 overflow-hidden rounded-[6px] bg-[var(--surface)] ring-1 ring-white/5">
      <Skeleton className="aspect-[16/9] w-full rounded-none" />
    </div>
  )
}

export function RowSkeleton({ title = 'Loading' }: { title?: string }) {
  return (
    <section>
      <div className="mb-2 flex items-baseline gap-2 px-4 sm:px-6 lg:px-0">
        <div className="h-3 w-28 rounded bg-white/10" />
      </div>
      <div className="flex gap-2 overflow-hidden px-4 sm:px-6 lg:px-0">
        {Array.from({ length: 6 }).map((_, i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
      <p className="sr-only">{title}</p>
    </section>
  )
}
