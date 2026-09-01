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
      <footer className="mx-auto max-w-[1600px] border-t border-white/5 px-4 py-8 text-center text-xs text-white/30 sm:px-6 lg:px-12">
        Aeri — anime, quietly. • No backend • <a href="https://github.com/fastdemo/aeri" className="underline hover:text-white/50">GitHub</a>
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
