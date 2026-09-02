import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Anime } from '../../types/anime'
import { getTitleHierarchy } from '../../lib/titles'

export function Hero({ anime, onMoreInfo }: { anime: Anime; onMoreInfo?: () => void }) {
  const titles = getTitleHierarchy(anime, null)
  const metaParts = [anime.format ?? 'TV', anime.year, anime.episodes ? `${anime.episodes} Episodes` : null].filter(Boolean).join(' · ')

  return (
    <section className="relative overflow-hidden rounded-xl bg-[var(--surface)] sm:rounded-[14px]">
      {/* Backdrop image */}
      <div className="relative aspect-[16/9] w-full overflow-hidden sm:aspect-[21/9] lg:aspect-[2.2/1] lg:min-h-[460px] lg:max-h-[640px]">
        <img
          src={anime.backdropImage}
          alt=""
          className="h-full w-full object-cover"
          loading="eager"
          decoding="async"
          fetchPriority="high"
        />

        {/* Gradients — cinematic */}
        {/* left */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(90deg, rgba(7,7,8,0.96) 0%, rgba(7,7,8,0.78) 22%, rgba(7,7,8,0.45) 42%, rgba(7,7,8,0.14) 62%, transparent 78%)',
          }}
        />
        {/* bottom */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(0deg, var(--bg) 0%, rgba(7,7,8,0.85) 8%, rgba(7,7,8,0.45) 22%, transparent 46%)',
          }}
        />
        {/* top subtle for nav */}
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/40 to-transparent"
        />

        {/* Content */}
        <div className="absolute inset-0 flex">
          <div className="flex w-full max-w-[560px] flex-col justify-end gap-3 px-5 pb-6 pt-16 sm:px-8 sm:pb-8 lg:justify-center lg:pb-0 lg:pl-12 lg:pr-0">
            <h1 className="text-[22px] font-semibold leading-[1.05] tracking-[-0.03em] text-white sm:text-[30px] lg:text-[34px]">
              {titles.primary}
            </h1>

            {titles.native && (
              <p className="-mt-1 text-[12px] tracking-wide text-white/70">{titles.native}</p>
            )}
            {titles.romaji && (
              <p className="-mt-1 text-[11px] tracking-wide text-white/50">{titles.romaji}</p>
            )}

            <p className="text-[12px] font-medium tracking-wide text-white/70 flex items-center gap-2">
              <span>{metaParts}</span>
              {anime.rating && (
                <span className="inline-flex items-center gap-1 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                  <span className="text-amber-300">★</span> {anime.rating.toFixed(1)}
                </span>
              )}
            </p>

            <p className="line-clamp-2 max-w-[520px] text-[13px] leading-6 text-white/75 sm:line-clamp-3 sm:text-[14px]">
              {anime.description}
            </p>

            <div className="mt-1 flex items-center gap-2">
              <Link
                to={`/watch/${anime.identity.internalId}/1`}
                className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white px-5 text-[13px] font-semibold text-black transition hover:bg-white/90 active:scale-[0.98]"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M8 5.14v13.72L19 12z" />
                </svg>
                Play
              </Link>
              <button
                onClick={onMoreInfo}
                className="inline-flex h-8 items-center rounded-full bg-white/14 px-4 text-[13px] font-medium text-white backdrop-blur transition hover:bg-white/20"
                aria-label={`More info about ${titles.primary}`}
              >
                More Info
              </button>
            </div>
          </div>

          {/* Right side muted artwork hint for desktop - keeps empty so image breathes */}
          <div className="hidden flex-1 lg:block" />
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------
// HeroCarousel — auto-cycling hero used on Home
// ---------------------------------------------------------------------------

const INTERVAL_MS = 5500
const CROSSFADE_MS = 700

