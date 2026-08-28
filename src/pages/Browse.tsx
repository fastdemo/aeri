import { useState } from 'react'
import { AnimeCard } from '../components/cards/AnimeCard'
import { DetailModal } from '../components/detail/DetailModal'
import { mockAnime } from '../data/mockAnime'
import type { Anime } from '../types/anime'

const genres = ['All', 'Action', 'Adventure', 'Drama', 'Fantasy', 'Sci-Fi', 'Comedy', 'Slice of Life']

export function Browse() {
  const [selected, setSelected] = useState<Anime | null>(null)
  const [genre, setGenre] = useState('All')

  const filtered = genre === 'All' ? mockAnime : mockAnime.filter((a) => a.genres.includes(genre))

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-12">
      <div className="flex flex-wrap items-center gap-2 py-2">
        {genres.map((g) => (
          <button
            key={g}
            onClick={() => setGenre(g)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
              genre === g ? 'bg-white text-black' : 'bg-white/10 text-white/80 hover:bg-white/15 hover:text-white'
            }`}
          >
            {g}
          </button>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {filtered.map((a) => (
          <div key={a.identity.internalId} className="flex justify-center">
            <AnimeCard anime={a} onSelect={setSelected} />
          </div>
        ))}
      </div>

      {selected && <DetailModal anime={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
