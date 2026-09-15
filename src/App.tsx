import { useEffect } from 'react'
import { HashRouter, Routes, Route, useLocation } from 'react-router-dom'
import { Navbar } from './components/navigation/Navbar'
import { Home } from './pages/Home'
import { Browse } from './pages/Browse'
import { Search } from './pages/Search'
import { MyList } from './pages/MyList'
import { Watch } from './pages/Watch'
import { AnimeDetail } from './pages/AnimeDetail'
import { Settings } from './pages/Settings'
import { NotFound, MangaPlaceholder, ProfilePlaceholder } from './pages/NotFound'
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

function Layout() {
  const { pathname } = useLocation()
  // Every route change starts at the top (search typing only replaces ?q=,
  // which keeps the pathname — no disruptive jumps while typing)
  useEffect(() => {
    try { window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior }) } catch {
      try { window.scrollTo(0, 0) } catch {}
    }
  }, [pathname])
  return (
    <div className="flex min-h-screen flex-col bg-[var(--bg)]">
      <FaviconGuard />
      <Navbar />
      <main className="flex-1 pt-14">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/browse" element={<Browse />} />
          <Route path="/search" element={<Search />} />
          <Route path="/list" element={<MyList />} />
          <Route path="/anime/:id" element={<AnimeDetail />} />
          <Route path="/watch/:id/:episode" element={<Watch />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/manga" element={<MangaPlaceholder />} />
          <Route path="/profile" element={<ProfilePlaceholder />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <footer className="border-t border-white/5">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-3 px-4 py-5 text-[11px] sm:px-6 lg:px-12">
          <div className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-white/25">aeri by @fastdemo</span>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <a href="https://github.com/fastdemo/aeri" className="text-white/40 transition-colors duration-200 hover:text-white">GitHub</a>
            <span className="cursor-pointer text-white/40 transition-colors duration-200 hover:text-white">Docs</span>
            <span className="cursor-pointer text-white/40 transition-colors duration-200 hover:text-white">Legal</span>
          </div>
        </div>
      </footer>
    </div>
  )
}

export default function App() {
  return (
    <HashRouter>
      <AniListProvider>
        <MALProvider>
          <TrackingProvider>
            <Layout />
          </TrackingProvider>
        </MALProvider>
      </AniListProvider>
    </HashRouter>
  )
}
