import { useState } from 'react'
import { AnimeCard } from '../components/cards/AnimeCard'
import { DetailModal } from '../components/detail/DetailModal'
import { mockAnime } from '../data/mockAnime'
import type { Anime, AnimeStatus } from '../types/anime'
import { useAniList } from '../contexts/AniListContext'
import { AniListConnectCompact } from '../components/anilist/AniListConnect'
import { RowSkeleton } from '../components/ui/Skeleton'

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
  const { isAuthenticated, animeList, loadingList, error, authExpired, refresh } = useAniList()

  // Use AniList list when authenticated, otherwise fallback to mock demo data
  const sourceList: Anime[] = isAuthenticated && animeList ? animeList.map((e) => e.anime) : mockAnime.filter((a) => a.inList)
  // For status filtering when using AniList, map through entries to preserve status
  const filtered: Anime[] = (() => {
    if (!isAuthenticated || !animeList) {
      return tab === 'all' ? sourceList : sourceList.filter((a) => a.listStatus === tab)
    }
    const entries = tab === 'all' ? animeList : animeList.filter((e) => e.status === tab)
    return entries.map((e) => e.anime)
  })()
  const listCount = sourceList.length

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-12">
      <h1 className="text-[18px] font-semibold tracking-tight text-white">My List</h1>
      <p className="text-xs text-white/50">{listCount} titles • {isAuthenticated ? 'synced with AniList' : 'demo data — connect AniList to sync'}</p>

      <div className="mt-4">
        <AniListConnectCompact />
      </div>

      {isAuthenticated && loadingList && (
        <div className="mt-6">
          <RowSkeleton title="Loading your AniList" />
        </div>
      )}
      {isAuthenticated && !loadingList && error && (
        <div className="mt-6 rounded-lg border border-white/10 bg-white/[0.03] px-4 py-6 text-center">
          <p className="text-sm text-white/80">{error}</p>
          {authExpired ? (
            <p className="mt-1 text-xs text-white/50">Your AniList session expired. Use the Connect button above.</p>
          ) : (
            <button onClick={refresh} className="mt-3 rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black hover:bg-white/90">
              Retry
            </button>
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

      {!isAuthenticated || !loadingList ? (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {filtered.map((a) => (
              <AnimeCard key={a.identity.internalId} anime={a} variant={a.progress ? 'continue' : 'default'} onSelect={setSelected} />
            ))}
          </div>
          {filtered.length === 0 && !loadingList && !error && (
            <p className="mt-12 text-center text-sm text-white/50">Nothing here yet.</p>
          )}
        </>
      ) : null}

      {selected && <DetailModal anime={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
