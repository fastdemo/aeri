import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom'
import { useAeriTitle } from './hooks/useAeriTitle'
import { routeDefaultTitle } from './lib/pageTitle'
import { Navbar } from './components/navigation/Navbar'
import { Home } from './pages/Home'
import { Browse } from './pages/Browse'
import { Search } from './pages/Search'
import { MyList } from './pages/MyList'
import { Watch } from './pages/Watch'
import { Read } from './pages/Read'
import { DetailRoute } from './components/detail/DetailRoute'
import type { DetailNavState } from './hooks/useDetailOpen'
import { Settings } from './pages/Settings'
import { NotFound } from './pages/NotFound'
import { Profile } from './pages/Profile'
import { Manga } from './pages/Manga'
import { Docs } from './pages/Docs'
import { Legal } from './pages/Legal'
import { AniListProvider } from './contexts/AniListContext'
import { MALProvider } from './contexts/MALContext'
import { TrackingProvider } from './contexts/TrackingContext'

function FaviconGuard() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    const base = import.meta.env.BASE_URL || '/'
    const b = base.endsWith('/') ? base : `${base}/`
    const ensure = (rel: string, href: string, type?: string, sizes?: string) => {
      if (document.querySelector(`link[rel="${rel}"][href="${href}"]`)) return
      const el = document.createElement('link')
      el.rel = rel
      el.href = href
      if (type) el.type = type
      if (sizes) el.setAttribute('sizes', sizes)
      document.head.appendChild(el)
    }
    // ensure all favicons exist with correct base (prevents 404 after hash nav / stale 404.html fallback)
    ensure('icon', `${b}favicon.ico`, 'image/x-icon')
    ensure('icon', `${b}favicon.png`, 'image/png', '32x32')
    ensure('icon', `${b}favicon.svg`, 'image/svg+xml')
    ensure('shortcut icon', `${b}favicon.ico`)
    ensure('apple-touch-icon', `${b}apple-touch-icon.png`)
  }, [pathname, hash])
  return null
}

// Detail overlay routes: /anime/:id + /manga/:id render the floating card
// ON TOP of the page it was opened from. React Router's location prop does
// the layering — the base <Routes> keeps rendering the background page
// (carried in history state; Home for plain deep links) while the overlay
// <Routes> matches the detail path. Browser Back closes the card.
const DETAIL_ROUTE_RE = /^\/(anime|manga)\/([^/]+)$/

