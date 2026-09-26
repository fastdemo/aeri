import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Anime } from '../../types/anime'
import { getTitleHierarchy } from '../../lib/titles'
import { formatLabel } from '../../lib/mediaLabels'
import { displayRating, formatRating } from '../../lib/rating'
import { Icon } from '../ui/Icon'

function ScoreBadge({ anime, trackingProvider }: { anime: Anime; trackingProvider?: 'anilist' | 'mal' | null }) {
  const text = formatRating(displayRating(anime, trackingProvider))
  if (!text) return null
  return (
    <span className="inline-flex items-center gap-1 rounded bg-[color-mix(in_srgb,var(--text)_10%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text)]">
      <span className="text-[var(--text)]">★</span> {text}
    </span>
  )
}

export function Hero({ anime, onMoreInfo, trackingProvider }: { anime: Anime; onMoreInfo?: () => void; trackingProvider?: 'anilist' | 'mal' | null }) {
  const titles = getTitleHierarchy(anime)
  const metaParts = [formatLabel(anime.format) ?? 'TV', anime.year, anime.episodes ? `${anime.episodes} Episodes` : null].filter(Boolean).join(' • ')

  return (
    <CarouselShell>
    <section className="relative overflow-hidden rounded-xl bg-[var(--surface)] sm:rounded-[14px] [transform:translateZ(0)]">
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

        {/* Gradients — cinematic. The left scrim exists ONLY behind the
            text column (max-w aligned with the content, not full-bleed):
            a full-width 96%-opaque scrim buries the artwork's left ~200px
            in near-black and reads as a cropped/blocked edge. */}
        <div
          aria-hidden
          className="absolute inset-y-0 left-0 w-full max-w-[560px]"
          style={{
            background:
              'linear-gradient(90deg, color-mix(in srgb, var(--bg) 88%, transparent) 0%, color-mix(in srgb, var(--bg) 55%, transparent) 45%, color-mix(in srgb, var(--bg) 22%, transparent) 70%, transparent 100%)',
          }}
        />
        {/* bottom — anchored to the box (inset-x-0 bottom-0, fixed height)
            so rapid slide swaps on mobile can never leave it floating a few
            px above the hero's bottom edge. */}
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-[45%]"
          style={{
            background:
              'linear-gradient(180deg, transparent 0%, color-mix(in srgb, var(--bg) 45%, transparent) 55%, var(--bg) 100%)',
          }}
        />
        {/* top subtle for nav */}
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-[color-mix(in_srgb,var(--bg)_40%,transparent)] to-transparent"
        />

        {/* Content */}
        <div className="absolute inset-0 flex">
          <div className="flex w-full max-w-[560px] flex-col justify-end gap-3 px-5 pb-6 pt-16 sm:px-8 sm:pb-8 lg:justify-center lg:pb-0 lg:pl-12 lg:pr-0">
            <h1 className="text-[22px] font-semibold leading-[1.05] tracking-[-0.03em] text-[var(--text)] sm:text-[30px] lg:text-[34px]">
              {titles.primary}
            </h1>

            {titles.native && (
              <p className="-mt-1 text-[12px] tracking-wide text-[var(--text-muted)]">{titles.native}</p>
            )}
            {titles.romaji && (
              <p className="-mt-1 text-[11px] tracking-wide text-[var(--text-faint)]">{titles.romaji}</p>
            )}

            <p className="text-[12px] font-medium tracking-wide text-[var(--text-muted)] flex items-center gap-2">
              <span>{metaParts}</span>
              <ScoreBadge anime={anime} trackingProvider={trackingProvider} />
            </p>

            <p className="line-clamp-2 max-w-[520px] text-[13px] leading-6 text-[var(--text-muted)] sm:line-clamp-3 sm:text-[14px]">
              {anime.description}
            </p>

            <div className="mt-1 flex items-center gap-2">
              <Link
                to={`/watch/${anime.identity.internalId}/1`}
                className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[var(--text)] px-5 text-[13px] font-semibold text-[var(--on-text)] transition hover:bg-[color-mix(in_srgb,var(--text)_90%,transparent)] active:scale-[0.98]"
              >
                <Icon name="play-fill" size={14} />
                Play
              </Link>
              <button
                onClick={onMoreInfo}
                className="inline-flex h-8 items-center rounded-full bg-[color-mix(in_srgb,var(--text)_14%,transparent)] px-4 text-[13px] font-medium text-[var(--text)] backdrop-blur transition hover:bg-[color-mix(in_srgb,var(--text)_20%,transparent)]"
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
    </CarouselShell>
  )
}

// ---------------------------------------------------------------------------
// HeroCarousel — auto-cycling hero used on Home (carousel rotation only;
// the feed rows below never refresh on their own).
// ---------------------------------------------------------------------------

const INTERVAL_MS = 5500
const CROSSFADE_MS = 700

