import { useState, useEffect } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { getPreferences, setPreferences, type Preferences } from '../storage/preferences'
import { useAniList } from '../contexts/AniListContext'
import { useMAL } from '../contexts/MALContext'
import { useTracking } from '../contexts/TrackingContext'
import { clearAnilistMemoryCache, getAnilistStats } from '../services/anilist/client'
import { clearMalMemoryCache } from '../services/mal/client'
import { getProviderCapabilities, checkProviderHealth, verifiedVideoProviders } from '../providers/video/registry'
import { verifiedMangaProviders } from '../providers/manga/mangadex'
import { THEMES, applyTheme } from '../lib/themes'
import { Icon } from '../components/ui/Icon'
import { Switch, SwitchRow } from '../components/ui/Switch'
import { SortableList } from '../components/ui/SortableList'
import { pillSolid, pillSoft } from '../components/ui/buttonStyles'

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

  const updatePref = (patch: Partial<Preferences>) => {
    const next = setPreferences(patch)
    setPrefs(next)
    // Broadcast so live surfaces (chapter lists, reader selectors) re-read
    // prefs without reload. Storage event covers other tabs.
    try { window.dispatchEvent(new CustomEvent('aeri:prefs-changed')) } catch {}
  }

  const ALL_SYNC_ON = { anilist: { status: true, progress: true, rating: true }, mal: { status: true, progress: true, rating: true } } as const
  const setSync = (provider: 'anilist' | 'mal', field: 'status' | 'progress' | 'rating', value: boolean) => {
    const cur = prefs.sync ?? ALL_SYNC_ON
    updatePref({ sync: { ...cur, [provider]: { ...cur[provider], [field]: value } } })
  }
  const syncOn = (provider: 'anilist' | 'mal', field: 'status' | 'progress' | 'rating') =>
    prefs.sync?.[provider]?.[field] !== false

  const handleClearCache = async () => {
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
  }

  const handleClearWatchPos = async () => {
    try {
      const { clearAllWatchPos } = await import('../storage/db')
      await clearAllWatchPos()
    } catch {}
  }

  const handleResetAll = async () => {
    if (!confirm('Reset all local data? This will clear cache, watch positions, and preferences (accounts stay connected). Continue?')) return
    try {
      // Clear cache and watchPos as above
      await handleClearCache()
      await handleClearWatchPos()
      // Reset prefs to defaults. The theme is painted on <html> (dataset +
      // inline vars), so it must be re-applied explicitly — removing the
      // stored key alone would leave the old theme until the next reload.
      // The key is deleted first so stale/legacy fields cannot survive,
      // then clean defaults are re-persisted.
      localStorage.removeItem('aeri:prefs')
      const next = setPreferences({})
      setPrefs(next)
      applyTheme(next.theme)
      // Live surfaces (chapter lists, reader selectors) re-read prefs.
      try { window.dispatchEvent(new CustomEvent('aeri:prefs-changed')) } catch {}
    } catch {}
  }