function Layout() {
  const location = useLocation()
  const { pathname } = location
  const detailMatch = DETAIL_ROUTE_RE.exec(pathname)
  // TAB TITLE — route fallback ("Home - Aeri", "Manga - Aeri", the quoted
  // live search term …). Mapped centrally from the pathname/search so no
  // page component has to wire a static title; live-data names (show
  // titles on detail overlays, Watch/Read pages) layer an 'override' on
  // top via the same hook and restore on close. See useAeriTitle.
  useAeriTitle(routeDefaultTitle(pathname, location.search), 'base')
  // Background page the card was opened from: explicit when pushed from a
  // list page (history state rides along); Home for bare show URLs.
  const navState = (location.state ?? null) as DetailNavState | null
  // CARD ≠ PAGE CONTROLS (owner 2026-10-18): the base <Routes> must ALWAYS
  // receive an explicit `location` prop. react-router's useRoutesImpl
  // returns matched elements BARE when location is undefined but wraps them
  // in a LocationContext.Provider when it is set (dist line
  // `if (locationArg && renderedMatches)`) — passing undefined while a
  // detail URL is active changes the ELEMENT TREE SHAPE between the two
  // states, and React unmounts + remounts the whole background page on
  // every card open/close (proved via Home mount/salt logs + a connected
  // node probe: the pre-open "Continue Watching" heading was replaced by an
  // identical twin). With a location prop ALWAYS set, the tree shape is
  // constant and the background page RECONCILES — no remount, no reshuffle
  // of the seeded rows, no scroll jump: Netflix-open behavior.
  const bgLocation = detailMatch ? (navState?.background ?? { pathname: '/' }) : location

  // Scroll reset keyed on the SURFACE, not the raw path: opening or closing
  // the floating card must not yank the page behind it to the top (detail
  // URLs collapse onto the page they were opened from, or Home).
  const scrollKey = detailMatch ? (navState?.background?.pathname ?? '/') : pathname
  useEffect(() => {
    try { window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior }) } catch {
      try { window.scrollTo(0, 0) } catch {}
    }
  }, [scrollKey])
  return (
    <div className="flex min-h-screen flex-col bg-[var(--bg)]">
      <FaviconGuard />
      <Navbar />
      <main className="flex-1 pt-14">
        {/* Base surface: keeps the background page mounted under the card
            (own location while a detail URL is active). /anime/:id and
            /manga/:id are intentionally NOT here — they exist only as the
            overlay routes below. `location` is ALWAYS explicit (see comment
            above): an undefined↔object flip changes the element tree shape
            inside useRoutesImpl and remounts the background page. */}
        <Routes location={bgLocation}>
          <Route path="/" element={<Home />} />
          <Route path="/anime" element={<Browse />} />
          <Route path="/search" element={<Search />} />
          <Route path="/list" element={<MyList />} />
          <Route path="/watch/:id/:episode" element={<Watch />} />
          <Route path="/read/:id/:chapter" element={<Read />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/manga" element={<Manga />} />
          <Route path="/docs" element={<Docs />} />
          <Route path="/legal" element={<Legal />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        {detailMatch && (
          <Routes>
            <Route path="/anime/:id" element={<DetailRoute kind="anime" />} />
            <Route path="/manga/:id" element={<DetailRoute kind="manga" />} />
          </Routes>
        )}
      </main>
      {/* OWNER 2026-10-18: hidden below the `sm` boundary (640px) — the
          same scaling where the hero carousel dots-pill moves to the
          top-right (Hero.tsx comment: "<640"): on the tightest layouts
          the footer is noise. KEEP THE BREAKPOINT IN SYNC with the hero
          pill placement if either changes. */}
      <footer className="hidden border-t border-[var(--border)] sm:block">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-3 px-4 py-5 text-[11px] sm:px-6 lg:px-12">
          <div className="flex min-w-0 items-center gap-2">
            {/* Hover rolls the tagline up and out while the credit rolls
                up and in (single-slot vertical swap, overflow-hidden, fixed
                height = one line). Grid-stacked so width never shifts.
                Touch/keyboard get the credit via focus-within too. Respects
                prefers-reduced-motion (instant swap, no slide). */}
            <span className="group/credit grid shrink-0 grid-cols-1 grid-rows-1 overflow-hidden text-[color-mix(in_srgb,var(--text)_25%,transparent)] [height:1.6em]" tabIndex={0} aria-label="made by otakus, for otakus. aeri by @fastdemo">
              <span aria-hidden className="col-start-1 row-start-1 transition-transform duration-300 ease-out group-hover/credit:-translate-y-full group-focus-within/credit:-translate-y-full motion-reduce:transition-none">made by otakus, for otakus.</span>
              <span aria-hidden className="col-start-1 row-start-1 translate-y-full transition-transform duration-300 ease-out group-hover/credit:translate-y-0 group-focus-within/credit:translate-y-0 motion-reduce:transition-none">aeri by @fastdemo</span>
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <a href="https://github.com/fastdemo/aeri" className="text-[var(--text-faint)] transition-colors duration-200 hover:text-[var(--text)]">GitHub</a>
            <Link to="/docs" className="text-[var(--text-faint)] transition-colors duration-200 hover:text-[var(--text)]">Docs</Link>
            <Link to="/legal" className="text-[var(--text-faint)] transition-colors duration-200 hover:text-[var(--text)]">Legal</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}

// App served for every non-asset path: the Worker's SPA fallback hands out
// this document for deep links like /anime/123 (BrowserRouter owns routing).
// Legacy #/ hash links are translated to paths in main.tsx before mount.
export default function App() {
  return (
    <BrowserRouter>
      <AniListProvider>
        <MALProvider>
          <TrackingProvider>
            <Layout />
          </TrackingProvider>
        </MALProvider>
      </AniListProvider>
    </BrowserRouter>
  )
}