export function HeroCarousel({
  animes,
  onMoreInfo,
}: {
  animes: Anime[]
  onMoreInfo?: (anime: Anime) => void
}) {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const timerRef = useRef<number | null>(null)
  const containerRef = useRef<HTMLElement | null>(null)

  // keep index in bounds if list shrinks
  useEffect(() => {
    if (index >= animes.length) setIndex(0)
  }, [animes.length, index])

  const prefersReducedMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const advance = useCallback(() => {
    setIndex((i) => (i + 1) % animes.length)
  }, [animes.length])

  // auto-cycle
  useEffect(() => {
    if (prefersReducedMotion || animes.length <= 1 || paused) return
    if (typeof document !== 'undefined' && document.hidden) return
    timerRef.current = window.setInterval(advance, INTERVAL_MS)
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
  }, [advance, animes.length, paused, prefersReducedMotion])

  // pause when tab hidden
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) {
        if (timerRef.current) window.clearInterval(timerRef.current)
      } else if (!paused && !prefersReducedMotion && animes.length > 1) {
        timerRef.current = window.setInterval(advance, INTERVAL_MS)
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [advance, animes.length, paused, prefersReducedMotion])

  const go = useCallback(
    (next: number) => {
      setIndex(((next % animes.length) + animes.length) % animes.length)
      // reset interval so user has full time to read after manual nav
      if (timerRef.current) window.clearInterval(timerRef.current)
      if (!prefersReducedMotion && !paused && animes.length > 1) {
        timerRef.current = window.setInterval(advance, INTERVAL_MS)
      }
    },
    [advance, animes.length, paused, prefersReducedMotion],
  )

  if (!animes.length) return null
  const active = animes[index]!

  return (
    <section
      ref={containerRef as never}
      className="relative overflow-hidden rounded-xl bg-[var(--surface)] sm:rounded-[14px]"
      aria-roledescription="carousel"
      aria-label="Featured anime"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setPaused(false)
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          go(index - 1)
        } else if (e.key === 'ArrowRight') {
          e.preventDefault()
          go(index + 1)
        }
      }}
    >
      <div className="relative aspect-[16/9] w-full overflow-hidden sm:aspect-[21/9] lg:aspect-[2.2/1] lg:min-h-[460px] lg:max-h-[640px]">
        {/* Stacked backdrops for crossfade */}
        {animes.map((a, i) => {
          const isActive = i === index
          return (
            <img
              key={a.identity.internalId}
              src={a.backdropImage}
              alt=""
              aria-hidden
              loading={i === 0 ? 'eager' : 'lazy'}
              decoding="async"
              fetchPriority={i === 0 ? 'high' : 'low'}
              className="absolute inset-0 h-full w-full object-cover"
              style={{
                opacity: isActive ? 1 : 0,
                transition: prefersReducedMotion ? 'none' : `opacity ${CROSSFADE_MS}ms ease`,
                // subtle ken-burns on active only, paused when reduced motion
                transform: isActive && !prefersReducedMotion ? 'scale(1)' : 'scale(1.04)',
                transitionProperty: 'opacity, transform',
                transitionDuration: `${CROSSFADE_MS}ms, 6500ms`,
                transitionTimingFunction: 'ease, ease-out',
              }}
            />
          )
        })}

        {/* Gradients — cinematic, always on top of images */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(90deg, rgba(7,7,8,0.96) 0%, rgba(7,7,8,0.78) 22%, rgba(7,7,8,0.45) 42%, rgba(7,7,8,0.14) 62%, transparent 78%)',
          }}
        />
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(0deg, var(--bg) 0%, rgba(7,7,8,0.85) 8%, rgba(7,7,8,0.45) 22%, transparent 46%)',
          }}
        />
        <div aria-hidden className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/40 to-transparent" />

        {/* Content — keyed so text crossfades */}
        <div
          key={active.identity.internalId}
          className="absolute inset-0 flex"
          style={
            prefersReducedMotion
              ? undefined
              : { animation: `aeri-hero-in ${CROSSFADE_MS}ms ease` }
          }
        >
          <div className="flex w-full max-w-[560px] flex-col justify-end gap-3 px-5 pb-10 pt-16 sm:px-8 sm:pb-12 lg:justify-center lg:pb-0 lg:pl-12 lg:pr-0">
            {(() => {
              const titles = getTitleHierarchy(active, null)
              const metaParts = [
                active.format ?? 'TV',
                active.year,
                active.episodes ? `${active.episodes} Episodes` : null,
              ]
                .filter(Boolean)
                .join(' · ')
              return (
                <>
                  <h1 className="text-[22px] font-semibold leading-[1.05] tracking-[-0.03em] text-white sm:text-[30px] lg:text-[34px]">
                    {titles.primary}
                  </h1>
                  {titles.native && <p className="-mt-1 text-[12px] tracking-wide text-white/70">{titles.native}</p>}
                  {titles.romaji && <p className="-mt-1 text-[11px] tracking-wide text-white/50">{titles.romaji}</p>}
                  <p className="text-[12px] font-medium tracking-wide text-white/70 flex items-center gap-2">
                    <span>{metaParts}</span>
                    {active.rating && (
                      <span className="inline-flex items-center gap-1 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        <span className="text-amber-300">★</span> {active.rating.toFixed(1)}
                      </span>
                    )}
                  </p>
                  <p className="line-clamp-2 max-w-[520px] text-[13px] leading-6 text-white/75 sm:line-clamp-3 sm:text-[14px]">
                    {active.description}
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <Link
                      to={`/watch/${active.identity.internalId}/1`}
                      className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white px-5 text-[13px] font-semibold text-black transition hover:bg-white/90 active:scale-[0.98]"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                        <path d="M8 5.14v13.72L19 12z" />
                      </svg>
                      Play
                    </Link>
                    <button
                      onClick={() => onMoreInfo?.(active)}
                      className="inline-flex h-8 items-center rounded-full bg-white/14 px-4 text-[13px] font-medium text-white backdrop-blur transition hover:bg-white/20"
                      aria-label={`More info about ${titles.primary}`}
                    >
                      More Info
                    </button>
                  </div>
                </>
              )
            })()}
          </div>
          <div className="hidden flex-1 lg:block" />
        </div>

        {/* Dots + prev/next — Netflix/minimal style */}
        {animes.length > 1 && (
          <>
            {/* subtle arrow hitareas (visible on hover/focus) */}
            <button
              onClick={() => go(index - 1)}
              aria-label="Previous featured title"
              className="absolute left-2 top-1/2 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur transition hover:bg-black/60 focus-visible:flex sm:flex sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 sm:hover:opacity-100"
              style={{ opacity: paused ? 1 : undefined }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="m15 18-6-6 6-6" />
              </svg>
            </button>
            <button
              onClick={() => go(index + 1)}
              aria-label="Next featured title"
              className="absolute right-2 top-1/2 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur transition hover:bg-black/60 sm:flex"
              style={{ opacity: paused ? 0.95 : 0.85 }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="m9 18 6-6-6-6" />
              </svg>
            </button>

            {/* Pill dots centered bottom */}
            <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/45 px-2.5 py-1.5 backdrop-blur sm:bottom-4">
              {animes.map((a, i) => {
                const isActive = i === index
                return (
                  <button
                    key={a.identity.internalId}
                    onClick={() => go(i)}
                    aria-label={`Go to ${getTitleHierarchy(a, null).primary}`}
                    aria-current={isActive ? 'true' : undefined}
                    className="group/dot flex h-3 items-center justify-center"
                  >
                    <span
                      className="block h-1.5 rounded-full bg-white transition-all"
                      style={{
                        width: isActive ? 18 : 6,
                        opacity: isActive ? 1 : 0.45,
                      }}
                    />
                  </button>
                )
              })}
            </div>
          </>
        )}
      </div>

      {/* keyframes for text */}
      <style>{`@keyframes aeri-hero-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}`}</style>
    </section>
  )
}