export function HeroCarousel({
  animes,
  onMoreInfo,
  trackingProvider,
}: {
  animes: Anime[]
  onMoreInfo?: (anime: Anime) => void
  trackingProvider?: 'anilist' | 'mal' | null
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

  // auto-cycle (carousel rotation only — never touches feed rows)
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

  // Touch/drag swipe: horizontal pointer drag switches slides. Vertical
  // drags (page scroll) are untouched — only a predominantly-horizontal
  // gesture with real displacement navigates. No library, no scroll lock.
  const dragRef = useRef<{ x: number; y: number; active: boolean } | null>(null)
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return
    dragRef.current = { x: e.clientX, y: e.clientY, active: true }
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current
    dragRef.current = null
    if (!d?.active || e.pointerType === 'mouse') return
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy) * 1.5) return
    go(index + (dx < 0 ? 1 : -1))
  }
  const onPointerCancel = () => { dragRef.current = null }

  if (!animes.length) return null
  const active = animes[index]!

  // Previous slide: kept mounted underneath while the new one loads, so
  // there is never a blank window. prevIdx trails index by one change:
  // the effect cleanup runs with the OUTGOING index before the new
  // effect sets flags — so cleanup records outgoing, effect resets the
  // new-layer load flags. The new layer starts at scale(1.04) / opacity
  // 0 and eases in on its own onLoad — the old slow zoom-out.
  // NOTE: prevIdx intentionally NEVER clears (stays at the last outgoing
  // slide). Clearing it on load would unmount the old layer mid-zoom and
  // snap the hero to a single static image; keeping it mounted means the
  // old layer (now at scale(1)) simply sits invisible under the new one
  // until the next rotation — zero visual cost, no blank window ever.
  const [prevIdx, setPrevIdx] = useState<number | null>(null)
  const [newLoaded, setNewLoaded] = useState(false)
  const [newFailed, setNewFailed] = useState(false)
  useEffect(() => {
    setNewLoaded(false)
    setNewFailed(false)
    return () => { setPrevIdx(index) }
  }, [index])
  const prev = prevIdx !== null && prevIdx !== index && !newFailed
    ? animes[prevIdx]
    : undefined

  // CarouselShell owns the clip boundary (rounded + composited) so the
  // ken-burns scale on stacked backdrops can never bleed outside the hero
  // at any viewport. The section keeps carousel semantics inside it.
  return (
    <CarouselShell>
    <section
      ref={containerRef as never}
      className="relative overflow-hidden rounded-xl bg-[var(--surface)] sm:rounded-[14px] [transform:translateZ(0)]"
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
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-[var(--surface)] sm:aspect-[21/9] lg:aspect-[2.2/1] lg:min-h-[460px] lg:max-h-[640px]" style={{ touchAction: 'pan-y' }}>
        {/* Two-layer backdrop: the OLD slide keeps painting (with the
            ken-burns scale it accumulated) while the NEW slide mounts on
            top at scale(1.04) and eases to scale(1) over ~6.5s — exactly
            the old slow zoom-out. No blank window is possible: the old
            layer only unmounts after the new image's onLoad fires (plus a
            700ms crossfade), and if the new src 404s/errors we keep the
            old layer rather than showing surface color. */}
        {prev && (
          <img
            src={prev.backdropImage}
            alt=""
            aria-hidden
            loading="eager"
            decoding="async"
            className="absolute inset-0 h-full w-full object-cover"
            style={{
              opacity: newLoaded ? 0 : 1,
              transition: prefersReducedMotion ? 'none' : 'opacity 700ms ease',
              transform: 'scale(1)',
            }}
          />
        )}
        <img
          key={active.identity.internalId}
          src={active.backdropImage}
          alt=""
          aria-hidden
          loading="eager"
          decoding="async"
          fetchPriority="high"
          onLoad={() => setNewLoaded(true)}
          onError={() => setNewFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
          style={
            prefersReducedMotion
              ? { opacity: 1 }
              : {
                  opacity: newLoaded && !newFailed ? 1 : 0,
                  transition: 'opacity 700ms ease, transform 6500ms ease-out',
                  transform: newLoaded && !newFailed ? 'scale(1)' : 'scale(1.04)',
                }
          }
        />

        {/* Gradients — cinematic, always on top of images. Same
            text-column scrim as the static Hero (see above): full-bleed
            96% scrim reads as a cropped left edge. */}
        <div
          aria-hidden
          className="absolute inset-y-0 left-0 w-full max-w-[560px]"
          style={{
            background:
              'linear-gradient(90deg, color-mix(in srgb, var(--bg) 88%, transparent) 0%, color-mix(in srgb, var(--bg) 55%, transparent) 45%, color-mix(in srgb, var(--bg) 22%, transparent) 70%, transparent 100%)',
          }}
        />
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-[45%]"
          style={{
            background:
              'linear-gradient(180deg, transparent 0%, color-mix(in srgb, var(--bg) 45%, transparent) 55%, var(--bg) 100%)',
          }}
        />
        <div aria-hidden className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-[color-mix(in_srgb,var(--bg)_40%,transparent)] to-transparent" />

        {/* Content — keyed so text crossfades. NOTE: the text block and
            the backdrop are SEPARATE keyed subtrees. They must re-mount
            together on slide change (same key), otherwise the text for
            slide N+1 can paint over the still-loading image for slide N —
            a half-dark hero whose left text column looks shifted/cropped
            against the previous image during the swap window. */}
        <div
          key={`content-${active.identity.internalId}`}
          className="absolute inset-0 flex"
          style={
            prefersReducedMotion
              ? undefined
              : { animation: `aeri-hero-in ${CROSSFADE_MS}ms ease` }
          }
        >
          <div className="flex w-full max-w-[560px] flex-col justify-end gap-3 px-5 pb-10 pt-16 sm:px-8 sm:pb-12 lg:justify-center lg:pb-0 lg:pl-12 lg:pr-0">
            {(() => {
              const titles = getTitleHierarchy(active)
              const metaParts = [
                active.format ?? 'TV',
                active.year,
                active.episodes ? `${active.episodes} Episodes` : null,
              ]
                .filter(Boolean)
                .join(' • ')
              return (
                <>
                  <h1 className="text-[22px] font-semibold leading-[1.05] tracking-[-0.03em] text-[var(--text)] sm:text-[30px] lg:text-[34px]">
                    {titles.primary}
                  </h1>
                  {titles.native && <p className="-mt-1 text-[12px] tracking-wide text-[var(--text-muted)]">{titles.native}</p>}
                  {titles.romaji && <p className="-mt-1 text-[11px] tracking-wide text-[var(--text-faint)]">{titles.romaji}</p>}
                  <p className="text-[12px] font-medium tracking-wide text-[var(--text-muted)] flex items-center gap-2">
                    <span>{metaParts}</span>
                    <ScoreBadge anime={active} trackingProvider={trackingProvider} />
                  </p>
                  <p className="line-clamp-2 max-w-[520px] text-[13px] leading-6 text-[var(--text-muted)] sm:line-clamp-3 sm:text-[14px]">
                    {active.description}
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <Link
                      to={`/watch/${active.identity.internalId}/1`}
                      className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[var(--text)] px-5 text-[13px] font-semibold text-[var(--on-text)] transition hover:bg-[color-mix(in_srgb,var(--text)_90%,transparent)] active:scale-[0.98]"
                    >
                      <Icon name="play-fill" size={14} />
                      Play
                    </Link>
                    <button
                      onClick={() => onMoreInfo?.(active)}
                      className="inline-flex h-8 items-center rounded-full bg-[color-mix(in_srgb,var(--text)_14%,transparent)] px-4 text-[13px] font-medium text-[var(--text)] backdrop-blur transition hover:bg-[color-mix(in_srgb,var(--text)_20%,transparent)]"
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
              className="absolute left-2 top-1/2 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--bg)_45%,transparent)] text-[var(--text)] backdrop-blur transition hover:bg-[color-mix(in_srgb,var(--bg)_60%,transparent)] focus-visible:flex sm:flex sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 sm:hover:opacity-100"
              style={{ opacity: paused ? 1 : undefined }}
            >
              <Icon name="chevron-left" size={16} />
            </button>
            <button
              onClick={() => go(index + 1)}
              aria-label="Next featured title"
              className="absolute right-2 top-1/2 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--bg)_45%,transparent)] text-[var(--text)] backdrop-blur transition hover:bg-[color-mix(in_srgb,var(--bg)_60%,transparent)] focus-visible:flex sm:flex sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100 sm:hover:opacity-100"
              style={{ opacity: paused ? 0.95 : undefined }}
            >
              <Icon name="chevron-right" size={16} />
            </button>

            {/* Pill dots centered bottom */}
            <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--bg)_45%,transparent)] px-2.5 py-1.5 backdrop-blur sm:bottom-4">
              {animes.map((a, i) => {
                const isActive = i === index
                return (
                  <button
                    key={a.identity.internalId}
                    onClick={() => go(i)}
                    aria-label={`Go to ${getTitleHierarchy(a).primary}`}
                    aria-current={isActive ? 'true' : undefined}
                    className="group/dot flex h-3 items-center justify-center"
                  >
                    <span
                      className="block h-1.5 rounded-full bg-[var(--text)] transition-all"
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
    </CarouselShell>
  )
}

function CarouselShell({ children }: { children: React.ReactNode }) {
  // Own stacking context + clip boundary: the ken-burns scale on backdrop
  // images must never paint outside the rounded hero at any viewport.
  // translateZ(0) forces the compositor to respect overflow + radius.
  return (
    <div className="relative overflow-hidden rounded-xl sm:rounded-[14px] [transform:translateZ(0)] [isolation:isolate]">
      {children}
    </div>
  )
}
