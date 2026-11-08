import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAniList } from '../../contexts/AniListContext'
import { useMAL } from '../../contexts/MALContext'
import { useTracking } from '../../contexts/TrackingContext'
import { SearchSuggestions } from '../search/SearchSuggestions'
import { SchedulePanel } from './SchedulePanel'
import { HeaderPopup } from './HeaderPopup'
import { pillSolid } from '../ui/buttonStyles'
import { SignInModal } from '../auth/SignInModal'
import { Icon } from '../ui/Icon'
import { useDetailOpen } from '../../hooks/useDetailOpen'
import { refreshAeriTitle } from '../../hooks/useAeriTitle'
import { isIncognitoEnabled, setIncognitoEnabled } from '../../storage/preferences'

/**
 * Section links. Rendered by BOTH the live bar and the hidden measurer, so
 * the fit decision can never drift from the real row (the old hand-copied
 * measurer drifted twice: stale gap, and px-2 counted without the -mx-2
 * that cancels it). Same component ⇒ same widths, always.
 */
function SectionLinks({
  items,
  onSelect,
}: {
  items: Array<{ to: string; label: string }>
  onSelect: (to: string, e: React.MouseEvent) => void
}) {
  return (
    <nav className="flex items-center gap-5 lg:gap-6" aria-label="Sections">
      {items.map((l) => (
        <NavLink
          key={l.to}
          to={l.to}
          onClick={(e) => onSelect(l.to, e)}
          className={({ isActive }) =>
            `touch-manipulation whitespace-nowrap text-[13px] font-medium transition-colors px-2 py-1.5 rounded -mx-2 ${
              isActive ? 'text-[var(--text)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'
            }`
          }
          style={{ touchAction: 'manipulation' } as any}
        >
          {l.label}
        </NavLink>
      ))}
    </nav>
  )
}

