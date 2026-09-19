import { useState, useEffect } from 'react'
import { AnimeCard } from '../components/cards/AnimeCard'
import { DetailModal } from '../components/detail/DetailModal'
import type { Anime, AnimeListEntry, AnimeStatus } from '../types/anime'
import { Link, useLocation, Navigate } from 'react-router-dom'
import { useTracking } from '../contexts/TrackingContext'
import { RowSkeleton } from '../components/ui/Skeleton'
import { useAniList } from '../contexts/AniListContext'
import { useMAL } from '../contexts/MALContext'

const tabs: { id: AnimeStatus | 'all'; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'watching', label: 'Watching' },
  { id: 'planned', label: 'Plan to Watch' },
  { id: 'completed', label: 'Completed' },
  { id: 'on_hold', label: 'On Hold' },
]

export function MyList() {
  const [tab, setTab] = useState<AnimeStatus | 'all'>('all')
  const [selected, setSelected] = useState<Anime | null>(null)
  const { isAuthenticated, trackingProvider, combinedList, loading, error, authExpired } = useTracking()
  const location = useLocation()
  useEffect(() => { setSelected(null) }, [location.pathname, location.hash, location.search])
  const ani = useAniList()
  const mal = useMAL()

  // Production: real list only when authenticated; unauth shows empty with CTA (no fake anime).
  // Most recently active first (entries without activity timestamps keep provider order at the end).
  const byRecent = (a: AnimeListEntry, b: AnimeListEntry) => (b.updatedAt ?? -1) - (a.updatedAt ?? -1)
  const sourceList: Anime[] = isAuthenticated && combinedList
    ? [...combinedList].sort(byRecent).map((e) => e.anime)
    : []
  const filtered: Anime[] = (() => {
    if (!isAuthenticated || !combinedList) return []
    const entries = tab === 'all' ? [...combinedList].sort(byRecent) : [...combinedList].filter((e) => e.status === tab).sort(byRecent)
    return entries.map((e) => e.anime)
  })()
  const listCount = sourceList.length

  const trackerName = trackingProvider === 'anilist' ? 'AniList' : trackingProvider === 'mal' ? 'MyAnimeList' : null
  if (!isAuthenticated) {
    return <Navigate to="/" replace />
  }
  const syncLabel = trackerName
    ? `tracked with ${trackerName}`
    : 'sign in to sync'

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-12">
      <h1 className="text-[18px] font-semibold tracking-tight text-[var(--text)]">My List</h1>
      <p className="text-xs text-[var(--text-faint)]">{listCount} titles • {syncLabel}</p>
      {(isAuthenticated && combinedList) && (
        <p className="mt-1 text-[11px] text-[color-mix(in_srgb,var(--text)_30%,transparent)]">Tracking with {trackerName} • {combinedList.length} titles • metadata by AniList</p>
      )}

      {!isAuthenticated && (
        <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--text)]/[0.02] px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-xs text-[var(--text-muted)]">Sign in with AniList to sync your list and track progress.</p>
          <Link to="/settings" className="whitespace-nowrap rounded-full bg-[var(--text)] px-4 py-1.5 text-xs font-semibold text-[var(--on-text)] hover:bg-[color-mix(in_srgb,var(--text)_90%,transparent)]">
            Go to Settings
          </Link>
        </div>
      )}

      {isAuthenticated && trackingProvider && (
        <div className="mt-4 flex items-center gap-2 text-xs">
          <span className="text-[var(--text-faint)]">Connected:</span>
          {trackingProvider === 'anilist' && ani.user && <span className="rounded-full bg-[color-mix(in_srgb,var(--text)_10%,transparent)] px-2.5 py-1 text-[var(--text-muted)]">{ani.user.name} • AniList</span>}
          {trackingProvider === 'mal' && mal.user && <span className="rounded-full bg-[color-mix(in_srgb,var(--text)_10%,transparent)] px-2.5 py-1 text-[var(--text-muted)]">{mal.user.name} • MAL</span>}
          <Link to="/settings" className="ml-auto text-xs text-[var(--text-faint)] underline hover:text-[var(--text)]">Manage in Settings</Link>
        </div>
      )}

      {isAuthenticated && loading && (
        <div className="mt-6">
          <RowSkeleton title="Loading your list" />
        </div>
      )}
      {isAuthenticated && !loading && (error || authExpired) && (
        <div className="mt-6 rounded-lg border border-[var(--border)] bg-[var(--text)]/[0.03] px-4 py-6 text-center">
          <p className="text-sm text-[var(--text)]">{error || 'Session expired'}</p>
          {authExpired ? (
            <p className="mt-1 text-xs text-[var(--text-faint)]">A session expired. Reconnect above.</p>
          ) : (
            <div className="mt-3 flex justify-center gap-2">
              <button onClick={() => ani.refresh().catch(()=>{})} className="rounded-full bg-[color-mix(in_srgb,var(--text)_10%,transparent)] px-4 py-1.5 text-xs font-medium text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--text)_15%,transparent)]">
                Retry AniList
              </button>
              <button onClick={() => mal.refresh().catch(()=>{})} className="rounded-full bg-[color-mix(in_srgb,var(--text)_10%,transparent)] px-4 py-1.5 text-xs font-medium text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--text)_15%,transparent)]">
                Retry MAL
              </button>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex gap-2 overflow-x-auto no-scrollbar">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
              tab === t.id ? 'bg-[var(--text)] text-[var(--on-text)]' : 'bg-[color-mix(in_srgb,var(--text)_10%,transparent)] text-[var(--text-muted)] hover:bg-[color-mix(in_srgb,var(--text)_15%,transparent)] hover:text-[var(--text)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {!isAuthenticated ? (
        <div className="mt-8 rounded-lg border border-[var(--border)] bg-[var(--text)]/[0.02] px-6 py-10 text-center">
          <p className="text-sm font-medium text-[var(--text)]">Your list is empty</p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-[var(--text-faint)]">
            Sign in with AniList above to see your anime list, track progress, and keep Continue Watching in sync. Your data stays in your browser and AniList.
          </p>
        </div>
      ) : !loading ? (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {filtered.map((a) => (
              <div key={a.identity.internalId} className="min-w-0">
                <AnimeCard anime={a} variant={a.progress ? 'continue' : 'default'} onSelect={setSelected} fullWidth />
              </div>
            ))}
          </div>
          {filtered.length === 0 && !loading && !error && (
            <div className="mt-8 rounded-lg border border-[var(--border)] bg-[var(--text)]/[0.02] px-6 py-10 text-center">
              <p className="text-sm text-[var(--text-faint)]">Nothing here yet.</p>
              <p className="mt-1 text-xs text-[var(--text-faint)]">Add titles from Anime or Search, or update status in the detail view.</p>
            </div>
          )}
        </>
      ) : null}

      {selected && <DetailModal key={selected.identity.internalId} anime={selected} onClose={() => setSelected(null)} onSelectRelated={setSelected} />}
    </div>
  )
}
