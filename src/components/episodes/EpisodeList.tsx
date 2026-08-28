import { Link } from 'react-router-dom'
import type { Anime } from '../../types/anime'

function mockEpisodes(anime: Anime, count = 10) {
  const n = Math.min(anime.episodes ?? count, count)
  return Array.from({ length: n }, (_, i) => ({
    number: i + 1,
    title:
      i === 0
        ? 'Let You Down'
        : i === 1
          ? 'Like A Boy'
          : i === 2
            ? 'What Happens Next'
            : `Episode ${i + 1}`,
    duration: anime.duration ?? 24,
  }))
}

export function EpisodeList({ anime }: { anime: Anime }) {
  const episodes = mockEpisodes(anime)
  const progressEp = anime.progress?.episode ?? 0

  return (
    <div className="space-y-1">
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded bg-white px-2 py-1 text-[11px] font-semibold text-black">S1</span>
        <span className="text-xs text-white/50">{anime.episodes ?? episodes.length} episodes</span>
      </div>

      <div className="overflow-hidden rounded-lg border border-white/10">
        {episodes.map((ep) => {
          const isWatched = ep.number < progressEp
          const isCurrent = ep.number === progressEp
          return (
            <Link
              key={ep.number}
              to={`/watch/${anime.identity.internalId}/${ep.number}`}
              className={`flex items-center gap-3 px-3 py-3 text-left transition ${
                isCurrent ? 'bg-white/[0.06]' : 'bg-[#18181b] hover:bg-white/[0.04]'
              } ${ep.number !== episodes.length ? 'border-b border-white/5' : ''}`}
            >
              <span className="w-6 text-center text-sm font-medium text-white/70">{String(ep.number).padStart(2, '0')}</span>

              <div className="relative h-12 w-20 shrink-0 overflow-hidden rounded bg-white/5">
                <img
                  src={`https://picsum.photos/seed/${anime.identity.internalId}-ep${ep.number}/160/90`}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
                {isWatched && (
                  <span className="absolute inset-0 grid place-items-center bg-black/40 text-white">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M5 13 9 17 19 7" />
                    </svg>
                  </span>
                )}
                {isCurrent && <span className="absolute bottom-0 left-0 h-0.5 w-full bg-[#e50914]" />}
              </div>

              <div className="min-w-0 flex-1">
                <p className={`truncate text-[13px] font-medium ${isCurrent ? 'text-white' : 'text-white/90'}`}>
                  {ep.title}
                </p>
                <p className="text-[11px] text-white/50">{ep.duration}m</p>
              </div>

              <span className="hidden text-xs text-white/40 sm:block">{isWatched ? 'Watched' : ''}</span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
