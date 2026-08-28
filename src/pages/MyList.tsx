import { useState } from 'react'
import { AnimeCard } from '../components/cards/AnimeCard'
import { DetailModal } from '../components/detail/DetailModal'
import { mockAnime } from '../data/mockAnime'
import type { Anime, AnimeStatus } from '../types/anime'

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

  const list = mockAnime.filter((a) => a.inList)
  const filtered = tab === 'all' ? list : list.filter((a) => a.listStatus === tab)

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-12">
      <h1 className="text-[18px] font-semibold tracking-tight text-white">My List</h1>
      <p className="text-xs text-white/50">{list.length} titles • synced with AniList / MAL when connected</p>

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

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {filtered.map((a) => (
          <AnimeCard key={a.identity.internalId} anime={a} variant={a.progress ? 'continue' : 'default'} onSelect={setSelected} />
        ))}
      </div>

      {filtered.length === 0 && <p className="mt-12 text-center text-sm text-white/50">Nothing here yet.</p>}

      {selected && <DetailModal anime={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
