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
      <div className="relative aspect-[16/9] w-full overflow-hidden sm:aspect-[21/9] sm:min-h-[400px] lg:aspect-[2.2/1] lg:min-h-[460px] lg:max-h-[640px]">
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

        {/* Content. Alignment ladder (owner rule 2026-10-18): the text
            stack is vertically CENTERED whenever the hero box is tall
            enough (sm+); bottom-left is reserved for the too-small band
            (<640), where the carousel dots-pill moves to the top-right —
            the two modes always travel together. */}
        <div className="absolute inset-0 flex">
          <div className="flex w-full max-w-[560px] flex-col justify-end gap-3 px-5 pb-6 pt-16 sm:justify-center sm:pl-12 sm:pr-8 sm:pt-8 sm:pb-8 lg:pl-12 lg:pt-8 lg:pb-8 lg:pr-0">
            <h1 className="clamp-2 overflow-hidden shrink-0 text-[22px] font-semibold leading-[1.05] tracking-[-0.03em] text-[var(--text)] sm:text-[30px] sm:clamp-3 lg:text-[34px]">
              {titles.primary}
            </h1>

            {titles.native && (
              <p className="-mt-1 hidden shrink-0 text-[12px] tracking-wide text-[var(--text-muted)] sm:block">{titles.native}</p>
            )}
            {titles.romaji && (
              <p className="-mt-1 hidden shrink-0 text-[11px] tracking-wide text-[var(--text-faint)] sm:block">{titles.romaji}</p>
            )}

            <p className="shrink-0 text-[12px] font-medium tracking-wide text-[var(--text-muted)] flex items-center gap-2">
              <span>{metaParts}</span>
              <ScoreBadge anime={anime} trackingProvider={trackingProvider} />
            </p>

            <p className="hero-desc clamp-3 shrink-0 max-w-[520px] text-[13px] leading-6 text-[var(--text-muted)] sm:text-[14px]">
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
const KENBURN_MS = 6500

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
  // Outgoing slide for the crossfade layer. Recorded synchronously in
  // setSlide (event time, before React batches the index change) — an
  // effect-based trail ran one commit late and could flash the wrong
  // underlay between rapid manual navigation.
  const [prevIdx, setPrevIdx] = useState<number | null>(null)
  const indexRef = useRef(0)
  const [paused, setPaused] = useState(false)
  const timerRef = useRef<number | null>(null)
  const containerRef = useRef<HTMLElement | null>(null)

  // Keep index in bounds if the list shrinks (also clears the trail so a
  // stale outgoing slide can never render).
  useEffect(() => {
    if (index >= animes.length) {
      setPrevIdx(null)
      indexRef.current = 0
      setIndex(0)
    }
  }, [animes.length, index])

  const prefersReducedMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  // Single choke point for slide changes: records the outgoing slide for
  // the crossfade layer, keeps the ref in sync (interval ticks need the
  // current index synchronously), no-ops when the target is already
  // active. All hooks above the early return — no conditional hook paths.
  const setSlide = useCallback(
    (next: number) => {
      const n = animes.length
      const bounded = ((next % n) + n) % n
      if (bounded === indexRef.current) return
      setPrevIdx(indexRef.current)
      indexRef.current = bounded
      setIndex(bounded)
    },
    [animes.length],
  )

  const restartTimer = useCallback(() => {
    // Reset interval so a user has full reading time after manual nav.
    if (timerRef.current) window.clearInterval(timerRef.current)
    if (!prefersReducedMotion && !paused && animes.length > 1) {
      timerRef.current = window.setInterval(() => setSlide(indexRef.current + 1), INTERVAL_MS)
    }
  }, [animes.length, paused, prefersReducedMotion, setSlide])

  const advance = useCallback(() => setSlide(indexRef.current + 1), [setSlide])

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
      setSlide(next)
      restartTimer()
    },
    [setSlide, restartTimer],
  )

  // Touch/drag swipe: horizontal pointer drag switches slides. Vertical
  // drags (page scroll) are untouched — only a predominantly-horizontal
  // gesture with real displacement navigates. No library, no scroll lock.
  const dragRef = useRef<{ x: number; y: number; active: boolean } | null>(null)
  // Timestamp of the last swipe-navigation. A touch drag that ends over a
  // side click-zone can still dispatch a click at its end point — the zones
  // ignore clicks within a short window after a swipe so one gesture never
  // advances two slides.
  const lastNavRef = useRef(0)
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
    lastNavRef.current = Date.now()
    go(index + (dx < 0 ? 1 : -1))
  }
  const onPointerCancel = () => { dragRef.current = null }

  if (!animes.length) return null
  const active = animes[index]!

  // Outgoing slide still paints underneath while the incoming image loads
  // (and eases out over the crossfade once it is) — never a blank window,
  // never a mid-load text-over-wrong-image frame. Recorded synchronously
  // in setSlide; the keyed HeroSlide remount owns the new layer's
  // load/error flags, so no trailing-effect bookkeeping remains.
  const prev =
    prevIdx !== null && prevIdx !== index && prevIdx < animes.length
      ? animes[prevIdx]!
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
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-[var(--surface)] sm:aspect-[21/9] sm:min-h-[400px] lg:aspect-[2.2/1] lg:min-h-[460px] lg:max-h-[640px]" style={{ touchAction: 'pan-y' }}>
        <HeroSlide
          key={active.identity.internalId}
          anime={active}
          prevAnime={prev}
          prefersReducedMotion={prefersReducedMotion}
          trackingProvider={trackingProvider}
          onMoreInfo={onMoreInfo}
        />

        {/* Side click-zones + dots — Netflix/minimal style */}
        {animes.length > 1 && (
          <>
            {/* Invisible side click-zones (owner 2026-10-18: the arrow
                ICONS are removed indefinitely — the left side AREA of the
                hero navigates back, the right side AREA forward). Real
                buttons for keyboard/AT parity, but no chrome at rest; a
                keyboard focus shows only a thin inset ring. They sit above
                the gradients but UNDER the dots pill (z-20); the slide's
                text column is pointer-events-none except its Play/More
                Info controls, so taps on empty hero areas — including over
                the text stack — always reach a zone. The swipe guard stops
                a drag ending over a zone from navigating twice. */}
            <button
              onClick={() => { if (Date.now() - lastNavRef.current < 500) return; go(index - 1) }}
              aria-label="Previous featured title"
              className="absolute inset-y-0 left-0 z-10 w-[16%] cursor-default bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--border-strong)] sm:w-[18%]"
            />
            <button
              onClick={() => { if (Date.now() - lastNavRef.current < 500) return; go(index + 1) }}
              aria-label="Next featured title"
              className="absolute inset-y-0 right-0 z-10 w-[16%] cursor-default bg-transparent outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--border-strong)] sm:w-[18%]"
            />

            {/* Pill dots: bottom-center on desktop; on mobile tucked into
                the top-right corner (out of the text column's way — the
                shorter 4:3 hero has no free bottom edge: bottom-3 collides
                with More Info, bottom-16 collides with the meta line).
                z-20 keeps the pill above the side click-zones so dot taps
                never navigate sideways. */}
            <div className="absolute right-3 top-3 z-20 flex items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--bg)_45%,transparent)] px-2.5 py-1.5 backdrop-blur sm:bottom-4 sm:left-1/2 sm:right-auto sm:top-auto sm:-translate-x-1/2">
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

      {/* Keyframes: text rise-in, image fade-in, ken-burns zoom-out. All
          MOUNT-triggered — they restart exactly when the keyed HeroSlide
          remounts, deterministically, whether or not the image was in the
          HTTP cache. (The old transition-from-onLoad silently skipped the
          zoom for cached images: React batched away the initial scale(1.04)
          style before any paint, so there was nothing to transition.) */}
      <style>{`@keyframes aeri-hero-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}@keyframes aeri-hero-fade{from{opacity:0}to{opacity:1}}@keyframes aeri-hero-kb{from{transform:scale(1.04)}to{transform:scale(1)}}`}</style>
    </section>
    </CarouselShell>
  )
}

