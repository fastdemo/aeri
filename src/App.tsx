import { useEffect } from 'react'
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Navbar } from './components/navigation/Navbar'
import { Home } from './pages/Home'
import { Browse } from './pages/Browse'
import { Search } from './pages/Search'
import { MyList } from './pages/MyList'
import { Watch } from './pages/Watch'
import { AnimeDetail } from './pages/AnimeDetail'
import { Settings } from './pages/Settings'
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
    <div className="min-h-screen bg-[var(--bg)]">
      <FaviconGuard />
      <Navbar />
      <main className="pt-14">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/browse" element={<Browse />} />
          <Route path="/search" element={<Search />} />
          <Route path="/list" element={<MyList />} />
          <Route path="/anime/:id" element={<AnimeDetail />} />
          <Route path="/watch/:id/:episode" element={<Watch />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <footer className="border-t border-white/5">
        <div className="mx-auto flex h-10 max-w-[1600px] items-center justify-between gap-3 px-4 text-[11px] sm:px-6 lg:px-12">
          <div className="flex min-w-0 items-center gap-2">
            <span className="font-semibold tracking-[-0.02em] text-white/80" style={{ fontFamily: '"Cal Sans", sans-serif' }}>aeri</span>
            <span className="hidden truncate text-white/40 sm:inline">anime, quietly.</span>
          </div>
          <span className="hidden shrink-0 text-white/25 md:inline">© 2026 Aeri</span>
          <div className="flex shrink-0 items-center gap-3">
            <a href="https://github.com/fastdemo/aeri" className="text-white/40 transition hover:text-white">GitHub</a>
            <span className="text-white/40">Privacy</span>
            <a href="https://aeri.fastdemo.workers.dev/api/health" className="text-white/40 transition hover:text-white">Status</a>
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