export function Navbar() {
  const [scrolled, setScrolled] = useState(false)
  // Does the current page paint a hero wash? HeroAmbient announces itself
  // (D170). The bar's ambient copy is MOUNTED only while a wash exists: the
  // old always-mounted layer was an empty blurred + gradient-masked composited
  // layer on every page, and iOS smeared that layer after exiting fullscreen
  // (owner report 2026-11-07). `ambientMounted` keeps it alive for the 300ms
  // scroll fade-out, then drops the filtered layer entirely.
  const [hasWash, setHasWash] = useState(false)
  const [ambientMounted, setAmbientMounted] = useState(false)
  // Fullscreen round-trips can leave a stale composited sample of the bar's
  // filtered ambient layer on WebKit. Bumping this key remounts the layer so
  // the browser rebuilds it from scratch (D170).
  const [ambientEpoch, setAmbientEpoch] = useState(0)
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [signInOpen, setSignInOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [scheduleOpen, setScheduleOpen] = useState(false)
  // Incognito: profile-menu toggle, persisted pref.
  const [incognito, setIncognitoState] = useState(() => isIncognitoEnabled())
  const toggleIncognito = () => {
    const next = !incognito
    setIncognitoEnabled(next)
    setIncognitoState(next)
    refreshAeriTitle()
  }
  const profileRef = useRef<HTMLDivElement>(null)
  const scheduleRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLDivElement>(null)
  const mobileSearchRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const location = useLocation()
  // Suggestion picks push the show's canonical URL - the floating card is
  // the overlay detail route on top of the page behind it.
  const openDetail = useDetailOpen()
  const { user: anilistUser, isAuthenticated: anilistAuth } = useAniList()
  const { user: malUser, isAuthenticated: malAuth } = useMAL()
  const { trackingProvider } = useTracking()
  const isAuthenticated = anilistAuth || malAuth
  // Avatar follows the active tracker, not a fixed provider order
  const user = trackingProvider === 'mal' ? (malUser ?? anilistUser ?? null) : (anilistUser ?? malUser ?? null)

  useEffect(() => {
    // `scrolled` now only drives the bottom hairline / reader progress track:
    // the bar itself is a flat `--bg` at every scroll position (D163), so
    // there is no scrim to fade in. A hard refresh, a resize/orientation
    // flip, or returning from the media player's FULLSCREEN (iOS restores the
    // scroll offset without firing `scroll` in some cases) can leave the flag
    // stale, so re-read the offset on every event that can restore or change
    // the viewport. >0, not >10: from the first scrolled pixel content is
    // under the bar.
    const onScroll = () => setScrolled(window.scrollY > 0)
    let raf = 0
    const onViewport = () => {
      onScroll()
      // iOS may finish restoring the scroll position one frame later.
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(onScroll)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onViewport)
    window.addEventListener('orientationchange', onViewport)
    window.addEventListener('pageshow', onViewport)
    document.addEventListener('visibilitychange', onViewport)
    document.addEventListener('fullscreenchange', onViewport)
    document.addEventListener('webkitfullscreenchange', onViewport)
    // Native <video> fullscreen on iOS fires these on the video element and
    // they do NOT bubble - capture catches them.
    document.addEventListener('webkitendfullscreen', onViewport, true)
    // A filtered layer that lived through a fullscreen round-trip can keep a
    // stale sample. Rebuild it once the transition has settled.
    const rebuildAmbient = () => setAmbientEpoch((n) => n + 1)
    document.addEventListener('fullscreenchange', rebuildAmbient)
    document.addEventListener('webkitfullscreenchange', rebuildAmbient)
    document.addEventListener('webkitendfullscreen', rebuildAmbient, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onViewport)
      window.removeEventListener('orientationchange', onViewport)
      window.removeEventListener('pageshow', onViewport)
      document.removeEventListener('visibilitychange', onViewport)
      document.removeEventListener('fullscreenchange', onViewport)
      document.removeEventListener('webkitfullscreenchange', onViewport)
      document.removeEventListener('webkitendfullscreen', onViewport, true)
      document.removeEventListener('fullscreenchange', rebuildAmbient)
      document.removeEventListener('webkitfullscreenchange', rebuildAmbient)
      document.removeEventListener('webkitendfullscreen', rebuildAmbient, true)
    }
  }, [])

  // HeroAmbient marks the document while a wash is painted. Read the current
  // state on attach (no mount-order race) and follow later changes. Mount
  // immediately when a wash appears; when it goes away (route change) or the
  // page scrolls, drop the layer right away / after the fade finishes.
  useEffect(() => {
    const root = document.documentElement
    const sync = () => setHasWash(root.hasAttribute('data-hero-wash'))
    sync()
    const mo = new MutationObserver(sync)
    mo.observe(root, { attributes: true, attributeFilter: ['data-hero-wash'] })
    return () => mo.disconnect()
  }, [])

  useEffect(() => {
    if (hasWash && !scrolled) {
      setAmbientMounted(true)
      return
    }
    if (!hasWash) {
      setAmbientMounted(false)
      return
    }
    const t = window.setTimeout(() => setAmbientMounted(false), 320)
    return () => window.clearTimeout(t)
  }, [hasWash, scrolled])

  // Reader progress: on /read/* the navbar's divider is a scroll progress
  // bar instead of a hairline. The fill is written straight to the DOM from
  // a rAF - a scroll-linked bar must not re-render the navbar every frame.
  // The document height changes as reader images arrive, so a
  // ResizeObserver repaints when the track grows, not just on scroll.
  // GATE: while pages are still loading the document height is a moving
  // target, so every ratio is wrong - Read.tsx publishes
  // `aeri:reader-pages` (plus the dataset mirror) once every page has
  // resolved, and the fill stays at zero until then.
  const isReader = location.pathname.startsWith('/read/')
  const readProgressRef = useRef<HTMLDivElement>(null)
  const readerPagesReadyRef = useRef(false)
  useEffect(() => {
    if (!isReader) return
    let raf = 0
    const paint = () => {
      raf = 0
      const el = readProgressRef.current
      if (!el) return
      if (!readerPagesReadyRef.current) {
        el.style.transform = 'scaleX(0)'
        el.style.opacity = '0'
        return
      }
      const doc = document.documentElement
      const max = doc.scrollHeight - doc.clientHeight
      const ratio = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0
      el.style.transform = `scaleX(${ratio})`
      // Flat fill - no neon glow (owner instruction 2026-10-29). The fill is
      // still hidden at zero length so a scaleX(0) bar cannot leave a
      // subpixel sliver at the left edge.
      el.style.opacity = ratio > 0 ? '1' : '0'
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(paint) }
    const onPages = (e: Event) => {
      readerPagesReadyRef.current = (e as CustomEvent<{ ready?: boolean }>).detail?.ready === true
      paint()
    }
    readerPagesReadyRef.current = document.documentElement.dataset.readerPagesReady === '1'
    paint()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    window.addEventListener('aeri:reader-pages', onPages)
    let ro: ResizeObserver | null = null
    try {
      ro = new ResizeObserver(paint)
      ro.observe(document.documentElement)
    } catch {
      // No ResizeObserver: scroll + resize still keep the bar current.
    }
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      window.removeEventListener('aeri:reader-pages', onPages)
      if (raf) cancelAnimationFrame(raf)
      try {
        ro?.disconnect()
      } catch {
        // Already disconnected.
      }
    }
  }, [isReader])

  // Reset mobile transient UI on any route change (prevents overlay persisting and intercepting clicks).
  // NOTE: the detail card is now the overlay route - it must NOT be cleared
  // here; opening/closing a card is itself a route change.
  useEffect(() => {
    setMobileNavOpen(false)
    setMobileSearchOpen(false)
    setShowSuggestions(false)
    setSignInOpen(false)
    setProfileOpen(false)
    setScheduleOpen(false)
  }, [location.pathname, location.search, location.hash])

  // Returning from OAuth (full page load): reopen the sign-in popup so the
  // user lands on connected state + connect-the-other + tracker pick, with
  // Continue to dismiss. Runs once per return, success or failure (errors
  // render inside the popup with retry).
  useEffect(() => {
    try {
      if (sessionStorage.getItem('aeri:signin:oauth')) {
        sessionStorage.removeItem('aeri:signin:oauth')
        setSignInOpen(true)
      }
    } catch {}
  }, [])

  // Close suggestions + profile menu on outside pointerdown - unified
  // pointer event, no microtask delay.
  // The desktop search box, mobile search dropdown, profile menu, AND the
  // portaled popups (search suggestions / schedule / profile, which live
  // in document.body via HeaderPopup) all count as inside. The portal
  // nodes are outside searchRef/profileRef/scheduleRef, so without this
  // their pointerdown would setShowSuggestions(false) BEFORE the click
  // fires - unmounting the row and swallowing the tap (regression from
  // the portal migration: rows rendered but never opened).
  // Bell/profile buttons have dedicated refs for HeaderPopup anchoring;
  // the wrapper div refs remain the inside-test (button is inside them).
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement
      const inDesktop = searchRef.current?.contains(t) ?? false
      const inMobile = mobileSearchRef.current?.contains(t) ?? false
      const inProfile = profileRef.current?.contains(t) ?? false
      const inSchedule = scheduleRef.current?.contains(t) ?? false
      const inPortal = t.closest?.('[data-header-popup]') ? true : false
      if (!inDesktop && !inMobile && !inPortal) {
        setShowSuggestions(false)
      }
      if (!inProfile && !inPortal) {
        setProfileOpen(false)
      }
      if (!inSchedule && !inPortal) {
        setScheduleOpen(false)
      }
    }
    document.addEventListener('pointerdown', onDown, { passive: true })
    return () => document.removeEventListener('pointerdown', onDown as any)
  }, [])

  // Anchor for the suggestions popup: the input itself (left-aligned,
  // same width as the focused input = 240px). The popup is a body portal
  // (HeaderPopup) so its backdrop-blur samples the real page at every
  // scroll position - see HeaderPopup's doc comment.
  const searchInputRef = useRef<HTMLInputElement>(null)
  // Compact-bar search field - the ⌘K fallback target when the inline input
  // is not mounted (below the fit breakpoint).
  const mobileSearchInputRef = useRef<HTMLInputElement>(null)
  // Bell + avatar anchors for the portaled popups (body portal, same as search).
  const bellRef = useRef<HTMLButtonElement>(null)
  const profileBtnRef = useRef<HTMLButtonElement>(null)

  const dispatchNavigate = (to?: string) => {
    try { window.dispatchEvent(new CustomEvent('aeri:navigate')) } catch {}
    if (to) navigate(to)
  }

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    const target = `/search?q=${encodeURIComponent(q)}`;
    navigate(target)
    try { window.dispatchEvent(new CustomEvent('aeri:navigate')) } catch {}
    setMobileSearchOpen(false)
    setShowSuggestions(false)
  }

  // Desktop nav items - Settings lives in the profile menu, not the top bar.
  // Fixed gaps: the left cluster uses ONE gap value at all scales so logo↔nav
  // spacing never breathes during scaling transitions.
  // MY LIST IS ALWAYS VISIBLE: signed-out visitors see the
  // same nav as members; clicking it opens the sign-in modal instead of
  // navigating (see the /list guard in both nav renderers). Hiding the tab
  // made the product look like it had no list until you signed in.
  const desktopNav = [
    { to: '/', label: 'Home' },
    { to: '/anime', label: 'Anime' },
    { to: '/manga', label: 'Manga' },
    { to: '/list', label: 'My List' },
  ]

  // GitHub is NOT in the navbar (owner 2026-10-31). The top bar carries only
  // the four routes; the repo link lives in the page footer and in Settings.

  // Signed-out My List: prompt sign-in, never navigate to a page that can
  // only show a locked state. Shared by the live nav and the measurer copy
  // (the measurer's copy never fires - it is visibility:hidden).
  const onSectionClick = (to: string, e: React.MouseEvent) => {
    if (to === '/list' && !isAuthenticated) {
      e.preventDefault()
      setSignInOpen(true)
      return
    }
    dispatchNavigate(to)
  }

  const mobileNav = [
    { to: '/', label: 'Home' },
    { to: '/anime', label: 'Anime' },
    { to: '/manga', label: 'Manga' },
    { to: '/list', label: 'My List' },
    { to: '/search', label: 'Search' },
  ]

  // Fit-based breakpoint: show the inline nav only when everything fits in
  // one row AND the viewport is at the hero's `sm` step (640px) - the hero's
  // dot pill tucks into the top-right corner below 640 and returns to the
  // bottom-center at 640, so the nav's compact (menu + search icon) mode
  // must begin at that same
  // scale. A pure width fit collapsed the bar around ~900px (30% breathing
  // factor + a measurer that over-counted the right cluster's tighter gaps),
  // which read as two different mobile breakpoints on one screen.
  // The measurer below is built from the SAME `SectionLinks` component and
  // the same cluster classes as the real row, so its scrollWidth IS the
  // row's true width; the only extra is a 2px rounding buffer.
  // State-independent measurement ⇒ no oscillation possible.
  // Starts collapsed (mobile-first) to avoid a flash of overflowing nav.
  const barRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const [navFits, setNavFits] = useState(false)
  // LAYOUT effect, not passive: measuring after the first paint let the
  // compact bar (menu + search icon) paint for a frame before flipping to
  // the inline links + search input - a visible "pop" on every hard refresh,
  // worse the slower the bundle is (owner report 2026-10-30). The measurer
  // is always mounted, so the read is valid before the first paint and the
  // state flip lands in the same frame.
  useLayoutEffect(() => {
    const measure = () => {
      const bar = barRef.current
      const m = measureRef.current
      if (!bar || !m) return
      // clientWidth includes the bar's px-4/6/12 padding - compare against
      // the CONTENT box, or the padding would read as free space.
      const cs = getComputedStyle(bar)
      const inner =
        bar.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0)
      if (!inner || inner <= 0) return
      // 640 = Tailwind `sm`, the hero pill's own switch point.
      const smUp = typeof window !== 'undefined' && window.matchMedia('(min-width: 640px)').matches
      const next = smUp && m.scrollWidth + 2 <= inner
      setNavFits((prev) => (prev === next ? prev : next))
    }
    measure()
    let ro: ResizeObserver | null = null
    try {
      ro = new ResizeObserver(measure)
      ro.observe(barRef.current!)
    } catch {}
    window.addEventListener('resize', measure)
    try {
      ;(document as any).fonts?.ready?.then?.(() => measure())?.catch?.(() => {})
    } catch {}
    // auth state / late layout shifts change widths - re-measure shortly after
    const t = setTimeout(measure, 300)
    return () => {
      window.removeEventListener('resize', measure)
      clearTimeout(t)
      try { ro?.disconnect() } catch {}
    }
  }, [desktopNav.length, isAuthenticated])

  // ⌘K / Ctrl+K / Alt+K (owner 2026-10-31, Alt added same day): focus the
  // search field so you can type immediately. A keybind only - no new chrome,
  // no hint badge. On the wide bar it focuses (and selects) the inline input;
  // when the bar is compact the same keys open the search dropdown, whose
  // input autofocuses. Shift variants are left alone (⌘⇧K belongs to the
  // browser/devtools), and the handler never runs while a modifier-less
  // typing target is involved - ⌘K inside an input still means "search",
  // which is the point.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.shiftKey) return
      if (!(e.metaKey || e.ctrlKey || e.altKey)) return
      if (e.key.toLowerCase() !== 'k') return
      e.preventDefault()
      if (navFits) {
        const input = searchInputRef.current
        if (!input) return
        input.focus()
        input.select()
        return
      }
      setMobileSearchOpen(true)
      // The compact panel mounts on the next paint; focus its input there.
      requestAnimationFrame(() => mobileSearchInputRef.current?.focus())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navFits])

  // Hidden measurer: the REAL left cluster (logo + SectionLinks) and the REAL
  // right cluster (search input, bell, avatar / Sign in) with identical
  // classes, always mounted invisibly so widths are TRUE at every scale. It
  // never intercepts clicks and never affects layout. Rendered OUTSIDE
  // <header> (fragment sibling) so no header query can match it - the old
  // in-header measurer hijacked `header > div` lookups and broke every width
  // reading (iPad Pro 834px incident). Query the bar via [data-navbar-bar].
  const measurer = (
    <div
      ref={measureRef}
      aria-hidden
      className="pointer-events-none fixed -top-[200px] left-0 -z-10 flex h-14 w-max items-center gap-4 opacity-0 lg:gap-6"
      style={{ visibility: 'hidden' } as any}
    >
      <div className="flex items-center gap-5 lg:gap-6">
        <span className="text-[19px] font-semibold tracking-[-0.02em]" style={{ fontFamily: '"Cal Sans", sans-serif' } as any}>aeri</span>
        <SectionLinks items={desktopNav} onSelect={() => {}} />
      </div>
      <div className="flex items-center gap-1.5 lg:gap-3">
        <span className="h-8 w-[150px] shrink-0 rounded-full border lg:w-[200px]" />
        <span className="h-8 w-8 shrink-0 rounded-full" />
        {isAuthenticated ? (
          <span className="h-7 w-7 shrink-0 rounded" />
        ) : (
          <span className="inline-flex h-[30px] shrink-0 items-center rounded-full px-3.5 text-xs font-medium">Sign in</span>
        )}
      </div>
    </div>
  )

  return (
    <>
    {measurer}
    {/* The background-color is ON THE FIXED ELEMENT ITSELF, and that is not
        cosmetic - it is the iOS 26 status-bar fix (D163, second pass).

        iOS 26 no longer reads <meta name="theme-color"> for the strip behind
        the clock/battery: WebKit reports the fixed element at the top edge
        and iOS paints the strip with THAT element's plain background-color,
        re-reading it on every check. An absolutely-positioned child (the old
        `data-nav-solid` div) is ignored by that algorithm, and an element
        with no plain colour is sampled ONCE and frozen - which is exactly
        what the owner saw: a blurred band with stale page content sitting
        where the black strip used to be. A plain colour here makes the strip
        solid `--bg` and keeps it in sync with the theme.

        It also means the bar's own paint is always flat `--bg` - no resting
        transparency, no gradient, no blur. That cut the Home page wash off
        at y=56, and the owner read the bar as a separate black band ("before
        that the top bar was also a part of the ambient now its not"). D166
        paints the wash back INSIDE the bar as a clipped child layer
        (`data-nav-ambient`, see `.nav-ambient` in globals.css) - the opaque
        colour still lives on this element, so the iOS strip contract above is
        untouched, and the ambient never covers it. NO BACKDROP FILTER
        (owner report 2026-10-30): iOS fullscreen restore smeared the old
        blur.

        COMPOSITED LAYER (`[transform:translateZ(0)]`, owner report
        2026-11-05: "if i stretch down to the bottom too long the navbar
        disappears"). iOS WebKit can drop a plain fixed layer while the
        scroll view rubber-bands; promoting the bar to its own GPU layer is
        the documented remedy and keeps it painted through the bounce. The
        bounce itself is NOT disabled - `overscroll-behavior` stays default,
        so the page still rubber-bands. The transform also gives the header
        its own containing block, which is fine: every child is absolute
        against it. */}
    <header
      data-nav-solid
      className="fixed inset-x-0 top-0 z-50 isolate h-[var(--nav-total)] touch-manipulation bg-[var(--bg)] pt-[var(--safe-top)] [transform:translateZ(0)]"
      style={{ touchAction: 'manipulation' } as any}
      aria-label="Primary"
    >
      {/* Ambient-in-bar (D166). The Home wash used to show THROUGH the bar;
          the D163 opaque `--bg` ended that. This is the same wash, painted by
          a child so it sits above the bar's own colour: HeroAmbient publishes
          the active backdrop + its measured box to the document root, the
          child paints it at the wash's own blur/opacity, and `.nav-ambient`
          clips it to the bar and re-applies the old `nav-top-fade` dimming
          ramp (30% → 100%) so it is faint under the logo and meets the real
          wash at full strength on the bottom edge - no seam.
          TWO art layers, mirroring the wash's own crossfade (owner report
          2026-11-05: the bar's tint changed later than the page's): the
          outgoing artwork stays painted while the incoming one loads, then
          the incoming layer eases in over the same 700ms the page wash uses.
          `scrolled` fades the whole thing out, which is exactly what the old
          solid layer fading in did: once the page moves, the bar is flat
          `--bg` again. On any page without a hero wash the vars are unset, so
          this paints nothing at all. */}
      {ambientMounted && (
      <div
        key={ambientEpoch}
        aria-hidden
        data-nav-ambient
        className={`nav-ambient pointer-events-none absolute inset-0 transition-opacity duration-300 ${
          scrolled ? 'opacity-0' : 'opacity-100'
        }`}
      >
        <div className="nav-ambient-art nav-ambient-art-prev hero-wash-mask" />
        <div className="nav-ambient-art hero-wash-mask" />
      </div>
      )}
      {/* Divider. Every page gets a hairline; the reader swaps it for a
          scroll progress bar in the Continue Watching bar's geometry  - 
          15% track and a FLAT `--text` fill. No neon glow: the 6px shadow
          was removed on the owner's instruction (2026-10-29) and the fill
          stays hidden at zero length so scaleX(0) leaves no sliver.
          Both fade with `scrolled`, so the top of every page stays clean. */}
      {isReader ? (
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-x-0 bottom-0 h-[2px] bg-[color-mix(in_srgb,var(--text)_15%,transparent)] transition-opacity duration-300 ${
            scrolled ? 'opacity-100' : 'opacity-0'
          }`}
        >
          <div
            ref={readProgressRef}
            data-testid="navbar-read-progress"
            className="h-full w-full origin-left bg-[var(--text)]"
            style={{ transform: 'scaleX(0)', opacity: 0 }}
          />
        </div>
      ) : (
        <div
          aria-hidden
          className={`pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[var(--border)] transition-opacity duration-300 ${
            scrolled ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}
      <div ref={barRef} data-navbar-bar="true" className="relative z-10 mx-auto flex h-full max-w-[1600px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-12 lg:gap-6">
        {/* Left cluster: logo + nav/menu share ONE gap. The mobile (menu
            collapsed) branch halves it - the old gap-6 (24px)
            read as detached on phones. Desktop keeps gap-6. */}
        <div className={navFits ? 'flex items-center gap-5 lg:gap-6' : 'flex items-center gap-3'}>
          {/* Logo - simple Aeri, unselectable */}
          <Link
            to="/"
            onClick={() => dispatchNavigate('/')}
            aria-label="aeri home"
            className="touch-manipulation text-[19px] font-semibold tracking-[-0.02em] text-[var(--text)] select-none"
            style={{ fontFamily: '"Cal Sans", sans-serif', userSelect: 'none', touchAction: 'manipulation' } as any}
            draggable={false}
          >
            aeri
          </Link>

          {navFits ? (
          <>
            <SectionLinks items={desktopNav} onSelect={onSectionClick} />
          </>
          ) : (
          /* on small scalings the menu + search
             triggers match the BELL - same 32px hitbox, same muted rest
             color - so the icon row reads as one control group. Lucide
             `menu` (three rules) replaces the old bulleted `list` glyph.
             The smaller box also pulls the icon 6px closer to the wordmark
             without touching the 12px cluster gap. */
          <button
            aria-label="Menu"
            aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen((v) => !v)}
            className="grid h-8 w-8 touch-manipulation place-items-center rounded-full text-[var(--text-muted)] hover:bg-[color-mix(in_srgb,var(--text)_10%,transparent)] hover:text-[var(--text)]"
            style={{ touchAction: 'manipulation' } as any}
          >
            <Icon name="menu" size={16} />
          </button>
          )}
        </div>

        {/* The mobile lane packs tighter - the search
            trigger is a 32px bell-sized box (was 44px), so the glyph sits
            8px closer to the bell at the same cluster gap; the 6px gap trims
            the rest. Desktop keeps gap-3. */}
        <div className="flex items-center gap-1.5 lg:gap-3">
          {navFits ? (
          <form onSubmit={onSearch} className="flex items-center">
            <div ref={searchRef} className="relative">
              <input
                ref={searchInputRef}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setShowSuggestions(true) }}
                onFocus={() => { if (query.trim().length >= 2) setShowSuggestions(true) }}
                placeholder="Search"
                aria-label="Search anime"
                aria-expanded={showSuggestions}
                aria-controls="search-suggestions"
                autoComplete="off"
                spellCheck={false}
                /* NO backdrop-filter and no `transition-all` (owner report
                   2026-10-30): Safari left a spinner-like ghost inside the
                   field while a hard refresh was still painting. The input
                   sits on the opaque navbar anyway, so the 8% fill is all
                   the depth it needs - and transitioning `backdrop-filter`
                   re-blurred the area behind the field every frame. */
                className="h-8 w-[150px] rounded-full border border-[var(--border)] bg-[var(--text)]/[0.08] py-0 pl-8 pr-3 text-[13px] text-[var(--text)] placeholder:text-[var(--text-faint)] transition-[width,background-color,border-color] focus:border-[var(--border-strong)] focus:bg-[var(--text)]/[0.12] focus:outline-none lg:w-[200px] lg:focus:w-[240px]"
              />
              <Icon
                name="search"
                size={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]"
              />
              {showSuggestions && query.trim().length >= 2 && (
                <HeaderPopup anchorRef={searchInputRef} align="left" width={240} ariaLabel="Search suggestions" role="listbox">
                  <SearchSuggestions query={query} onClose={() => setShowSuggestions(false)} onPreview={openDetail} />
                </HeaderPopup>
              )}
            </div>
          </form>
          ) : (
          <button
            aria-label="Search"
            onClick={() => setMobileSearchOpen((v) => !v)}
            className="grid h-8 w-8 touch-manipulation place-items-center rounded-full text-[var(--text-muted)] hover:bg-[color-mix(in_srgb,var(--text)_10%,transparent)] hover:text-[var(--text)]"
            style={{ touchAction: 'manipulation' } as any}
          >
            <Icon name="search" size={16} />
          </button>
          )}

          {/* BELL STAYS AT EVERY SCALING. The small `|` divider between the
              bell and the profile is GONE; the bell itself remains at every
              scale, and the right cluster's own gap does the separation. */}
          {isAuthenticated && (
            <div ref={scheduleRef}>
              <button
                ref={bellRef}
                aria-label="Airing schedule"
                aria-expanded={scheduleOpen}
                aria-haspopup="menu"
                onClick={() => setScheduleOpen(v => !v)}
                className="grid h-8 w-8 place-items-center rounded-full text-[var(--text-muted)] hover:bg-[color-mix(in_srgb,var(--text)_10%,transparent)] hover:text-[var(--text)]"
              >
                <Icon name="bell" size={16} />
              </button>
              {scheduleOpen && (
                <HeaderPopup anchorRef={bellRef} align="right" width={240} ariaLabel="Airing schedule">
                  <SchedulePanel
                    onClose={() => setScheduleOpen(false)}
                    onOpen={(animeId) => { setScheduleOpen(false); navigate(`/anime/${animeId}`) }}
                  />
                </HeaderPopup>
              )}
            </div>
          )}

          {!isAuthenticated ? (
            <button
              onClick={() => setSignInOpen(true)}
              className={`${pillSolid} touch-manipulation`}
              style={{ touchAction: 'manipulation' } as any}
              aria-label="Sign in"
            >
              Sign in
            </button>
          ) : (
            <div ref={profileRef}>
              <button
                ref={profileBtnRef}
                onClick={() => setProfileOpen((v) => !v)}
                aria-label="Profile"
                aria-expanded={profileOpen}
                aria-haspopup="menu"
                className="relative grid h-7 w-7 touch-manipulation place-items-center overflow-hidden rounded bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--border-strong)]"
                style={{ touchAction: 'manipulation' } as any}
              >
                {user?.avatar?.large ? (
                  <img src={user.avatar.large} alt={user.name} className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <span className="grid h-full w-full place-items-center text-[10px] font-bold text-[var(--text)]">{trackingProvider === 'mal' ? 'M' : 'A'}</span>
                )}
              </button>
              {profileOpen && (
                <HeaderPopup anchorRef={profileBtnRef} align="right" width={168} ariaLabel="Profile menu">
                  <div className="p-1">
                    <Link
                      to="/profile"
                      role="menuitem"
                      onClick={() => { setProfileOpen(false); dispatchNavigate('/profile') }}
                      className="flex w-full touch-manipulation items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-[color-mix(in_srgb,var(--text)_5%,transparent)]"
                      style={{ touchAction: 'manipulation' } as any}
                    >
                      <span className="grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--text)_10%,transparent)] text-[9px] font-bold text-[var(--text)]" aria-hidden>
                        <Icon name="person" size={12} className="text-[var(--text)]" />
                      </span>
                      <span className="text-xs font-medium text-[var(--text)]">Profile</span>
                    </Link>
                    <Link
                      to="/settings"
                      role="menuitem"
                      onClick={() => { setProfileOpen(false); dispatchNavigate('/settings') }}
                      className="flex w-full touch-manipulation items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-[color-mix(in_srgb,var(--text)_10%,transparent)]"
                      style={{ touchAction: 'manipulation' } as any}
                    >
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--text)_10%,transparent)]" aria-hidden>
                        <Icon name="gear" size={12} className="text-[var(--text)]" />
                      </span>
                      <span className="text-xs font-medium text-[var(--text)]">Settings</span>
                    </Link>
                    {/* Incognito (circle-only state): a plain on/off mode  - 
                        automatic tracker writes stop and every tab reads
                        "Incognito - Aeri".
                        Manual edits still sync. The ROW is always normal;
                        only the circle + icon invert: ON = --text circle
                        with --on-text icon (white/black on dark themes,
                        black/white on light themes), OFF = the normal
                        translucent circle with a --text icon. */}
                    <button
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={incognito}
                      aria-label="Incognito mode"
                      onClick={toggleIncognito}
                      className="flex w-full touch-manipulation items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-[var(--text)] transition-colors duration-150 hover:bg-[color-mix(in_srgb,var(--text)_10%,transparent)]"
                      style={{ touchAction: 'manipulation' } as any}
                    >
                      <span
                        className={`grid h-6 w-6 shrink-0 place-items-center rounded-full transition-colors duration-150 ${
                          incognito
                            ? 'bg-[var(--text)]'
                            : 'bg-[color-mix(in_srgb,var(--text)_10%,transparent)]'
                        }`}
                        aria-hidden
                      >
                        <Icon
                          name="eye-slash"
                          size={12}
                          className={incognito ? 'text-[var(--on-text)]' : 'text-[var(--text)]'}
                        />
                      </span>
                      <span className="flex-1 text-xs font-medium text-[var(--text)]">
                        Incognito
                      </span>
                    </button>
                  </div>
                </HeaderPopup>
              )}
            </div>
          )}
        </div>
      </div>

      {mobileSearchOpen && !navFits && (
        <div ref={mobileSearchRef} className="absolute left-0 right-0 top-[var(--nav-total)] border-t border-[var(--border)] bg-[var(--bg)] px-4 py-3 shadow-lg shadow-black/20">
          <form onSubmit={onSearch} className="flex items-center gap-2">
            <input
              ref={mobileSearchInputRef}
              autoFocus
              value={query}
              onChange={(e) => { setQuery(e.target.value); setShowSuggestions(true) }}
              onFocus={() => { if (query.trim().length >= 2) setShowSuggestions(true) }}
              placeholder="Search anime"
              className="flex-1 rounded-full border border-[var(--border)] bg-[var(--text)]/[0.08] px-4 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[var(--border-strong)] focus:outline-none"
            />
            <button type="submit" className={pillSolid}>
              Go
            </button>
          </form>
          {showSuggestions && query.trim().length >= 2 && (
            <div className="relative mt-2">
              <SearchSuggestions query={query} onClose={() => { setShowSuggestions(false); setMobileSearchOpen(false) }} onPreview={(a) => { setMobileSearchOpen(false); openDetail(a) }} />
            </div>
          )}
        </div>
      )}
      {mobileNavOpen && !navFits && (
        <nav className="absolute left-0 right-0 top-[var(--nav-total)] border-t border-[var(--border)] bg-[var(--bg)] px-4 py-3 shadow-lg shadow-black/20 anim-slide-down" aria-label="Mobile sections">
          <div className="flex flex-col gap-1">
            {mobileNav.filter(l => l.to !== '/search').map((l) => (
              <Link
                key={l.to}
                to={l.to}
                onClick={(e) => {
                  if (l.to === '/list' && !isAuthenticated) {
                    e.preventDefault()
                    setMobileNavOpen(false)
                    setSignInOpen(true)
                    return
                  }
                  setMobileNavOpen(false)
                  dispatchNavigate(l.to)
                }}
                className="rounded px-3 py-3 text-sm font-medium text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--text)_10%,transparent)] hover:text-[var(--text)] active:bg-[color-mix(in_srgb,var(--text)_5%,transparent)] touch-manipulation min-h-[44px] flex items-center"
                style={{ touchAction: 'manipulation' } as any}
              >
                {l.label}
              </Link>
            ))}
            {!isAuthenticated && (
              <button
                onClick={() => {
                  setMobileNavOpen(false)
                  setSignInOpen(true)
                }}
                className={`${pillSolid} mt-2 touch-manipulation`}
                style={{ touchAction: 'manipulation' } as any}
              >
                Sign in
              </button>
            )}
          </div>
        </nav>
      )}
      {signInOpen && <SignInModal onClose={() => setSignInOpen(false)} />}
    </header>
    </>
  )
}
