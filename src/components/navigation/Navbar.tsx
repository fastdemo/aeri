import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAniList } from '../../contexts/AniListContext'
import { useMAL } from '../../contexts/MALContext'
import { SearchSuggestions } from '../search/SearchSuggestions'

export function Navbar() {
  const [scrolled, setScrolled] = useState(false)
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const searchRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const location = useLocation()
  const { user: anilistUser, isAuthenticated: anilistAuth, login: anilistLogin } = useAniList()
  const { user: malUser, isAuthenticated: malAuth } = useMAL()
  const isAuthenticated = anilistAuth || malAuth
  const user = anilistUser ?? malUser ?? null

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
  }, [location.pathname, location.search, location.hash])

  // Close suggestions on outside click — deferred so click→navigate isn't swallowed
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        queueMicrotask(() => setShowSuggestions(false))
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const dispatchNavigate = (to?: string) => {
    queueMicrotask(() => {
      try { window.dispatchEvent(new CustomEvent('aeri:navigate')) } catch {}
    })
    if (to) {
      const expected = `#${to}`;
      setTimeout(() => {
        try {
          if (window.location.hash !== expected) {
            const isHome = to === '/' && (window.location.hash === '#/' || window.location.hash === '' || window.location.hash === '#');
            if (!isHome) window.location.hash = to;
          }
        } catch {}
      }, 180);
    }
  }

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    const target = `/search?q=${encodeURIComponent(q)}`;
    navigate(target)
    setTimeout(() => {
      try { if (window.location.hash !== `#${target}`) window.location.hash = target; } catch {}
    }, 180);
    queueMicrotask(() => {
      try { window.dispatchEvent(new CustomEvent('aeri:navigate')) } catch {}
      setMobileSearchOpen(false)
      setShowSuggestions(false)
    })
  }

  // Desktop nav items — Settings only when authenticated
  const desktopNav = [
    { to: '/', label: 'Home' },
    { to: '/browse', label: 'Browse' },
    { to: '/list', label: 'My List' },
    ...(isAuthenticated ? [{ to: '/settings', label: 'Settings' } as const] : []),
  ]

  const mobileNav = [
    { to: '/', label: 'Home' },
    { to: '/browse', label: 'Browse' },
    { to: '/list', label: 'My List' },
    { to: '/search', label: 'Search' },
    ...(isAuthenticated ? [{ to: '/settings', label: 'Settings' } as const] : []),
  ]

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 h-14 transition-colors duration-300 ${
        scrolled
          ? 'bg-[var(--bg)]/95 backdrop-blur-md border-b border-[var(--border)]'
          : 'bg-gradient-to-b from-black/70 via-black/20 to-transparent'
      }`}
      aria-label="Primary"
    >
      <div className="mx-auto flex h-full max-w-[1600px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-12 lg:gap-6">
        <div className="flex items-center gap-5 lg:gap-8">
          {/* Logo — simple Aeri, unselectable */}
          <Link
            to="/"
            onClick={() => dispatchNavigate('/')}
            aria-label="aeri home"
            className="text-[19px] font-semibold tracking-[-0.02em] text-white select-none"
            style={{ fontFamily: '"Cal Sans", sans-serif', userSelect: 'none' } as any}
            draggable={false}
          >
            aeri
          </Link>

          <nav className="hidden items-center gap-5 lg:flex" aria-label="Sections">
            {desktopNav.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                onClick={() => dispatchNavigate(l.to)}
                className={({ isActive }) =>
                  `text-[13px] font-medium transition-colors px-2 py-1.5 rounded -mx-2 ${
                    isActive ? 'text-white' : 'text-white/70 hover:text-white'
                  }`
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>
          <button
            aria-label="Menu"
            aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen((v) => !v)}
            className="grid h-11 w-11 place-items-center rounded-full text-white/80 hover:bg-white/10 hover:text-white lg:hidden"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
        </div>

        <div className="flex items-center gap-2 lg:gap-3">
          <form onSubmit={onSearch} className="hidden items-center lg:flex">
            <div ref={searchRef} className="relative">
              <input
                value={query}
                onChange={(e) => { setQuery(e.target.value); setShowSuggestions(true) }}
                onFocus={() => { if (query.trim().length >= 2) setShowSuggestions(true) }}
                placeholder="Search"
                aria-label="Search anime"
                aria-expanded={showSuggestions}
                aria-controls="search-suggestions"
                className="h-8 w-[180px] rounded-full border border-white/10 bg-white/[0.08] py-0 pl-8 pr-3 text-[13px] text-white placeholder:text-white/50 backdrop-blur focus:w-[240px] focus:border-white/20 focus:bg-white/[0.12] focus:outline-none lg:w-[200px] transition-all"
              />
              <svg
                aria-hidden
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/60"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              {showSuggestions && query.trim().length >= 2 && (
                <SearchSuggestions query={query} onClose={() => setShowSuggestions(false)} />
              )}
            </div>
          </form>

          <button
            aria-label="Search"
            onClick={() => setMobileSearchOpen((v) => !v)}
            className="grid h-11 w-11 place-items-center rounded-full text-white/80 hover:bg-white/10 hover:text-white lg:hidden"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
          </button>

          {isAuthenticated && (
            <button
              aria-label="Notifications"
              className="hidden h-8 w-8 place-items-center rounded-full text-white/70 hover:bg-white/10 hover:text-white lg:grid"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 3a5 5 0 0 1 5 5v4a2 2 0 0 0 .45 1.26L18.5 15H5.5l1.05-1.74A2 2 0 0 0 7 12V8a5 5 0 0 1 5-5Z" />
                <path d="M9 17a3 3 0 0 0 6 0" />
              </svg>
            </button>
          )}

          {isAuthenticated && <div className="h-6 w-px bg-white/10 hidden lg:block" />}

          {!isAuthenticated ? (
            <button
              onClick={() => {
                try { anilistLogin() } catch {}
              }}
              className="inline-flex h-7 items-center rounded-full bg-white px-4 text-[13px] font-semibold text-black transition hover:bg-white/90 active:scale-[0.98] lg:h-8 lg:px-5"
              aria-label="Sign up with AniList"
            >
              Sign Up
            </button>
          ) : (
            <Link
              to="/list"
              onClick={() => dispatchNavigate('/list')}
              aria-label="Profile"
              className="relative h-7 w-7 overflow-hidden rounded bg-gradient-to-br from-violet-600 to-indigo-600"
            >
              {user?.avatar?.large ? (
                <img src={user.avatar.large} alt={user.name} className="h-full w-full object-cover" loading="lazy" />
              ) : (
                <span className="grid h-full w-full place-items-center text-[10px] font-bold text-white">{anilistAuth ? 'A' : 'M'}</span>
              )}
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-[var(--bg)] bg-emerald-500" aria-hidden />
            </Link>
          )}
        </div>
      </div>

      {mobileSearchOpen && (
        <div className="absolute left-0 right-0 top-14 border-t border-white/10 bg-[var(--bg)] px-4 py-3 lg:hidden shadow-lg shadow-black/20">
          <form onSubmit={onSearch} className="flex gap-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => { setQuery(e.target.value); setShowSuggestions(true) }}
              onFocus={() => { if (query.trim().length >= 2) setShowSuggestions(true) }}
              placeholder="Search anime"
              className="flex-1 rounded-full border border-white/10 bg-white/[0.08] px-4 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/20 focus:outline-none"
            />
            <button type="submit" className="rounded-full bg-white px-5 text-sm font-medium text-black">
              Go
            </button>
          </form>
          {showSuggestions && query.trim().length >= 2 && (
            <div className="relative mt-2">
              <SearchSuggestions query={query} onClose={() => { setShowSuggestions(false); setMobileSearchOpen(false) }} />
            </div>
          )}
        </div>
      )}
      {mobileNavOpen && (
        <nav className="absolute left-0 right-0 top-14 border-t border-white/10 bg-[var(--bg)] px-4 py-3 lg:hidden shadow-lg shadow-black/20" aria-label="Mobile sections">
          <div className="flex flex-col gap-1">
            {mobileNav.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                onClick={() => {
                  queueMicrotask(() => setMobileNavOpen(false))
                  dispatchNavigate(l.to)
                }}
                className="rounded px-3 py-3 text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white active:bg-white/5 touch-manipulation min-h-[44px] flex items-center"
              >
                {l.label}
              </Link>
            ))}
            {!isAuthenticated && (
              <button
                onClick={() => {
                  setMobileNavOpen(false)
                  try { anilistLogin() } catch {}
                }}
                className="mt-2 rounded-full bg-white px-4 py-3 text-sm font-semibold text-black"
              >
                Sign Up — Connect AniList
              </button>
            )}
          </div>
        </nav>
      )}
    </header>
  )
}
