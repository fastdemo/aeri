import { useState, useEffect } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { getPreferences, setPreferences, type Preferences } from '../storage/preferences'
import { useAniList } from '../contexts/AniListContext'
import { useMAL } from '../contexts/MALContext'
import { useTracking } from '../contexts/TrackingContext'
import { clearAnilistMemoryCache, getAnilistStats } from '../services/anilist/client'
import { clearMalMemoryCache } from '../services/mal/client'
import { getProviderCapabilities, checkProviderHealth } from '../providers/video/registry'
import { THEMES, applyTheme } from '../lib/themes'

// Counters only — no tokens, no user data. Refreshes while visible.
function AnilistDiagnostics() {
  const [s, setS] = useState(() => ({ ...getAnilistStats(), now: Date.now() }))
  useEffect(() => {
    const t = setInterval(() => setS({ ...getAnilistStats(), now: Date.now() }), 2000)
    return () => clearInterval(t)
  }, [])
  const cooling = s.cooldownUntil > s.now
  return (
    <p className="mt-2 text-[11px] text-[color-mix(in_srgb,var(--text)_30%,transparent)]">
      AniList requests: {s.requests} • cache {s.memoryHits + s.idbHits} • shared {s.dedupHits} • throttled {s.status429}
      {cooling ? ` • cooling down` : ''}{s.lastRemaining !== null ? ` • remaining ${s.lastRemaining}` : ''}
    </p>
  )
}