// Video providers shown in Settings = verified ONLY (registry is the
  // single source of truth — no hardcoded list, no stubs, no dead entries).
  const videoCaps = getProviderCapabilities().filter(c => c.id !== 'mock')
  const verifiedVideoIds = new Set(verifiedVideoProviders().map(p => p.id))
  const shownVideoCaps = videoCaps.filter(c => verifiedVideoIds.has(c.id))
  const [health, setHealth] = useState<Record<string, 'available'|'unavailable'>|null>(null)
  useEffect(() => {
    const ctrl = new AbortController()
    checkProviderHealth(ctrl.signal).then(setHealth).catch(()=>{})
    return () => ctrl.abort()
  }, [])
  const isEnabled = (id: string) => prefs.enabledProviders?.[id] !== false
  const toggleProvider = (id: string, enabled: boolean) => {
    updatePref({ enabledProviders: { ...(prefs.enabledProviders ?? {}), [id]: enabled } })
  }
  // Manga providers shown in Settings = verified ONLY, derived from the
  // manga registry (never hardcoded). Toggle state persists in
  // prefs.enabledMangaProviders (independent from anime toggles); order
  // persists in prefs.mangaProviderOrder and drives actual resolution.
  const mangaProviders = verifiedMangaProviders()
  const orderedMangaProviders = (() => {
    const order = prefs.mangaProviderOrder
    // No saved order: the registry array IS the default priority
    // (WeebCentral → MangaHere → MangaPill → MangaDex, D144). Never sort by
    // a local id list — that is how MangaHere used to land first.
    if (!order) return mangaProviders
    const map = new Map(mangaProviders.map(p => [p.id, p] as const))
    const out: typeof mangaProviders = []
    for (const id of order) { const p = map.get(id); if (p) { out.push(p); map.delete(id) } }
    for (const p of map.values()) out.push(p)
    return out
  })()
  const isMangaEnabled = (id: string) => {
    const v = prefs.enabledMangaProviders?.[id]
    if (v !== undefined) return v !== false
    return mangaProviders.find(p => p.id === id)?.enabledByDefault !== false
  }
  const toggleMangaProvider = (id: string, enabled: boolean) => {
    updatePref({ enabledMangaProviders: { ...(prefs.enabledMangaProviders ?? {}), [id]: enabled } })
  }
  const reorderMangaProvider = (from: number, to: number) => {
    const next = orderedMangaProviders.map(p => p.id)
    const [moved] = next.splice(from, 1)
    if (!moved) return
    next.splice(to, 0, moved)
    updatePref({ mangaProviderOrder: next })
  }
  const reorderProvider = (from: number, to: number) => {
    const next = orderedCaps.map(c => c.id)
    const [moved] = next.splice(from, 1)
    if (!moved) return
    next.splice(to, 0, moved)
    updatePref({ providerOrder: next })
  }
  const orderedCaps = (() => {
    const order = prefs.providerOrder
    if (!order) return shownVideoCaps
    const map = new Map(shownVideoCaps.map(c=>[c.id,c] as const))
    const out: typeof videoCaps = []
    for (const id of order) { const c = map.get(id); if (c) { out.push(c); map.delete(id) } }
    for (const c of map.values()) out.push(c)
    return out
  })()

  // readerFit IS read by the reader (object-fit width/height). No UI yet —
  // keep the pref (functional), surface it under Manga below.
  const readerFit = prefs.readerFit ?? 'width'
  const isAuthenticated = ani.isAuthenticated || mal.isAuthenticated
  if (!isAuthenticated) {
    return <Navigate to="/" replace />
  }

  return (
    <div className="mx-auto max-w-[900px] px-4 py-6 sm:px-6 lg:px-12">
      <h1 className="text-[18px] font-semibold tracking-tight text-[var(--text)]">Settings</h1>
      <p className="text-xs text-[var(--text-faint)]">Accounts, playback, and your data.</p>

      {/* About — first: identity before configuration. */}
      <section className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--text)]/[0.02] p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-[var(--text)]">About</h2>
        <p className="mt-1 text-xs text-[var(--text-faint)]">Aeri is a quiet anime discovery, tracking, and watching app. No tracking, no ads — your data stays in this browser.</p>
        <div className="mt-3 space-y-2 text-xs leading-5">
          <p><span className="text-[var(--text-faint)]">Metadata:</span> <span className="text-[var(--text)]">AniList</span><span className="mx-2 text-[color-mix(in_srgb,var(--text)_20%,transparent)]">•</span><span className="text-[var(--text-faint)]">Tracking:</span> <span className="text-[var(--text)]">{trackingProvider === 'mal' ? 'MyAnimeList' : trackingProvider === 'anilist' ? 'AniList' : 'Not connected'}</span></p>
          <p><span className="text-[var(--text-faint)]">Video:</span> <span className="text-[var(--text)]">{orderedCaps.find(c => isEnabled(c.id))?.displayName ?? 'Auto'}</span><span className="mx-2 text-[color-mix(in_srgb,var(--text)_20%,transparent)]">•</span><span className="text-[var(--text-faint)]">Storage:</span> <span className="text-[var(--text)]">This browser only</span></p>
          <p className="pt-2">
            <a href="https://github.com/fastdemo/aeri" className="underline hover:text-[var(--text)] text-[var(--text-faint)]">GitHub</a>
            <span className="mx-2 text-[color-mix(in_srgb,var(--text)_20%,transparent)]">•</span>
            <a href="https://aeri.fastdemo.workers.dev/api/health" className="underline hover:text-[var(--text)] text-[var(--text-faint)]">Service status</a>
            <span className="mx-2 text-[color-mix(in_srgb,var(--text)_20%,transparent)]">•</span>
            <Link to="/manga" className="underline hover:text-[var(--text)] text-[var(--text-faint)]">Manga (soon)</Link>
          </p>
        </div>
      </section>

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
                <button onClick={() => ani.login()} className={pillSolid}>Connect</button>
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
                  <div key={field} className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                    <Switch
                      checked={syncOn('anilist', field)}
                      onChange={v => setSync('anilist', field, v)}
                      label={`Sync ${label} to AniList`}
                    />
                    {label}
                  </div>
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
                <button onClick={() => mal.login().catch(()=>{})} className={pillSolid}>Connect</button>
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
                  <div key={field} className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                    <Switch
                      checked={syncOn('mal', field)}
                      onChange={v => setSync('mal', field, v)}
                      label={`Sync ${label} to MyAnimeList`}
                    />
                    {label}
                  </div>
                ))}
              </div>
            )}
            {mal.error && <p className="mt-2 text-xs text-[var(--warn)]">{mal.error}</p>}
          </div>
        </div>
      </section>

      {/* Anime: playback behavior + video sources, one section. */}
      <section className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--text)]/[0.02] p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-[var(--text)]">Anime</h2>
        <p className="mt-1 text-xs text-[var(--text-faint)]">Playback behavior and how Aeri picks video sources.</p>
        <div className="mt-4 space-y-4">
          <SwitchRow
            checked={prefs.autoplay}
            onChange={v => updatePref({ autoplay: v })}
            label="Autoplay next episode"
            description="When a video ends, automatically go to the next episode (if available)."
            ariaLabel="Autoplay next episode"
          />

          <SwitchRow
            checked={prefs.subtitles}
            onChange={v => updatePref({ subtitles: v })}
            label="Subtitles"
            description="Show subtitles by default when the provider supplies them."
            ariaLabel="Subtitles on"
          />

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
              className="w-24 accent-[var(--text)]"
            />
          </div>
          <div>
            <p className="text-xs font-medium text-[var(--text)]">Preferred audio</p>
            <p className="text-[11px] text-[var(--text-faint)]">Sub: Japanese with subtitles. Dub: English where available. Falls back if missing.</p>
            {/* ORIGINAL segmented toggle — size only, never a different
                component. Track + inner pill; 1px border +
                4px track padding + 20px inner pill = the same 30px box as
                every other control. */}
            <div className="mt-2 inline-flex rounded-full border border-[var(--border)] bg-[var(--bg-soft)] p-1" role="radiogroup" aria-label="Preferred audio">
              {(['sub','dub'] as const).map(lang => (
                <button
                  key={lang}
                  role="radio"
                  aria-checked={prefs.preferredAudio === lang}
                  onClick={() => updatePref({ preferredAudio: lang })}
                  className={`rounded-full px-4 py-0.5 text-xs font-medium leading-4 ${prefs.preferredAudio === lang ? 'bg-[var(--text)] text-[var(--on-text)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}
                >
                  {lang === 'sub' ? 'Sub' : 'Dub'}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2 pt-2">
            <p className="text-xs font-medium text-[var(--text)]">Anime providers</p>
            <p className="text-[11px] text-[var(--text-faint)]">Only verified working providers are listed.</p>
            <SortableList
              items={orderedCaps}
              getId={c => c.id}
              getLabel={c => c.displayName}
              onReorder={reorderProvider}
              className="rounded-lg border border-[var(--border)]"
              renderRow={(c, idx, row) => {
                const enabled = isEnabled(c.id)
                const h = health?.[c.id]
                const isAvailable = h === 'available'
                const dotColor = h ? (isAvailable ? 'bg-[var(--ok)]' : 'bg-[color-mix(in_srgb,var(--text)_20%,transparent)]') : 'bg-[color-mix(in_srgb,var(--text)_10%,transparent)]'
                const label = h ? (isAvailable ? 'Available' : 'Unavailable') : '…'
                const isFirst = idx === 0
                const isLast = idx === orderedCaps.length - 1
                const radius = row.isDragging ? 'rounded-md' : `${isFirst ? 'rounded-t-lg' : ''} ${isLast ? 'rounded-b-lg' : ''}`
                return (
                  <div
                    key={c.id}
                    ref={row.rowRef}
                    style={row.rowStyle}
                    data-provider-row
                    className={`flex items-center justify-between gap-3 px-3 py-2.5 ${isLast ? '' : 'border-b border-[var(--border)]'} ${radius} ${row.isDragging ? 'bg-[var(--surface-elevated)] shadow-[0_16px_36px_var(--shadow)] ring-1 ring-[color-mix(in_srgb,var(--text)_24%,transparent)]' : enabled ? 'bg-[var(--text)]/[0.02]' : 'bg-[color-mix(in_srgb,var(--bg)_20%,transparent)]'} transition-colors duration-300 ease-out`}
                  >
                    <div className={`flex min-w-0 items-center gap-2 transition-opacity duration-300 ease-out ${enabled ? 'opacity-100' : 'opacity-50'}`}>
                      <button {...row.handleProps} className="-ml-1 grid h-7 w-6 shrink-0 cursor-grab touch-none place-items-center rounded text-[color-mix(in_srgb,var(--text)_35%,transparent)] hover:text-[var(--text)] active:cursor-grabbing focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-strong)]">
                        <Icon name="grip-vertical" size={14} />
                      </button>
                      <span className={`h-2 w-2 rounded-full shrink-0 ${dotColor}`} aria-hidden />
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-[var(--text)] truncate">{c.displayName}</p>
                        <p className="text-[10px] text-[var(--text-faint)]">{c.languages.join('/')} {c.embed ? '• embed' : ''} {c.directVideo ? '• video' : ''} • <span className={isAvailable ? 'text-[var(--ok)]' : 'text-[color-mix(in_srgb,var(--text)_30%,transparent)]'}>{label}</span>{h === 'unavailable' && <span className="text-[color-mix(in_srgb,var(--text)_20%,transparent)]"> — Requires backend</span>}</p>
                      </div>
                    </div>
                    <Switch checked={enabled} onChange={v => toggleProvider(c.id, v)} label={`Enable ${c.displayName}`} />
                  </div>
                )
              }}
            />
            <p className="text-[11px] text-[color-mix(in_srgb,var(--text)_30%,transparent)]">Disable providers you don’t want to try. Drag the grip to reorder — or focus it and press ↑/↓. Resolution follows this order.</p>
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

      {/* Manga */}
      <section className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--text)]/[0.02] p-4 sm:p-5">
        <h2 className="text-sm font-semibold text-[var(--text)]">Manga</h2>
        <p className="mt-1 text-xs text-[var(--text-faint)]">Chapter list and reader preferences. Order is toggled beside each Chapters heading (↑/↓).</p>
        <div className="mt-4 space-y-4">
          <div>
            <p className="text-xs font-medium text-[var(--text)]">Reader page fit</p>
            <p className="text-[11px] text-[var(--text-faint)]">Width fills the screen; height fits whole pages.</p>
            <div className="mt-2 inline-flex rounded-full border border-[var(--border)] bg-[var(--bg-soft)] p-1" role="radiogroup" aria-label="Reader page fit">
              {(['width','height'] as const).map(f => (
                <button
                  key={f}
                  role="radio"
                  aria-checked={readerFit === f}
                  onClick={() => updatePref({ readerFit: f })}
                  className={`rounded-full px-4 py-0.5 text-xs font-medium leading-4 ${readerFit === f ? 'bg-[var(--text)] text-[var(--on-text)]' : 'text-[var(--text-muted)] hover:text-[var(--text)]'}`}
                >
                  {f === 'width' ? 'Width' : 'Height'}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="space-y-2 pt-4">
          <p className="text-xs font-medium text-[var(--text)]">Manga providers</p>
          <p className="text-[11px] text-[var(--text-faint)]">Only verified working providers are listed. Disabled providers are never requested.</p>
          <SortableList
            items={orderedMangaProviders}
            getId={p => p.id}
            getLabel={p => p.name}
            onReorder={reorderMangaProvider}
            className="rounded-lg border border-[var(--border)]"
            renderRow={(p, idx, row) => {
              const enabled = isMangaEnabled(p.id)
              const isFirst = idx === 0
              const isLast = idx === orderedMangaProviders.length - 1
              const radius = row.isDragging ? 'rounded-md' : `${isFirst ? 'rounded-t-lg' : ''} ${isLast ? 'rounded-b-lg' : ''}`
              return (
                <div
                  key={p.id}
                  ref={row.rowRef}
                  style={row.rowStyle}
                  data-provider-row
                  className={`flex items-center justify-between gap-3 px-3 py-2.5 ${isLast ? '' : 'border-b border-[var(--border)]'} ${radius} ${row.isDragging ? 'bg-[var(--surface-elevated)] shadow-[0_16px_36px_var(--shadow)] ring-1 ring-[color-mix(in_srgb,var(--text)_24%,transparent)]' : enabled ? 'bg-[var(--text)]/[0.02]' : 'bg-[color-mix(in_srgb,var(--bg)_20%,transparent)]'} transition-colors duration-300 ease-out`}
                >
                  <div className={`flex min-w-0 items-center gap-2 transition-opacity duration-300 ease-out ${enabled ? 'opacity-100' : 'opacity-50'}`}>
                    <button {...row.handleProps} className="-ml-1 grid h-7 w-6 shrink-0 cursor-grab touch-none place-items-center rounded text-[color-mix(in_srgb,var(--text)_35%,transparent)] hover:text-[var(--text)] active:cursor-grabbing focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--border-strong)]">
                      <Icon name="grip-vertical" size={14} />
                    </button>
                    <div className="min-w-0">
                      <p className="text-xs font-medium text-[var(--text)] truncate">{p.name}</p>
                      <p className="text-[10px] text-[var(--text-faint)]">{p.blurb} • <span className="text-[var(--ok)]">Verified</span></p>
                    </div>
                  </div>
                  <Switch checked={enabled} onChange={v => toggleMangaProvider(p.id, v)} label={`Enable ${p.name}`} />
                </div>
              )
            }}
          />
          <p className="text-[11px] text-[color-mix(in_srgb,var(--text)_30%,transparent)]">Disable providers you don’t want to try. Drag the grip to reorder — or focus it and press ↑/↓. Resolution follows this order.</p>
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
            className={pillSoft}
          >
            Clear cached data
          </button>
          <button
            onClick={handleClearWatchPos}
            className={pillSoft}
          >
            Clear watch positions
          </button>
          <button
            onClick={handleResetAll}
            className={pillSolid}
          >
            Reset local data
          </button>
        </div>
        <p className="mt-2 text-[11px] text-[color-mix(in_srgb,var(--text)_30%,transparent)]">Reset also restores default settings. Your accounts stay connected.</p>
        <AnilistDiagnostics />
      </section>

    </div>
  )
}
