import { Link, useParams } from 'react-router-dom'
import { mockAnime } from '../data/mockAnime'

export function Watch() {
  const { id, episode } = useParams<{ id: string; episode: string }>()
  const anime = mockAnime.find((a) => a.identity.internalId === id)
  const epNum = Number(episode ?? 1)

  if (!anime) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-12 text-center">
        <p className="text-white">Anime not found.</p>
        <Link to="/" className="mt-4 inline-block text-sm text-white/60 underline">
          Back to home
        </Link>
      </div>
    )
  }

  const prev = epNum > 1 ? epNum - 1 : null
  const next = anime.episodes && epNum < anime.episodes ? epNum + 1 : null

  return (
    <div className="min-h-screen bg-black">
      <div className="mx-auto max-w-[1280px] px-0 sm:px-4 lg:px-6">
        {/* Player */}
        <div className="relative aspect-video w-full overflow-hidden bg-[#0a0a0a] sm:rounded-lg">
          <img
            src={anime.backdropImage}
            alt=""
            className="h-full w-full object-cover opacity-80"
          />
          <div className="absolute inset-0 grid place-items-center">
            <div className="text-center">
              <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-white text-black">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5.14v13.72L19 12z" />
                </svg>
              </div>
              <p className="mt-3 text-sm font-medium text-white">Episode {epNum}</p>
              <p className="text-xs text-white/60">Authorised source playback • mock</p>
            </div>
          </div>

          {/* Top bar */}
          <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent px-4 py-3">
            <Link to={`/anime/${id}`} className="text-sm font-medium text-white hover:text-white/80">
              ← {anime.title.english ?? anime.title.romaji}
            </Link>
            <span className="text-xs text-white/60">E{String(epNum).padStart(2, '0')}</span>
          </div>

          {/* Bottom controls hint */}
          <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/60 to-transparent" />
        </div>

        {/* Meta */}
        <div className="px-4 py-5 sm:px-0">
          <h1 className="text-[15px] font-semibold text-white">
            {anime.title.english ?? anime.title.romaji} — Episode {epNum}
          </h1>
          <p className="mt-1 text-xs text-white/60">
            {anime.title.romaji} • {anime.year} • {anime.duration}m
          </p>

          <div className="mt-4 flex items-center gap-2">
            {prev ? (
              <Link
                to={`/watch/${id}/${prev}`}
                className="rounded-full border border-white/15 bg-white/10 px-4 py-1.5 text-xs font-medium text-white hover:bg-white/15"
              >
                ← Previous
              </Link>
            ) : (
              <span className="rounded-full border border-white/10 px-4 py-1.5 text-xs text-white/30">← Previous</span>
            )}

            <Link
              to={`/anime/${id}`}
              className="rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black hover:bg-white/90"
            >
              Episodes
            </Link>

            {next ? (
              <Link
                to={`/watch/${id}/${next}`}
                className="rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black hover:bg-white/90"
              >
                Next →
              </Link>
            ) : (
              <span className="rounded-full border border-white/10 px-4 py-1.5 text-xs text-white/30">Next →</span>
            )}
          </div>

          <p className="mt-6 max-w-[720px] text-sm leading-6 text-white/70">{anime.description}</p>
        </div>
      </div>
    </div>
  )
}