export function Settings() {
  const [prefs, setPrefs] = useState<Preferences>(() => getPreferences())
  const ani = useAniList()
  const mal = useMAL()
  const { trackingProvider, setTrackingProvider } = useTracking()
  const [clearing, setClearing] = useState<string | null>(null)

  const updatePref = (patch: Partial<Preferences>) => {
    const next = setPreferences(patch)
    setPrefs(next)
  }

  const ALL_SYNC_ON = { anilist: { status: true, progress: true, rating: true }, mal: { status: true, progress: true, rating: true } } as const
  const setSync = (provider: 'anilist' | 'mal', field: 'status' | 'progress' | 'rating', value: boolean) => {
    const cur = prefs.sync ?? ALL_SYNC_ON
    updatePref({ sync: { ...cur, [provider]: { ...cur[provider], [field]: value } } })
  }
  const syncOn = (provider: 'anilist' | 'mal', field: 'status' | 'progress' | 'rating') =>
    prefs.sync?.[provider]?.[field] !== false

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
  if (!isAuthenticated) {
    return <Navigate to="/" replace />
  }

  return (
    <div className="mx-auto max-w-[900px] px-4 py-6 sm:px-6 lg:px-12">
      <h1 className="text-[18px] font-semibold tracking-tight text-[var(--text)]">Settings</h1>
      <p className="text-xs text-[var(--text-faint)]">Accounts, playback, and your data.</p>
      {!isAuthenticated && (
        <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--text)]/[0.02] px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-xs text-[var(--text-muted)]">Sign in with AniList or connect MyAnimeList to sync your list and enable tracking. Playback preferences work without an account.</p>
        </div>
      )}

      {/* Account / Connections */}
      <section className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--text)]/[0.02] p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-[var(--text)]">Account & Connections</h2>
        <p className="mt-1 text-xs text-[var(--text-faint)]">Connect either or both. Select one to track your list.</p>

        <div className="mt-4 space-y-3">
          <div className={`rounded-lg border bg-[var(--text)]/[0.02] p-3 ${trackingProvider === 'anilist' ? 'border-[var(--border-strong)]' : 'border-[var(--border)]'}`}>
            <div className="flex items-center gap-3">
              {ani.isAuthenticated && (
                <button
                  role="radio"
                  aria-checked={trackingProvider === 'anilist'}
                  aria-label="Track with AniList"
                  title="Track with AniList"
                  onClick={() => setTrackingProvider('anilist')}
                  className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${trackingProvider === 'anilist' ? 'border-[var(--border-strong)]' : 'border-[var(--border-strong)] hover:border-[var(--border-strong)]'}`}
                >
                  {trackingProvider === 'anilist' && <span className="h-2 w-2 rounded-full bg-[var(--text)]" />}
                </button>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-[var(--text)]">AniList</p>
                <p className="text-[11px] text-[var(--text-faint)]">
                  {ani.isAuthenticated && ani.user ? `Connected as ${ani.user.name}` : 'Not connected'}
                </p>
              </div>
              {ani.isAuthenticated ? (
                <button onClick={() => ani.logout()} className="rounded-full bg-[color-mix(in_srgb,var(--text)_10%,transparent)] px-3 py-1.5 text-xs font-medium text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--text)_15%,transparent)]">Disconnect</button>
              ) : (
                <button onClick={() => ani.login()} className="rounded-full bg-[var(--text)] px-4 py-1.5 text-xs font-semibold text-[var(--on-text)] hover:bg-[color-mix(in_srgb,var(--text)_90%,transparent)]">Connect</button>
              )}
            </div>
            {ani.isAuthenticated && ani.user?.avatar?.large && (
              <div className="mt-3 flex items-center gap-2">
                <img src={ani.user.avatar.large} alt="" className="h-7 w-7 rounded-full bg-[color-mix(in_srgb,var(--text)_10%,transparent)]" loading="lazy" />
                <span className="text-xs text-[var(--text-muted)]">{ani.user.name}</span>
                {ani.authExpired && <span className="text-xs text-[var(--warn)]">• Session expired</span>}
              </div>
            )}
            {ani.isAuthenticated && (
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--border)] pt-3">
                <span className="text-[11px] text-[var(--text-faint)]">Sync to AniList:</span>
                {([
                  ['status', 'Status'],
                  ['progress', 'Episodes watched'],
                  ['rating', 'Score'],
                ] as const).map(([field, label]) => (
                  <label key={field} className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--text-muted)]">
                    <input
                      type="checkbox"
                      checked={syncOn('anilist', field)}
                      onChange={e => setSync('anilist', field, e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-[var(--border-strong)] bg-[color-mix(in_srgb,var(--text)_10%,transparent)]"
                      aria-label={`Sync ${label} to AniList`}
                    />
                    {label}
                  </label>
                ))}
              </div>
            )}
            {ani.error && !ani.isAuthenticated && <p className="mt-2 text-xs text-[var(--warn)]">{ani.error}</p>}
          </div>

          <div className={`rounded-lg border bg-[var(--text)]/[0.02] p-3 ${trackingProvider === 'mal' ? 'border-[var(--border-strong)]' : 'border-[var(--border)]'}`}>
            <div className="flex items-center gap-3">
              {mal.isAuthenticated && (
                <button
                  role="radio"
                  aria-checked={trackingProvider === 'mal'}
                  aria-label="Track with MyAnimeList"
                  title="Track with MyAnimeList"
                  onClick={() => setTrackingProvider('mal')}
                  className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${trackingProvider === 'mal' ? 'border-[var(--border-strong)]' : 'border-[var(--border-strong)] hover:border-[var(--border-strong)]'}`}
                >
                  {trackingProvider === 'mal' && <span className="h-2 w-2 rounded-full bg-[var(--text)]" />}
                </button>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-[var(--text)]">MyAnimeList</p>
                <p className="text-[11px] text-[var(--text-faint)]">
                  {mal.isAuthenticated && mal.user ? `Connected as ${mal.user.name}` : 'Not connected'}
                </p>
              </div>
              {mal.isAuthenticated ? (
                <button onClick={() => mal.logout()} className="rounded-full bg-[color-mix(in_srgb,var(--text)_10%,transparent)] px-3 py-1.5 text-xs font-medium text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--text)_15%,transparent)]">Disconnect</button>
              ) : (
                <button onClick={() => mal.login().catch(()=>{})} className="rounded-full bg-[var(--text)] px-4 py-1.5 text-xs font-semibold text-[var(--on-text)] hover:bg-[color-mix(in_srgb,var(--text)_90%,transparent)]">Connect</button>
              )}
            </div>
            {mal.isAuthenticated && mal.user && (
              <div className="mt-3 flex items-center gap-2">
                {mal.user.avatar?.large ? (
                  <img src={mal.user.avatar.large} alt="" className="h-7 w-7 rounded-full bg-[color-mix(in_srgb,var(--text)_10%,transparent)] object-cover" loading="lazy" />
                ) : (
                  <div className="grid h-7 w-7 place-items-center rounded-full bg-[var(--accent)] text-[10px] font-bold text-[var(--text)]" aria-hidden>MAL</div>
                )}
                <span className="text-xs text-[var(--text-muted)]">{mal.user.name}</span>
                {mal.authExpired && <span className="text-xs text-[var(--warn)]">• Session expired</span>}
              </div>
            )}
            {mal.isAuthenticated && (
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--border)] pt-3">
                <span className="text-[11px] text-[var(--text-faint)]">Sync to MAL:</span>
                {([
                  ['status', 'Status'],
                  ['progress', 'Episodes watched'],
                  ['rating', 'Score'],
                ] as const).map(([field, label]) => (
                  <label key={field} className="flex cursor-pointer items-center gap-1.5 text-xs text-[var(--text-muted)]">
                    <input
                      type="checkbox"
                      checked={syncOn('mal', field)}
                      onChange={e => setSync('mal', field, e.target.checked)}
                      className="h-3.5 w-3.5 rounded border-[var(--border-strong)] bg-[color-mix(in_srgb,var(--text)_10%,transparent)]"
                      aria-label={`Sync ${label} to MyAnimeList`}
                    />
                    {label}
                  </label>
                ))}
              </div>
            )}
            {mal.error && <p className="mt-2 text-xs text-[var(--warn)]">{mal.error}</p>}
          </div>
        </div>
      </section>

      {/* Playback */}
      <section className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--text)]/[0.02] p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-[var(--text)]">Playback</h2>
        <div className="mt-4 space-y-4">
          <label className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-[var(--text)]">Autoplay next episode</p>
              <p className="text-[11px] text-[var(--text-faint)]">When a video ends, automatically go to the next episode (if available).</p>
            </div>
            <input
              type="checkbox"
              checked={prefs.autoplay}
              onChange={e => updatePref({ autoplay: e.target.checked })}
              className="h-4 w-4 rounded border-[var(--border-strong)] bg-[color-mix(in_srgb,var(--text)_10%,transparent)] text-[var(--text)] focus:ring-[var(--border-strong)]"
              aria-label="Autoplay next episode"
            />
          </label>

          <label className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-[var(--text)]">Subtitles</p>
              <p className="text-[11px] text-[var(--text-faint)]">Show subtitles by default when the provider supplies them.</p>
            </div>
            <input
              type="checkbox"
              checked={prefs.subtitles}
              onChange={e => updatePref({ subtitles: e.target.checked })}
              className="h-4 w-4 rounded border-[var(--border-strong)] bg-[color-mix(in_srgb,var(--text)_10%,transparent)] text-[var(--text)] focus:ring-[var(--border-strong)]"
              aria-label="Subtitles on"
            />
          </label>

          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-[var(--text)]">Volume</p>
              <p className="text-[11px] text-[var(--text-faint)]">Default volume for videos.</p>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.1}
              value={prefs.volume}
              onChange={e => updatePref({ volume: Number(e.target.value) })}
              aria-label="Default volume"
              className="w-24 accent-[var(--accent)]"
            />
          </div>
        </div>
      </section>

      {/* Video Sources */}
      <section className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--text)]/[0.02] p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-[var(--text)]">Playback Sources</h2>
        <p className="mt-1 text-xs text-[var(--text-faint)]">Choose how Aeri picks video sources.</p>
        <div className="mt-4 space-y-4">
          <div>
            <p className="text-xs font-medium text-[var(--text)]">Preferred audio</p>
            <p className="text-[11px] text-[var(--text-faint)]">Sub: Japanese with subtitles. Dub: English where available. Falls back if missing.</p>
            <div className="mt-2 inline-flex rounded-full border border-[var(--border)] bg-[var(--bg-soft)] p-1" role="radiogroup" aria-label="Preferred audio">
              {(['sub','dub'] as const).map(lang => (
                <button
                  key={lang}
                  role="radio"
                  aria-checked={prefs.preferredAudio === lang}
                  onClick={() => updatePref({ preferredAudio: lang })}
                  className={`rounded-full px-4 py-1 text-xs font-medium ${prefs.preferredAudio === lang ? 'bg-[var(--text)] text-[var(--on-text)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}
                >
                  {lang === 'sub' ? 'Sub' : 'Dub'}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-[var(--text)]">Preferred source</p>
            <p className="text-[11px] text-[var(--text-faint)]">Auto tries your choice first, then others.</p>
            <select
              value={prefs.preferredProvider ?? ''}
              onChange={e => updatePref({ preferredProvider: e.target.value || null })}
              aria-label="Preferred source"
              className="mt-2 w-full max-w-[260px] rounded-full border border-[var(--border)] bg-[var(--text)]/[0.06] px-3 py-2 text-xs text-[var(--text)] focus:border-[var(--border-strong)] focus:outline-none"
            >
              <option value="" className="bg-[var(--surface)]">Auto (Recommended)</option>
              {orderedCaps.filter(c=>isEnabled(c.id)).map(c => (
                <option key={c.id} value={c.id} className="bg-[var(--surface)]">{c.displayName}</option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-[color-mix(in_srgb,var(--text)_30%,transparent)]">
              {prefs.preferredProvider ? `Trying ${prefs.preferredProvider} first, then fallback.` : 'Auto picks the best available source.'}
            </p>
          </div>
          <div className="space-y-2 pt-2">
            <p className="text-xs font-medium text-[var(--text)]">Providers</p>
            <div className="overflow-hidden rounded-lg border border-[var(--border)]">
              {orderedCaps.map((c, idx) => {
                const enabled = isEnabled(c.id)
                const h = health?.[c.id]
                const isAvailable = h === 'available'
                const dotColor = h ? (isAvailable ? 'bg-[var(--ok)]' : 'bg-[color-mix(in_srgb,var(--text)_20%,transparent)]') : 'bg-[color-mix(in_srgb,var(--text)_10%,transparent)]'
                const label = h ? (isAvailable ? 'Available' : 'Unavailable') : '…'
                return (
                  <div key={c.id} className={`flex items-center justify-between gap-3 px-3 py-2.5 ${idx !== orderedCaps.length-1 ? 'border-b border-[var(--border)]' : ''} ${enabled ? 'bg-[var(--text)]/[0.02]' : 'bg-[color-mix(in_srgb,var(--bg)_20%,transparent)] opacity-60'}`}>
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`h-2 w-2 rounded-full shrink-0 ${dotColor}`} aria-hidden />
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-[var(--text)] truncate">{c.displayName}</p>
                        <p className="text-[10px] text-[var(--text-faint)]">{c.languages.join('/')} {c.embed ? '• embed' : ''} {c.directVideo ? '• video' : ''} • <span className={isAvailable ? 'text-[var(--ok)]' : 'text-[color-mix(in_srgb,var(--text)_30%,transparent)]'}>{label}</span>{h === 'unavailable' && <span className="text-[color-mix(in_srgb,var(--text)_20%,transparent)]"> — Requires backend</span>}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button onClick={()=>moveProvider(c.id,-1)} disabled={idx===0} className="h-6 w-6 grid place-items-center rounded text-[var(--text-faint)] hover:text-[var(--text)] disabled:opacity-20" aria-label={`Move ${c.displayName} up`}>↑</button>
                      <button onClick={()=>moveProvider(c.id,1)} disabled={idx===orderedCaps.length-1} className="h-6 w-6 grid place-items-center rounded text-[var(--text-faint)] hover:text-[var(--text)] disabled:opacity-20" aria-label={`Move ${c.displayName} down`}>↓</button>
                      <label className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                        <input type="checkbox" checked={enabled} onChange={e=>toggleProvider(c.id, e.target.checked)} className="h-3.5 w-3.5 rounded border-[var(--border-strong)] bg-[color-mix(in_srgb,var(--text)_10%,transparent)]" aria-label={`Enable ${c.displayName}`} />
                        <span className="hidden sm:inline">Enable</span>
                      </label>
                    </div>
                  </div>
                )
              })}
            </div>
            <p className="text-[11px] text-[color-mix(in_srgb,var(--text)_30%,transparent)]">Disable providers you don’t want to try. Reorder with ↑/↓ — preferred source still tried first.</p>
          </div>
          <div className="space-y-2 pt-4 border-t border-[var(--border)]">
            <p className="text-xs font-medium text-[var(--text)]">Custom video server (optional)</p>
            <p className="text-[11px] text-[var(--text-faint)]">Optional server for full episodes. Leave empty to use the built-in server.</p>
            <div className="flex gap-2">
              <input
                type="url"
                value={prefs.customVideoApiUrl ?? ''}
                onChange={e => updatePref({ customVideoApiUrl: e.target.value.trim() ? e.target.value.trim() : null })}
                placeholder="https://your-worker.workers.dev"
                aria-label="Custom video endpoint"
                className="flex-1 rounded-full border border-[var(--border)] bg-[var(--text)]/[0.06] px-3 py-2 text-xs text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[var(--border-strong)] focus:outline-none"
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
                className="rounded-full bg-[color-mix(in_srgb,var(--text)_10%,transparent)] px-4 py-2 text-xs font-medium text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--text)_15%,transparent)] disabled:opacity-30"
              >
                Test
              </button>
            </div>
            <p className="text-[11px] text-[color-mix(in_srgb,var(--text)_30%,transparent)]">Your address stays in this browser. Nothing secret is stored here.</p>
          </div>
        </div>
      </section>

      {/* Appearance */}
      <section className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--text)]/[0.02] p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-[var(--text)]">Appearance</h2>
        <div className="mt-3">
          <p className="text-xs font-medium text-[var(--text)]">Color theme</p>
          <p className="text-[11px] text-[var(--text-faint)]">Applies instantly across the whole site.</p>
          <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3" role="radiogroup" aria-label="Color theme">
            {THEMES.map(t => {
              const active = (prefs.theme || 'aeri-dark') === t.id
              return (
                <button
                  key={t.id}
                  role="radio"
                  aria-checked={active}
                  onClick={() => { applyTheme(t.id); updatePref({ theme: t.id }) }}
                  className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left ${active ? 'border-[var(--border-strong)] bg-[color-mix(in_srgb,var(--text)_10%,transparent)]' : 'border-[var(--border)] bg-[var(--text)]/[0.03] hover:bg-[var(--text)]/[0.07]'}`}
                >
                  <span className="flex shrink-0 overflow-hidden rounded-full" aria-hidden>
                    <span className="h-4 w-2" style={{ background: t.vars['--bg'] }} />
                    <span className="h-4 w-2" style={{ background: t.vars['--surface'] }} />
                    <span className="h-4 w-2" style={{ background: t.vars['--accent'] }} />
                  </span>
                  <span className="truncate text-xs text-[var(--text)]">{t.name}</span>
                </button>
              )
            })}
          </div>
        </div>
      </section>

      {/* Data / Cache */}
      <section className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--text)]/[0.02] p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-[var(--text)]">Data & Cache</h2>
        <p className="mt-1 text-xs text-[var(--text-faint)]">Your data stays in this browser. Clearing it never disconnects your accounts.</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <button
            onClick={handleClearCache}
            disabled={clearing === 'cache'}
            className="rounded-full bg-[color-mix(in_srgb,var(--text)_10%,transparent)] px-4 py-2 text-xs font-medium text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--text)_15%,transparent)] disabled:opacity-50"
          >
            {clearing === 'cache' ? 'Clearing…' : 'Clear cached data'}
          </button>
          <button
            onClick={handleClearWatchPos}
            disabled={clearing === 'watchPos'}
            className="rounded-full bg-[color-mix(in_srgb,var(--text)_10%,transparent)] px-4 py-2 text-xs font-medium text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--text)_15%,transparent)] disabled:opacity-50"
          >
            {clearing === 'watchPos' ? 'Clearing…' : 'Clear watch positions'}
          </button>
          <button
            onClick={handleResetAll}
            disabled={!!clearing}
            className="rounded-full bg-[var(--text)] px-4 py-2 text-xs font-semibold text-[var(--on-text)] hover:bg-[color-mix(in_srgb,var(--text)_90%,transparent)] disabled:opacity-50"
          >
            Reset local data
          </button>
        </div>
        <p className="mt-2 text-[11px] text-[color-mix(in_srgb,var(--text)_30%,transparent)]">Reset also restores default settings. Your accounts stay connected.</p>
        <AnilistDiagnostics />
      </section>

      {/* About */}
      <section className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--text)]/[0.02] p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-[var(--text)]">About</h2>
        <p className="mt-1 text-xs text-[var(--text-faint)]">Aeri is a quiet anime discovery, tracking, and watching app. No tracking, no ads — your data stays in this browser.</p>
        <div className="mt-3 space-y-2 text-xs leading-5">
          <p><span className="text-[var(--text-faint)]">Metadata:</span> <span className="text-[var(--text)]">AniList</span><span className="mx-2 text-[color-mix(in_srgb,var(--text)_20%,transparent)]">•</span><span className="text-[var(--text-faint)]">Tracking:</span> <span className="text-[var(--text)]">{trackingProvider === 'mal' ? 'MyAnimeList' : trackingProvider === 'anilist' ? 'AniList' : 'Not connected'}</span></p>
          <p><span className="text-[var(--text-faint)]">Video:</span> <span className="text-[var(--text)]">{prefs.preferredProvider ? prefs.preferredProvider : 'Auto'} {health ? (Object.values(health).includes('available') ? '' : '(checking…)') : ''}</span><span className="mx-2 text-[color-mix(in_srgb,var(--text)_20%,transparent)]">•</span><span className="text-[var(--text-faint)]">Storage:</span> <span className="text-[var(--text)]">This browser only</span></p>
          <p className="pt-2">
            <a href="https://github.com/fastdemo/aeri" className="underline hover:text-[var(--text)] text-[var(--text-faint)]">GitHub</a>
            <span className="mx-2 text-[color-mix(in_srgb,var(--text)_20%,transparent)]">•</span>
            <a href="https://aeri.fastdemo.workers.dev/api/health" className="underline hover:text-[var(--text)] text-[var(--text-faint)]">Service status</a>
            <span className="mx-2 text-[color-mix(in_srgb,var(--text)_20%,transparent)]">•</span>
            <Link to="/manga" className="underline hover:text-[var(--text)] text-[var(--text-faint)]">Manga (soon)</Link>
          </p>
        </div>
      </section>
    </div>
  )
}
