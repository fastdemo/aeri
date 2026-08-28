import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Navbar } from './components/navigation/Navbar'
import { Home } from './pages/Home'
import { Browse } from './pages/Browse'
import { Search } from './pages/Search'
import { MyList } from './pages/MyList'
import { Watch } from './pages/Watch'
import { AnimeDetail } from './pages/AnimeDetail'

function Layout() {
  return (
    <div className="min-h-screen bg-[var(--bg)]">
      <Navbar />
      <main className="pt-14">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/browse" element={<Browse />} />
          <Route path="/search" element={<Search />} />
          <Route path="/list" element={<MyList />} />
          <Route path="/anime/:id" element={<AnimeDetail />} />
          <Route path="/watch/:id/:episode" element={<Watch />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <footer className="mx-auto max-w-[1600px] border-t border-white/5 px-4 py-8 text-center text-xs text-white/30 sm:px-6 lg:px-12">
        Aeri — anime, quietly. • Mock data • No backend • <a href="https://github.com/fastdemo/aeri" className="underline hover:text-white/50">GitHub</a>
      </footer>
    </div>
  )
}

export default function App() {
  return (
    <HashRouter>
      <Layout />
    </HashRouter>
  )
}
