import { useState, useEffect } from 'react'
import { getPreferences, setPreferences, type Preferences } from '../storage/preferences'
import { useAniList } from '../contexts/AniListContext'
import { useMAL } from '../contexts/MALContext'
import { clearAnilistMemoryCache } from '../services/anilist/client'
import { clearMalMemoryCache } from '../services/mal/client'
import { getProviderCapabilities } from '../providers/video/registry'

export function Settings() {
  const [prefs, setPrefs] = useState<Preferences>(() => getPreferences())
  const ani = useAniList()
  const mal = useMAL()
  const [clearing, setClearing] = useState<string | null>(null)
  const [reducedMotion, setReducedMotion] = useState(() => {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
  })

  // Watch for system reduced motion
  useEffect(() => {
    try {
      const m = window.matchMedia('(prefers-reduced-motion: reduce)')
      const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches)
      m.addEventListener('change', onChange)
      return () => m.removeEventListener('change', onChange)
    } catch {}
  }, [])

  const updatePref = (patch: Partial<Preferences>) => {
    const next = setPreferences(patch)
    setPrefs(next)
  }

  const handleClearCache = async () => {
    setClearing('cache')
    try {
      // Clear IDB cache store
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const req = indexedDB.open('aeri', 2)
        req.onsuccess = () => res(req.result)
        req.onerror = () => rej(req.error)
      })
      await new Promise<void>((res, rej) => {
        const tx = db.transaction('cache', 'readwrite')
        tx.objectStore('cache').clear()
        tx.oncomplete = () => res()
        tx.onerror = () => rej(tx.error)
      })
      clearAnilistMemoryCache()
      clearMalMemoryCache()
      // Also clear video memory cache via registry (import dynamically to avoid cycle)
      try {
        const { clearVideoMemoryCache } = await import('../providers/video/base')
        clearVideoMemoryCache()
      } catch {}
    } catch {}
    setTimeout(() => setClearing(null), 800)
  }

  const handleClearWatchPos = async () => {
    setClearing('watchPos')
    try {
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const req = indexedDB.open('aeri', 2)
        req.onsuccess = () => res(req.result)
        req.onerror = () => rej(req.error)
      })
      await new Promise<void>((res, rej) => {
        const tx = db.transaction('watchPos', 'readwrite')
        tx.objectStore('watchPos').clear()
        tx.oncomplete = () => res()
        tx.onerror = () => rej(tx.error)
      })
      localStorage.removeItem('aeri:progress:anilist-154587')
    } catch {}
    setTimeout(() => setClearing(null), 800)
  }

  const handleResetAll = async () => {
    if (!confirm('Reset all local data? This will clear cache, watch positions, and preferences (accounts stay connected). Continue?')) return
    setClearing('all')
    try {
      // Clear cache and watchPos as above
      await handleClearCache()
      await handleClearWatchPos()
      // Reset prefs to defaults
      localStorage.removeItem('aeri:prefs')
      setPrefs(getPreferences())
    } catch {}
    setClearing(null)
  }

  const videoCaps = getProviderCapabilities().filter(c => c.id !== 'mock')

  return (
    <div className="mx-auto max-w-[900px] px-4 py-6 sm:px-6 lg:px-12">
      <h1 className="text-[18px] font-semibold tracking-tight text-white">Settings</h1>
      <p className="text-xs text-white/50">Manage accounts, playback, and local data. All settings stay in your browser.</p>

      {/* Account / Connections */}
      <section className="mt-6 rounded-xl border border-white/10 bg-white/[0.02] p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-white">Account & Connections</h2>
        <p className="mt-1 text-xs text-white/50">Connect AniList to sync your list and progress. MAL is parked due to CORS (see docs).</p>

        <div className="mt-4 space-y-3">
          <div className="rounded-lg border border-white/10 bg-[#0e0e10] p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-white">AniList</p>
                <p className="text-[11px] text-white/50">
                  {ani.isAuthenticated && ani.user ? `Connected as ${ani.user.name}` : 'Not connected'}
                </p>
              </div>
              {ani.isAuthenticated ? (
                <button onClick={() => ani.logout()} className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/15">Disconnect</button>
              ) : (
                <button onClick={() => ani.login()} className="rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black hover:bg-white/90">Connect AniList</button>
              )}
            </div>
            {ani.isAuthenticated && ani.user?.avatar?.large && (
              <div className="mt-3 flex items-center gap-2">
                <img src={ani.user.avatar.large} alt="" className="h-7 w-7 rounded-full bg-white/10" loading="lazy" />
                <span className="text-xs text-white/70">{ani.user.name}</span>
                {ani.authExpired && <span className="text-xs text-amber-200/70">• Session expired</span>}
              </div>
            )}
            {ani.error && !ani.isAuthenticated && <p className="mt-2 text-xs text-amber-200/70">{ani.error}</p>}
          </div>

          <div className="rounded-lg border border-white/10 bg-[#0e0e10] p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-white">MyAnimeList</p>
                <p className="text-[11px] text-white/50">
                  {mal.isAuthenticated && mal.user ? `Connected as ${mal.user.name}` : 'Parked — CORS blocked on GitHub Pages'}
                </p>
              </div>
              {mal.isAuthenticated ? (
                <button onClick={() => mal.logout()} className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/15">Disconnect</button>
              ) : (
                <button onClick={() => mal.login().catch(()=>{})} className="rounded-full bg-white/10 px-4 py-1.5 text-xs font-medium text-white hover:bg-white/15">Connect MAL</button>
              )}
            </div>
            <p className="mt-2 text-[11px] leading-4 text-white/30">
              MAL requires a backend for OAuth/token due to missing CORS headers (<code className="rounded bg-white/10 px-1 py-0.5">api.myanimelist.net</code>). See <code className="rounded bg-white/10 px-1 py-0.5">docs/MAL_BROWSER_FEASIBILITY.md</code>.
            </p>
            {mal.error && <p className="mt-2 text-xs text-amber-200/70">{mal.error}</p>}
          </div>
        </div>
      </section>

      {/* Playback */}
      <section className="mt-6 rounded-xl border border-white/10 bg-white/[0.02] p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-white">Playback</h2>
        <div className="mt-4 space-y-4">
          <label className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-white">Autoplay next episode</p>
              <p className="text-[11px] text-white/50">When a video ends, automatically go to the next episode (if available).</p>
            </div>
            <input
              type="checkbox"
              checked={prefs.autoplay}
              onChange={e => updatePref({ autoplay: e.target.checked })}
              className="h-4 w-4 rounded border-white/20 bg-white/10 text-white focus:ring-white/20"
              aria-label="Autoplay next episode"
            />
          </label>

          <label className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-white">Subtitles</p>
              <p className="text-[11px] text-white/50">Show subtitles by default when the provider supplies them.</p>
            </div>
            <input
              type="checkbox"
              checked={prefs.subtitles}
              onChange={e => updatePref({ subtitles: e.target.checked })}
              className="h-4 w-4 rounded border-white/20 bg-white/10 text-white focus:ring-white/20"
              aria-label="Subtitles on"
            />
          </label>

          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-white">Volume</p>
              <p className="text-[11px] text-white/50">Default volume for direct video playback (embed players use their own).</p>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={prefs.volume}
              onChange={e => updatePref({ volume: Number(e.target.value) })}
              aria-label="Default volume"
              className="w-24 accent-white"
            />
          </div>
        </div>
      </section>

      {/* Video Sources */}
      <section className="mt-6 rounded-xl border border-white/10 bg-white/[0.02] p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-white">Playback Sources</h2>
        <p className="mt-1 text-xs text-white/50">Choose how Aeri picks video sources. Most sources need a backend on GitHub Pages.</p>
        <div className="mt-4 space-y-4">
          <div>
            <p className="text-xs font-medium text-white">Preferred audio</p>
            <p className="text-[11px] text-white/50">Sub: Japanese with subtitles. Dub: English where available. Falls back if missing.</p>
            <div className="mt-2 inline-flex rounded-full border border-white/10 bg-white/[0.04] p-1" role="radiogroup" aria-label="Preferred audio">
              {(['sub','dub'] as const).map(lang => (
                <button
                  key={lang}
                  role="radio"
                  aria-checked={prefs.preferredAudio === lang}
                  onClick={() => updatePref({ preferredAudio: lang })}
                  className={`rounded-full px-4 py-1 text-xs font-medium ${prefs.preferredAudio === lang ? 'bg-white text-black' : 'text-white/70 hover:text-white'}`}
                >
                  {lang === 'sub' ? 'Sub' : 'Dub'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-white">Preferred source</p>
            <p className="text-[11px] text-white/50">Auto tries your choice first, then others.</p>
            <select
              value={prefs.preferredProvider ?? ''}
              onChange={e => updatePref({ preferredProvider: e.target.value || null })}
              aria-label="Preferred source"
              className="mt-2 w-full max-w-[260px] rounded-full border border-white/10 bg-white/[0.06] px-3 py-2 text-xs text-white focus:border-white/20 focus:outline-none"
            >
              <option value="" className="bg-[#141416]">Auto (Recommended)</option>
              {videoCaps.map(c => (
                <option key={c.id} value={c.id} className="bg-[#141416]">{c.displayName}</option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-white/30">
              {prefs.preferredProvider ? `Trying ${prefs.preferredProvider} first, then fallback.` : 'Auto picks the best available source.'}
              {!(import.meta.env.VITE_VIDEO_API_URL as string | undefined) && ' Add VITE_VIDEO_API_URL for real playback.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5 pt-2">
            {videoCaps.map(c => (
              <span key={c.id} className={`rounded-full border px-2 py-1 text-[10px] ${prefs.preferredProvider === c.id ? 'border-white/20 bg-white/10 text-white' : 'border-white/10 bg-white/[0.03] text-white/40'}`}>
                {c.displayName} {c.languages.join('/')} {c.embed ? '• embed' : ''} {c.directVideo ? '• video' : ''}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Appearance */}
      <section className="mt-6 rounded-xl border border-white/10 bg-white/[0.02] p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-white">Appearance</h2>
        <div className="mt-3 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-white">Reduced motion</p>
            <p className="text-[11px] text-white/50">Respects system setting <code className="rounded bg-white/10 px-1 py-0.5">prefers-reduced-motion</code> {reducedMotion ? '(currently on)' : '(currently off)'}. Aeri uses subtle 150-200ms hovers.</p>
          </div>
          <span className="text-xs text-white/30">{reducedMotion ? 'On' : 'Off'}</span>
        </div>
        <p className="mt-3 text-[11px] text-white/30">Aeri is dark-only (near-black #070708) — light theme not available.</p>
      </section>

      {/* Data / Cache */}
      <section className="mt-6 rounded-xl border border-white/10 bg-white/[0.02] p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-white">Data & Cache</h2>
        <p className="mt-1 text-xs text-white/50">All data stays in your browser (localStorage + IndexedDB). Clearing cache does not disconnect accounts.</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <button
            onClick={handleClearCache}
            disabled={clearing === 'cache'}
            className="rounded-full bg-white/10 px-4 py-2 text-xs font-medium text-white hover:bg-white/15 disabled:opacity-50"
          >
            {clearing === 'cache' ? 'Clearing…' : 'Clear cached data'}
          </button>
          <button
            onClick={handleClearWatchPos}
            disabled={clearing === 'watchPos'}
            className="rounded-full bg-white/10 px-4 py-2 text-xs font-medium text-white hover:bg-white/15 disabled:opacity-50"
          >
            {clearing === 'watchPos' ? 'Clearing…' : 'Clear watch positions'}
          </button>
          <button
            onClick={handleResetAll}
            disabled={!!clearing}
            className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-black hover:bg-white/90 disabled:opacity-50"
          >
            Reset local data
          </button>
        </div>
        <p className="mt-2 text-[11px] text-white/30">Clear cached data: removes API cache (not accounts). Clear watch positions: removes local resume points. Reset: cache + positions + preferences (accounts stay).</p>
      </section>

      {/* About */}
      <section className="mt-6 rounded-xl border border-white/10 bg-white/[0.02] p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-white">About</h2>
        <div className="mt-3 space-y-2 text-xs leading-5">
          <p><span className="text-white/50">Version:</span> <span className="text-white/80">Phase 8 • {new Date().getFullYear()}</span></p>
          <p><span className="text-white/50">Data:</span> <span className="text-white/80">AniList GraphQL (https://graphql.anilist.co) — Trending/Popular/Airing/New/Upcoming/Finished, Search, Media, relations for seasons</span></p>
          <p><span className="text-white/50">Video:</span> <span className="text-white/80">{videoCaps.map(c => `${c.displayName} (${c.languages.join('/')})`).join(' • ') || 'No browser-compatible source (static)'} </span></p>
          <p><span className="text-white/50">Storage:</span> <span className="text-white/80">localStorage (prefs, tokens) + IndexedDB (cache 24h, watchPos). No backend.</span></p>
          <p className="pt-2">
            <a href="https://github.com/fastdemo/aeri" className="underline hover:text-white/80 text-white/50">GitHub</a>
            <span className="mx-2 text-white/20">•</span>
            <span className="text-white/30">Privacy: no tracking, no cookies beyond auth, no video stored.</span>
          </p>
        </div>
      </section>
    </div>
  )
}
