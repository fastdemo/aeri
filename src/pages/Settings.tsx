import { useState, useEffect } from 'react'
import { getPreferences, setPreferences, type Preferences } from '../storage/preferences'
import { useAniList } from '../contexts/AniListContext'
import { useMAL } from '../contexts/MALContext'
import { clearAnilistMemoryCache } from '../services/anilist/client'
import { clearMalMemoryCache } from '../services/mal/client'
import { getProviderCapabilities, checkProviderHealth } from '../providers/video/registry'

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
      const { clearAllCache } = await import('../storage/db')
      await clearAllCache()
      clearAnilistMemoryCache()
      clearMalMemoryCache()
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
      const { clearAllWatchPos } = await import('../storage/db')
      await clearAllWatchPos()
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
  const [health, setHealth] = useState<Record<string, 'available'|'unavailable'>|null>(null)
  useEffect(() => {
    const ctrl = new AbortController()
    checkProviderHealth(ctrl.signal).then(setHealth).catch(()=>{})
    return () => ctrl.abort()
  }, [])
  const isEnabled = (id: string) => prefs.enabledProviders?.[id] !== false
  const toggleProvider = (id: string, enabled: boolean) => {
    const next = { ...(prefs.enabledProviders ?? {}), [id]: enabled }
    // If disabling preferred provider, clear preference
    if (!enabled && prefs.preferredProvider === id) {
      updatePref({ enabledProviders: next, preferredProvider: null })
    } else {
      updatePref({ enabledProviders: next })
    }
  }
  const moveProvider = (id: string, dir: -1|1) => {
    const currentOrder = prefs.providerOrder ?? videoCaps.map(c=>c.id)
    const idx = currentOrder.indexOf(id)
    if (idx < 0) return
    const nIdx = idx + dir
    if (nIdx < 0 || nIdx >= currentOrder.length) return
    const next = [...currentOrder]
    const tmp = next[idx]; next[idx]=next[nIdx]; next[nIdx]=tmp
    updatePref({ providerOrder: next })
  }
  const orderedCaps = (() => {
    const order = prefs.providerOrder
    if (!order) return videoCaps
    const map = new Map(videoCaps.map(c=>[c.id,c] as const))
    const out: typeof videoCaps = []
    for (const id of order) { const c = map.get(id); if (c) { out.push(c); map.delete(id) } }
    for (const c of map.values()) out.push(c)
    return out
  })()

  const isAuthenticated = ani.isAuthenticated || mal.isAuthenticated

  return (
    <div className="mx-auto max-w-[900px] px-4 py-6 sm:px-6 lg:px-12">
      <h1 className="text-[18px] font-semibold tracking-tight text-white">Settings</h1>
      <p className="text-xs text-white/50">Manage accounts, playback, and local data. All settings stay in your browser.</p>
      {!isAuthenticated && (
        <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-xs text-white/60">Connect AniList or MyAnimeList to sync your list and enable tracking. Playback preferences work without an account.</p>
        </div>
      )}

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
                  {mal.isAuthenticated && mal.user ? `Connected as ${mal.user.name}` : 'Not connected — via worker when configured'}
                </p>
              </div>
              {mal.isAuthenticated ? (
                <button onClick={() => mal.logout()} className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/15">Disconnect</button>
              ) : (
                <button onClick={() => mal.login().catch(()=>{})} className="rounded-full bg-white/10 px-4 py-1.5 text-xs font-medium text-white hover:bg-white/15">Connect MAL</button>
              )}
            </div>
            <p className="mt-2 text-[11px] leading-4 text-white/30">
              MAL works via the same worker as streaming when <code className="rounded bg-white/10 px-1 py-0.5">customVideoApiUrl</code> is set (proxies <code className="rounded bg-white/10 px-1 py-0.5">myanimelist.net</code> + <code className="rounded bg-white/10 px-1 py-0.5">api.myanimelist.net</code> with CORS). Direct browser without a worker is still CORS-blocked. See <code className="rounded bg-white/10 px-1 py-0.5">docs/MAL_BROWSER_FEASIBILITY.md</code>.
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
              {orderedCaps.filter(c=>isEnabled(c.id)).map(c => (
                <option key={c.id} value={c.id} className="bg-[#141416]">{c.displayName}</option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-white/30">
              {prefs.preferredProvider ? `Trying ${prefs.preferredProvider} first, then fallback.` : 'Auto picks the best available source.'}
              {!(import.meta.env.VITE_VIDEO_API_URL as string | undefined) && ' Add VITE_VIDEO_API_URL for real playback.'}
            </p>
          </div>
          <div className="space-y-2 pt-2">
            <p className="text-xs font-medium text-white">Providers</p>
            <div className="overflow-hidden rounded-lg border border-white/10">
              {orderedCaps.map((c, idx) => {
                const enabled = isEnabled(c.id)
                const h = health?.[c.id]
                const isAvailable = h === 'available'
                const dotColor = h ? (isAvailable ? 'bg-emerald-400' : 'bg-white/20') : 'bg-white/10'
                const label = h ? (isAvailable ? 'Available' : 'Unavailable') : '…'
                return (
                  <div key={c.id} className={`flex items-center justify-between gap-3 px-3 py-2.5 ${idx !== orderedCaps.length-1 ? 'border-b border-white/5' : ''} ${enabled ? 'bg-white/[0.02]' : 'bg-black/20 opacity-60'}`}>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`h-2 w-2 rounded-full shrink-0 ${dotColor}`} aria-hidden />
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-white truncate">{c.displayName}</p>
                        <p className="text-[10px] text-white/40">{c.languages.join('/')} {c.embed ? '• embed' : ''} {c.directVideo ? '• video' : ''} • <span className={isAvailable ? 'text-emerald-300' : 'text-white/30'}>{label}</span>{h === 'unavailable' && <span className="text-white/20"> — Requires backend</span>}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button onClick={()=>moveProvider(c.id,-1)} disabled={idx===0} className="h-6 w-6 grid place-items-center rounded text-white/40 hover:text-white disabled:opacity-20" aria-label={`Move ${c.displayName} up`}>↑</button>
                      <button onClick={()=>moveProvider(c.id,1)} disabled={idx===orderedCaps.length-1} className="h-6 w-6 grid place-items-center rounded text-white/40 hover:text-white disabled:opacity-20" aria-label={`Move ${c.displayName} down`}>↓</button>
                      <label className="flex items-center gap-1.5 text-xs text-white/60">
                        <input type="checkbox" checked={enabled} onChange={e=>toggleProvider(c.id, e.target.checked)} className="h-3.5 w-3.5 rounded border-white/20 bg-white/10" aria-label={`Enable ${c.displayName}`} />
                        <span className="hidden sm:inline">Enable</span>
                      </label>
                    </div>
                  </div>
                )
              })}
            </div>
            <p className="text-[11px] text-white/30">Disable providers you don’t want to try. Reorder with ↑/↓ — preferred source still tried first.</p>
          </div>
          <div className="space-y-2 pt-4 border-t border-white/10">
            <p className="text-xs font-medium text-white">Custom video endpoint (optional)</p>
            <p className="text-[11px] text-white/50">Self-hosted full-episode backend. Must implement <code className="rounded bg-white/10 px-1 py-0.5">GET /health</code> <code className="rounded bg-white/10 px-1 py-0.5">/episodes/:id</code> <code className="rounded bg-white/10 px-1 py-0.5">/sources/:id?language=</code> and return normalized <code className="rounded bg-white/10 px-1 py-0.5">VideoSource</code> JSON. Leave empty to use build <code className="rounded bg-white/10 px-1 py-0.5">VITE_VIDEO_API_URL</code>.</p>
            <div className="flex gap-2">
              <input
                type="url"
                value={prefs.customVideoApiUrl ?? ''}
                onChange={e => updatePref({ customVideoApiUrl: e.target.value.trim() ? e.target.value.trim() : null })}
                placeholder="https://your-worker.workers.dev"
                aria-label="Custom video endpoint"
                className="flex-1 rounded-full border border-white/10 bg-white/[0.06] px-3 py-2 text-xs text-white placeholder:text-white/40 focus:border-white/20 focus:outline-none"
              />
              <button
                onClick={async () => {
                  const url = prefs.customVideoApiUrl?.trim().replace(/\/$/, '')
                  if (!url) return
                  try {
                    const res = await fetch(`${url}/health`, { method: 'GET' })
                    alert(res.ok ? `✓ Available — ${url}` : `✗ ${res.status} ${res.statusText}`)
                  } catch (e) {
                    alert(`✗ ${String(e).slice(0,120)}`)
                  }
                }}
                disabled={!prefs.customVideoApiUrl}
                className="rounded-full bg-white/10 px-4 py-2 text-xs font-medium text-white hover:bg-white/15 disabled:opacity-30"
              >
                Test
              </button>
            </div>
            <p className="text-[11px] text-white/30">Example: <code className="rounded bg-white/10 px-1 py-0.5">https://aeri-video.your-subdomain.workers.dev</code> — see <code className="rounded bg-white/10 px-1 py-0.5">worker/README.md</code> for self-hosting. No secrets are stored here; the URL is public and fetched from your browser.</p>
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