// ---------------------------------------------------------------------------
// HeroSlide — one keyed slide (backdrop layers + gradients + text column).
// Keyed by the anime id in the parent, so a slide change REMOUNTS this
// component: its load flags reset to fresh useState and every mount-run
// keyframe restarts. Text mounts only after its own image is ready —
// title/description can never pair with another slide's picture again.
// ---------------------------------------------------------------------------
function HeroSlide({
  anime,
  prevAnime,
  prefersReducedMotion,
  trackingProvider,
  onMoreInfo,
}: {
  anime: Anime
  prevAnime?: Anime
  prefersReducedMotion: boolean
  trackingProvider?: 'anilist' | 'mal' | null
  onMoreInfo?: (anime: Anime) => void
}) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  // The mismatch fix: hold the text column until the incoming image is
  // ready (or has failed). Before, the text keyed in immediately while
  // its image stayed at opacity 0 until onLoad — the previous slide's
  // picture sat under the INCORRECT new title/description for the whole
  // load window, reading as "wrong show's name over another show's art".
  const contentReady = loaded || failed

  return (
    <>
      {/* Outgoing image underneath: static at scale(1), eases out once the
          incoming image reports loaded. On an incoming-image error it
          STAYS visible — the outgoing layer must never be dropped into a
          blank hero (the old code suppressed it on error). */}
      {prevAnime && (
        <img
          src={prevAnime.backdropImage}
          alt=""
          aria-hidden
          loading="eager"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
          style={{
            opacity: loaded ? 0 : 1,
            transition: prefersReducedMotion ? 'none' : `opacity ${CROSSFADE_MS}ms ease`,
          }}
        />
      )}
      {/* Incoming image: fade + slow ken-burns zoom-out via one mount-run
          keyframe pair — no transition timing games, no skipped animation
          on cached images. On failed load it paints nothing (opacity 0)
          and the outgoing layer remains visible under the text. */}
      <img
        src={anime.backdropImage}
        alt=""
        aria-hidden
        loading="eager"
        decoding="async"
        fetchPriority="high"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        className="absolute inset-0 h-full w-full object-cover"
        style={
          failed
            ? { opacity: 0 }
            : prefersReducedMotion
              ? { opacity: 1 }
              : {
                  animation: `aeri-hero-fade ${CROSSFADE_MS}ms ease both, aeri-hero-kb ${KENBURN_MS}ms ease-out both`,
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

      {/* Text rises in only when it can be trusted to match the picture. */}
      {contentReady && (
        <div
          className="pointer-events-none z-20 absolute inset-0 flex"
          style={
            prefersReducedMotion
              ? undefined
              : { animation: `aeri-hero-in ${CROSSFADE_MS}ms ease` }
          }
        >
          {/* Text column: pointer-events-none so the carousel's invisible
              side click-zones stay reachable everywhere except the actual
              controls — Play/More Info re-enable pointer events themselves.
              Hero text is display copy, never selection targets. The
              sm:pr-12 / pr-[min(56px,7vw)] reservations keep the stack off
              the right click-zone edge; they were tuned against the old
              arrow chips and stay so title wrapping never changes. */}
          <div className="pointer-events-none flex w-full max-w-[560px] min-w-0 flex-col justify-end gap-2 px-5 pb-6 pr-[min(56px,7vw)] pt-16 sm:justify-center sm:gap-3 sm:pl-12 sm:pr-12 sm:pt-8 sm:pb-8 lg:pt-8 lg:pb-8 lg:pl-12 lg:pr-0">
            {(() => {
              const titles = getTitleHierarchy(anime)
              const metaParts = [
                anime.format ?? 'TV',
                anime.year,
                anime.episodes ? `${anime.episodes} Episodes` : null,
              ]
                .filter(Boolean)
                .join(' • ')
              return (
                <>
                  {/* Mobile: shorter hero — title clamps to 2 lines, no
                      description, compact pills. Desktop unchanged.
                      Native title hidden on mobile too: with a 2-line
                      primary + meta + pills the column overflows the
                      shorter hero and the dots pill collides with More
                      Info (see mobile screenshot). */}
                  {/* clamp-2 (globals.css): engines compute the legacy
                      display:-webkit-box to flow-root on these nodes, so
                      only the unprefixed new-model clamp renders (and it
                      needs `line-clamp: N ellipsis` to paint the
                      ellipsis — the plain classes carry both). Sm variant
                      switches via sm:clamp-3, NOT an arbitrary
                      [-webkit-line-clamp:3] utility: unlayered plain CSS
                      wins over utility-layer rules at equal specificity,
                      so a utility override would silently keep clamp-2. */}
                  <h1
                    className="clamp-2 overflow-hidden shrink-0 text-[22px] font-semibold leading-[1.15] tracking-[-0.03em] text-[var(--text)] sm:text-[26px] sm:clamp-3 lg:text-[34px] lg:leading-[1.05]"
                  >
                    {titles.primary}
                  </h1>
                  {titles.native && <p className="-mt-1 hidden shrink-0 text-[12px] tracking-wide text-[var(--text-muted)] sm:block">{titles.native}</p>}
                  {titles.romaji && <p className="-mt-1 hidden shrink-0 text-[11px] tracking-wide text-[var(--text-faint)] sm:block">{titles.romaji}</p>}
                  <p className="shrink-0 text-[12px] font-medium tracking-wide text-[var(--text-muted)] flex items-center gap-2">
                    <span>{metaParts}</span>
                    <ScoreBadge anime={anime} trackingProvider={trackingProvider} />
                  </p>
                  <p className="hero-desc clamp-3 shrink-0 max-w-[520px] text-[13px] leading-6 text-[var(--text-muted)] sm:text-[14px]">
                    {anime.description}
                  </p>
                  <div className="mt-1 flex shrink-0 items-center gap-2">
                    <Link
                      to={`/watch/${anime.identity.internalId}/1`}
                      className="pointer-events-auto z-20 inline-flex h-7 items-center gap-1.5 rounded-full bg-[var(--text)] px-4 text-[12px] font-semibold text-[var(--on-text)] transition hover:bg-[color-mix(in_srgb,var(--text)_90%,transparent)] active:scale-[0.98] sm:h-8 sm:px-5 sm:text-[13px]"
                    >
                      <Icon name="play-fill" size={14} />
                      Play
                    </Link>
                    <button
                      onClick={() => onMoreInfo?.(anime)}
                      className="pointer-events-auto z-20 inline-flex h-7 items-center rounded-full bg-[color-mix(in_srgb,var(--text)_14%,transparent)] px-4 text-[12px] font-medium text-[var(--text)] backdrop-blur transition hover:bg-[color-mix(in_srgb,var(--text)_20%,transparent)] sm:h-8 sm:text-[13px]"
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
      )}
    </>
  )
}

function CarouselShell({ children }: { children: React.ReactNode }) {
  // Own stacking context + clip boundary: the ken-burns scale on backdrop
  // images must never paint outside the rounded hero at any viewport.
  // translateZ(0) forces the compositor to respect overflow + radius.
  //
  // FRAME LINE (owner 2026-10-25): the hero shares the card frame's 1px
  // hairline (--border-card, 50% of --border-strong) on a frosted rim
  // (.frame-glass — same blur language as the nav/chips/hover treatment).
  // Drawn as an overlay instead of a real border: a border on this
  // composited, overflow-clipped layer made Chrome tile stale
  // backdrop-filter snapshots into the slide artwork, and an overlay cannot
  // shift the 1px layout the carousel's ken-burns geometry depends on.
  return (
    <div className="relative overflow-hidden rounded-xl sm:rounded-[14px] [transform:translateZ(0)] [isolation:isolate]">
      {children}
      <div aria-hidden className="frame-glass z-30" />
    </div>
  )
}
