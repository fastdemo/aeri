import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAniList } from '../../contexts/AniListContext'
import { useMAL } from '../../contexts/MALContext'
import { useTracking } from '../../contexts/TrackingContext'
import { SearchSuggestions } from '../search/SearchSuggestions'
import { DetailModal } from '../detail/DetailModal'
import { SignInModal } from '../auth/SignInModal'
import type { Anime } from '../../types/anime'

export function Navbar() {
  const [scrolled, setScrolled] = useState(false)
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  // Preview popup for suggestion picks (same DetailModal as Home/Browse cards)
  const [previewAnime, setPreviewAnime] = useState<Anime | null>(null)
  const [signInOpen, setSignInOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const profileRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLDivElement>(null)
  const mobileSearchRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const { user: anilistUser, isAuthenticated: anilistAuth } = useAniList()
  const { user: malUser, isAuthenticated: malAuth } = useMAL()
  const { trackingProvider } = useTracking()
  const isAuthenticated = anilistAuth || malAuth
  // Avatar follows the active tracker, not a fixed provider order
  const user = trackingProvider === 'mal' ? (malUser ?? anilistUser ?? null) : (anilistUser ?? malUser ?? null)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Reset mobile transient UI on any route change (prevents overlay persisting and intercepting clicks)
  useEffect(() => {
    setMobileNavOpen(false)
    setMobileSearchOpen(false)
    setShowSuggestions(false)
    setPreviewAnime(null)
    setSignInOpen(false)
    setProfileOpen(false)
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

  // Close suggestions + profile menu on outside pointerdown — unified
  // pointer event, no microtask delay.
  // The desktop search box, mobile search dropdown, and profile menu all
  // count as inside (mobile taps previously closed the dropdown on
  // pointerdown, before click).
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      const inDesktop = searchRef.current?.contains(t) ?? false
      const inMobile = mobileSearchRef.current?.contains(t) ?? false
      const inProfile = profileRef.current?.contains(t) ?? false
      if (!inDesktop && !inMobile) {
        setShowSuggestions(false)
      }
      if (!inProfile) {
        setProfileOpen(false)
      }
    }
    document.addEventListener('pointerdown', onDown, { passive: true })
    return () => document.removeEventListener('pointerdown', onDown as any)
  }, [])

  const dispatchNavigate = (to?: string) => {
    try { window.dispatchEvent(new CustomEvent('aeri:navigate')) } catch {}
    if (to) {
      const expected = `#${to}`;
      try {
        if (window.location.hash !== expected) {
          const isHome = to === '/' && (window.location.hash === '#/' || window.location.hash === '' || window.location.hash === '#');
          if (!isHome) window.location.hash = to;
        }
      } catch {}
    }
  }

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    const target = `/search?q=${encodeURIComponent(q)}`;
    navigate(target)
    try { if (window.location.hash !== `#${target}`) window.location.hash = target; } catch {}
    try { window.dispatchEvent(new CustomEvent('aeri:navigate')) } catch {}
    setMobileSearchOpen(false)
    setShowSuggestions(false)
  }

  // Desktop nav items — Settings lives in the profile menu, not the top bar.
  // Fixed gaps: the left cluster uses ONE gap value at all scales so logo↔nav
  // spacing never breathes during scaling transitions.
  const desktopNav = [
    { to: '/', label: 'Home' },
    { to: '/browse', label: 'Anime' },
    { to: '/manga', label: 'Manga' },
    ...(isAuthenticated ? [{ to: '/list', label: 'My List' } as const] : []),
  ]

  const mobileNav = [
    { to: '/', label: 'Home' },
    { to: '/browse', label: 'Anime' },
    { to: '/manga', label: 'Manga' },
    ...(isAuthenticated ? [{ to: '/list', label: 'My List' } as const] : []),
    { to: '/search', label: 'Search' },
  ]

  // Fit-based breakpoint: show the inline nav only when everything fits in
  // one row with ~30% breathing room; otherwise collapse to the mini menu.
  // A hidden measurer renders the SAME links + search input with the SAME
  // classes, so the decision uses true widths — never an estimate that can
  // disagree with reality at some scales (the old estimate measured the
  // collapsed 44px search icon instead of the 200px inline input, and never
  // re-measured after switching, so narrow scales could stick inline and
  // overflow). State-independent measurement ⇒ no oscillation possible.
  // Starts collapsed (mobile-first) to avoid a flash of overflowing nav.
  const barRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const [navFits, setNavFits] = useState(false)
  useEffect(() => {
    const measure = () => {
      const bar = barRef.current
      const m = measureRef.current
      if (!bar || !m) return
      const barW = bar.clientWidth
      if (!barW) return
      const need = (m.scrollWidth + 48) * 1.3
      setNavFits((prev) => {
        const next = need <= barW
        return prev === next ? prev : next
      })
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
    // auth state / late layout shifts change widths — re-measure shortly after
    const t = setTimeout(measure, 300)
    return () => {
      window.removeEventListener('resize', measure)
      clearTimeout(t)
      try { ro?.disconnect() } catch {}
    }
  }, [desktopNav.length, isAuthenticated])

  // Hidden measurer: same links + same search input, same classes, but
  // always mounted invisibly so widths are TRUE at every scale. It never
  // intercepts clicks and never affects layout. Rendered OUTSIDE <header>
  // (fragment sibling) so no header query can match it — the old in-header
  // measurer hijacked `header > div` lookups and broke every width reading
  // (iPad Pro 834px incident). Query the bar via [data-navbar-bar].
  const measurer = (
    <div
      ref={measureRef}
      aria-hidden
      className="pointer-events-none fixed left-0 top-0 -z-10 flex h-14 w-max items-center gap-5 opacity-0"
      style={{ visibility: 'hidden' } as any}
    >
      <span className="text-[19px] font-semibold tracking-[-0.02em]" style={{ fontFamily: '"Cal Sans", sans-serif' } as any}>aeri</span>
      <span className="flex items-center gap-5">
        {desktopNav.map((l) => (
          <span key={l.to} className="whitespace-nowrap px-2 py-1.5 text-[13px] font-medium">{l.label}</span>
        ))}
      </span>
      <span className="h-8 w-[180px] shrink-0 rounded-full border lg:w-[200px]" />
      {isAuthenticated ? <span className="h-7 w-7 shrink-0 rounded" /> : <span className="h-8 px-5 text-[13px]">Sign in</span>}
    </div>
  )

  return (
    <>
    {measurer}
    <header
      className={`fixed inset-x-0 top-0 z-50 h-14 touch-manipulation transition-colors duration-300 ${
        scrolled
          ? 'bg-[var(--bg)]/95 backdrop-blur-md border-b border-[var(--border)]'
          : 'bg-gradient-to-b from-[color-mix(in_srgb,var(--bg)_70%,transparent)] via-[var(--bg)] to-transparent'
      }`}
      style={{ touchAction: 'manipulation' } as any}
      aria-label="Primary"
    >
      <div ref={barRef} data-navbar-bar="true" className="mx-auto flex h-full max-w-[1600px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-12 lg:gap-6">
        <div className="flex items-center gap-6">
          {/* Logo — simple Aeri, unselectable */}
          {/* Logo — simple Aeri, unselectable */}
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
          <nav className="flex items-center gap-6" aria-label="Sections">
            {desktopNav.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                onClick={() => dispatchNavigate(l.to)}
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
          ) : (
          <button
            aria-label="Menu"
            aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen((v) => !v)}
            className="grid h-11 w-11 touch-manipulation place-items-center rounded-full text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--text)_10%,transparent)] hover:text-[var(--text)]"
            style={{ touchAction: 'manipulation' } as any}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
          )}
        </div>

        <div className="flex items-center gap-2 lg:gap-3">
          {navFits ? (
          <form onSubmit={onSearch} className="flex items-center">
            <div ref={searchRef} className="relative">
              <input
                value={query}
                onChange={(e) => { setQuery(e.target.value); setShowSuggestions(true) }}
                onFocus={() => { if (query.trim().length >= 2) setShowSuggestions(true) }}
                placeholder="Search"
                aria-label="Search anime"
                aria-expanded={showSuggestions}
                aria-controls="search-suggestions"
                className="h-8 w-[180px] rounded-full border border-[var(--border)] bg-[var(--text)]/[0.08] py-0 pl-8 pr-3 text-[13px] text-[var(--text)] placeholder:text-[var(--text-faint)] backdrop-blur focus:w-[240px] focus:border-[var(--border-strong)] focus:bg-[var(--text)]/[0.12] focus:outline-none lg:w-[200px] transition-all"
              />
              <svg
                aria-hidden
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              {showSuggestions && query.trim().length >= 2 && (
                <SearchSuggestions query={query} onClose={() => setShowSuggestions(false)} onPreview={(a) => { if (!isAuthenticated) setSignInOpen(true); else setPreviewAnime(a) }} />
              )}
            </div>
          </form>
          ) : (
          <button
            aria-label="Search"
            onClick={() => setMobileSearchOpen((v) => !v)}
            className="grid h-11 w-11 touch-manipulation place-items-center rounded-full text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--text)_10%,transparent)] hover:text-[var(--text)]"
            style={{ touchAction: 'manipulation' } as any}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
          </button>
          )}

          {isAuthenticated && navFits && (
            <button
              aria-label="Notifications"
              className="grid h-8 w-8 place-items-center rounded-full text-[var(--text-muted)] hover:bg-[color-mix(in_srgb,var(--text)_10%,transparent)] hover:text-[var(--text)]"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 3a5 5 0 0 1 5 5v4a2 2 0 0 0 .45 1.26L18.5 15H5.5l1.05-1.74A2 2 0 0 0 7 12V8a5 5 0 0 1 5-5Z" />
                <path d="M9 17a3 3 0 0 0 6 0" />
              </svg>
            </button>
          )}

          {isAuthenticated && navFits && <div className="h-6 w-px bg-[color-mix(in_srgb,var(--text)_10%,transparent)]" />}

          {!isAuthenticated ? (
            <button
              onClick={() => setSignInOpen(true)}
              className="inline-flex h-7 touch-manipulation items-center rounded-full bg-[var(--text)] px-4 text-[13px] font-semibold text-[var(--on-text)] transition hover:bg-[color-mix(in_srgb,var(--text)_90%,transparent)] active:scale-[0.98] lg:h-8 lg:px-5"
              style={{ touchAction: 'manipulation' } as any}
              aria-label="Sign in"
            >
              Sign in
            </button>
          ) : (
            <div ref={profileRef} className="relative">
              <button
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
                <div
                  role="menu"
                  aria-label="Profile menu"
                  style={{ isolation: 'isolate' }}
                  className="absolute right-0 top-[calc(100%+8px)] z-[70] w-[168px] overflow-hidden rounded-xl border border-[var(--border)] bg-[color-mix(in_srgb,var(--bg)_70%,transparent)] backdrop-blur-2xl shadow-[0_16px_48px_var(--shadow)]"
                >
                  <div className="p-1">
                    <Link
                      to="/profile"
                      role="menuitem"
                      onClick={() => { setProfileOpen(false); dispatchNavigate('/profile') }}
                      className="flex w-full touch-manipulation items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-[color-mix(in_srgb,var(--text)_5%,transparent)]"
                      style={{ touchAction: 'manipulation' } as any}
                    >
                      <span className="grid h-6 w-6 shrink-0 place-items-center overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--text)_10%,transparent)] text-[9px] font-bold text-[var(--text)]" aria-hidden>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--text)]">
                          <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                          <circle cx="12" cy="7" r="4" />
                        </svg>
                      </span>
                      <span className="text-xs font-medium text-[var(--text)]">Profile</span>
                    </Link>
                    <Link
                      to="/settings"
                      role="menuitem"
                      onClick={() => { setProfileOpen(false); dispatchNavigate('/settings') }}
                      className="flex w-full touch-manipulation items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-[color-mix(in_srgb,var(--text)_5%,transparent)]"
                      style={{ touchAction: 'manipulation' } as any}
                    >
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--text)_10%,transparent)]" aria-hidden>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[var(--text)]">
                          <circle cx="12" cy="12" r="3" />
                          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
                        </svg>
                      </span>
                      <span className="text-xs font-medium text-[var(--text)]">Settings</span>
                    </Link>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {mobileSearchOpen && !navFits && (
        <div ref={mobileSearchRef} className="absolute left-0 right-0 top-14 border-t border-[var(--border)] bg-[var(--bg)] px-4 py-3 shadow-lg shadow-black/20">
          <form onSubmit={onSearch} className="flex gap-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => { setQuery(e.target.value); setShowSuggestions(true) }}
              onFocus={() => { if (query.trim().length >= 2) setShowSuggestions(true) }}
              placeholder="Search anime"
              className="flex-1 rounded-full border border-[var(--border)] bg-[var(--text)]/[0.08] px-4 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[var(--border-strong)] focus:outline-none"
            />
            <button type="submit" className="rounded-full bg-[var(--text)] px-5 text-sm font-medium text-[var(--on-text)]">
              Go
            </button>
          </form>
          {showSuggestions && query.trim().length >= 2 && (
            <div className="relative mt-2 isolate">
              <SearchSuggestions query={query} onClose={() => { setShowSuggestions(false); setMobileSearchOpen(false) }} onPreview={(a) => { setMobileSearchOpen(false); if (!isAuthenticated) setSignInOpen(true); else setPreviewAnime(a) }} />
            </div>
          )}
        </div>
      )}
      {mobileNavOpen && !navFits && (
        <nav className="absolute left-0 right-0 top-14 border-t border-[var(--border)] bg-[var(--bg)] px-4 py-3 shadow-lg shadow-black/20 anim-slide-down" aria-label="Mobile sections">
          <div className="flex flex-col gap-1">
            {mobileNav.filter(l => l.to !== '/search').map((l) => (
              <Link
                key={l.to}
                to={l.to}
                onClick={() => {
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
                className="mt-2 touch-manipulation rounded-full bg-[var(--text)] px-4 py-3 text-sm font-semibold text-[var(--on-text)]"
                style={{ touchAction: 'manipulation' } as any}
              >
                Sign in
              </button>
            )}
          </div>
        </nav>
      )}
      {previewAnime && <DetailModal key={previewAnime.identity.internalId} anime={previewAnime} onClose={() => setPreviewAnime(null)} />}
      {signInOpen && <SignInModal onClose={() => setSignInOpen(false)} />}
    </header>
    </>
  )
}
