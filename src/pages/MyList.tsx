import { useState, useEffect } from 'react'
import { AnimeCard } from '../components/cards/AnimeCard'
import { DetailModal } from '../components/detail/DetailModal'
import type { Anime, AnimeStatus } from '../types/anime'
import { Link, useLocation } from 'react-router-dom'
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
  const { isAuthenticated, isAniListAuthenticated, isMALAuthenticated, combinedList, loading, error, authExpired } = useTracking()
  const location = useLocation()
  useEffect(() => { setSelected(null) }, [location.pathname, location.hash, location.search])
  const ani = useAniList()
  const mal = useMAL()

  // Production: real list only when authenticated; unauth shows empty with CTA (no fake anime)
  const sourceList: Anime[] = isAuthenticated && combinedList ? combinedList.map((e) => e.anime) : []
  const filtered: Anime[] = (() => {
    if (!isAuthenticated || !combinedList) return []
    const entries = tab === 'all' ? combinedList : combinedList.filter((e) => e.status === tab)
    return entries.map((e) => e.anime)
  })()
  const listCount = sourceList.length

  const syncLabel = isAniListAuthenticated && isMALAuthenticated
    ? 'synced with AniList • MAL'
    : isAniListAuthenticated
      ? 'synced with AniList'
      : isMALAuthenticated
        ? 'synced with MyAnimeList'
        : 'connect AniList to sync'

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-12">
      <h1 className="text-[18px] font-semibold tracking-tight text-white">My List</h1>
      <p className="text-xs text-white/50">{listCount} titles • {syncLabel}</p>
      {(isAniListAuthenticated && isMALAuthenticated && combinedList) && (
        <p className="mt-1 text-[11px] text-white/30">Merged • deduped by MAL ID where available • {combinedList.length} unique titles</p>
      )}

      {!isAuthenticated && (
        <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.02] px-4 py-3 flex items-center justify-between gap-3">
          <p className="text-xs text-white/60">Connect AniList to sync your list and track progress.</p>
          <Link to="/settings" className="whitespace-nowrap rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black hover:bg-white/90">
            Go to Settings
          </Link>
        </div>
      )}

      {isAuthenticated && (isAniListAuthenticated || isMALAuthenticated) && (
        <div className="mt-4 flex items-center gap-2 text-xs">
          <span className="text-white/40">Connected:</span>
          {isAniListAuthenticated && ani.user && <span className="rounded-full bg-white/10 px-2.5 py-1 text-white/70">{ani.user.name} • AniList</span>}
          {isMALAuthenticated && mal.user && <span className="rounded-full bg-white/10 px-2.5 py-1 text-white/70">{mal.user.name} • MAL</span>}
          <Link to="/settings" className="ml-auto text-xs text-white/50 underline hover:text-white/80">Manage in Settings</Link>
        </div>
      )}

      {isAuthenticated && loading && (
        <div className="mt-6">
          <RowSkeleton title="Loading your list" />
        </div>
      )}
      {isAuthenticated && !loading && (error || authExpired) && (
        <div className="mt-6 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-6 text-center">
          <p className="text-sm text-white/80">{error || 'Session expired'}</p>
          {authExpired ? (
            <p className="mt-1 text-xs text-white/50">A session expired. Reconnect above.</p>
          ) : (
            <div className="mt-3 flex justify-center gap-2">
              <button onClick={() => ani.refresh().catch(()=>{})} className="rounded-full bg-white/10 px-4 py-1.5 text-xs font-medium text-white hover:bg-white/15">
                Retry AniList
              </button>
              <button onClick={() => mal.refresh().catch(()=>{})} className="rounded-full bg-white/10 px-4 py-1.5 text-xs font-medium text-white hover:bg-white/15">
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
              tab === t.id ? 'bg-white text-black' : 'bg-white/10 text-white/70 hover:bg-white/15 hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {!isAuthenticated ? (
        <div className="mt-8 rounded-lg border border-white/5 bg-white/[0.02] px-6 py-10 text-center">
          <p className="text-sm font-medium text-white">Your list is empty</p>
          <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-white/50">
            Connect AniList above to see your anime list, track progress, and keep Continue Watching in sync. Your data stays in your browser and AniList.
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
            <div className="mt-8 rounded-lg border border-white/5 bg-white/[0.02] px-6 py-10 text-center">
              <p className="text-sm text-white/50">Nothing here yet.</p>
              <p className="mt-1 text-xs text-white/40">Add titles from Browse or Search, or update status in the detail view.</p>
            </div>
          )}
        </>
      ) : null}

      {selected && <DetailModal anime={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
