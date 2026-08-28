import { useEffect, useState } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'

export function Navbar() {
  const [scrolled, setScrolled] = useState(false)
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [query, setQuery] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (query.trim()) {
      navigate(`/search?q=${encodeURIComponent(query.trim())}`)
      setMobileSearchOpen(false)
    }
  }

  return (
    <header
      className={`fixed inset-x-0 top-0 z-40 h-14 transition-colors duration-300 ${
        scrolled
          ? 'bg-[var(--bg)]/95 backdrop-blur-md border-b border-[var(--border)]'
          : 'bg-gradient-to-b from-black/70 via-black/20 to-transparent'
      }`}
      aria-label="Primary"
    >
      <div className="mx-auto flex h-full max-w-[1600px] items-center justify-between gap-6 px-4 sm:px-6 lg:px-12">
        {/* Left */}
        <div className="flex items-center gap-8">
          <Link
            to="/"
            className="text-[19px] font-semibold tracking-[-0.02em] text-white"
            aria-label="Aeri home"
          >
            Aeri
          </Link>

          <nav className="hidden items-center gap-5 md:flex" aria-label="Sections">
            {[
              { to: '/', label: 'Home' },
              { to: '/browse', label: 'Browse' },
              { to: '/list', label: 'My List' },
            ].map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                className={({ isActive }) =>
                  `text-[13px] font-medium transition-colors ${
                    isActive ? 'text-white' : 'text-white/70 hover:text-white'
                  }`
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>
          {/* Mobile menu */}
          <button
            aria-label="Menu"
            onClick={() => setMobileNavOpen((v) => !v)}
            className="grid h-8 w-8 place-items-center rounded-full text-white/80 hover:bg-white/10 hover:text-white md:hidden"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M4 7h16M4 12h16M4 17h16" />
            </svg>
          </button>
        </div>

        {/* Right */}
        <div className="flex items-center gap-3">
          {/* Desktop search */}
          <form onSubmit={onSearch} className="hidden items-center md:flex">
            <div className="relative">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search"
                aria-label="Search anime"
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
            </div>
          </form>

          {/* Mobile search toggle */}
          <button
            aria-label="Search"
            onClick={() => setMobileSearchOpen((v) => !v)}
            className="grid h-8 w-8 place-items-center rounded-full text-white/80 hover:bg-white/10 hover:text-white md:hidden"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
          </button>

          <button
            aria-label="Notifications"
            className="hidden h-8 w-8 place-items-center rounded-full text-white/70 hover:bg-white/10 hover:text-white md:grid"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 3a5 5 0 0 1 5 5v4a2 2 0 0 0 .45 1.26L18.5 15H5.5l1.05-1.74A2 2 0 0 0 7 12V8a5 5 0 0 1 5-5Z" />
              <path d="M9 17a3 3 0 0 0 6 0" />
            </svg>
          </button>

          <div className="h-6 w-px bg-white/10 hidden md:block" />

          <Link
            to="/list"
            aria-label="Profile"
            className="h-7 w-7 overflow-hidden rounded bg-gradient-to-br from-violet-600 to-indigo-600"
          >
            <span className="grid h-full w-full place-items-center text-[11px] font-semibold text-white">A</span>
          </Link>
        </div>
      </div>

      {/* Mobile search bar */}
      {mobileSearchOpen && (
        <div className="border-t border-white/10 bg-[var(--bg)] px-4 py-3 md:hidden">
          <form onSubmit={onSearch} className="flex gap-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search anime"
              className="flex-1 rounded-full border border-white/10 bg-white/[0.08] px-4 py-2 text-sm text-white placeholder:text-white/50 focus:border-white/20 focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-full bg-white px-5 text-sm font-medium text-black"
            >
              Go
            </button>
          </form>
        </div>
      )}
      {mobileNavOpen && (
        <nav className="border-t border-white/10 bg-[var(--bg)] px-4 py-3 md:hidden" aria-label="Mobile sections">
          <div className="flex flex-col gap-1">
            {[
              { to: '/', label: 'Home' },
              { to: '/browse', label: 'Browse' },
              { to: '/list', label: 'My List' },
              { to: '/search', label: 'Search' },
            ].map((l) => (
              <Link
                key={l.to}
                to={l.to}
                onClick={() => setMobileNavOpen(false)}
                className="rounded px-3 py-2 text-sm font-medium text-white/80 hover:bg-white/10 hover:text-white"
              >
                {l.label}
              </Link>
            ))}
          </div>
        </nav>
      )}
    </header>
  )
}
