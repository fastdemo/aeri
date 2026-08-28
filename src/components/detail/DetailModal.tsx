import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import type { Anime } from '../../types/anime'
import { EpisodeList } from '../episodes/EpisodeList'

export function DetailModal({
  anime,
  onClose,
}: {
  anime: Anime
  onClose: () => void
}) {
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  // focus trap simple — focus close button
  useEffect(() => {
    dialogRef.current?.focus()
  }, [])

  const meta = `${anime.year ?? ''}  ${anime.episodes ? `${anime.episodes} Episodes` : ''}  HD`

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/75 p-2 backdrop-blur-[2px] sm:p-6 lg:p-8">
      {/* backdrop click */}
      <button
        aria-label="Close"
        onClick={onClose}
        className="fixed inset-0 cursor-default"
        tabIndex={-1}
      />

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={anime.title.english ?? anime.title.romaji}
        tabIndex={-1}
        className="relative my-2 flex max-h-none w-full max-w-[980px] flex-col overflow-hidden rounded-xl bg-[#0e0e10] shadow-[0_24px_64px_rgba(0,0,0,0.9)] outline-none sm:my-6"
      >
        {/* Close */}
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 z-20 grid h-8 w-8 place-items-center rounded-full bg-black/60 text-white backdrop-blur hover:bg-black/80"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>

        {/* Hero artwork */}
        <div className="relative h-[360px] w-full overflow-hidden sm:h-[420px]">
          <img src={anime.backdropImage} alt="" className="h-full w-full object-cover" loading="eager" />
          {/* bottom fade */}
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(0deg, #0e0e10 6%, rgba(14,14,16,0.85) 18%, rgba(14,14,16,0.35) 42%, transparent 68%)',
            }}
          />
          {/* Netflix red subtle top? */}
          <div className="absolute left-6 top-6 hidden sm:block">
            <p className="text-[11px] font-bold tracking-[0.24em] text-[#e50914]">AERI</p>
            {/* Title rendering — large but not image logo */}
            <h2 className="mt-3 max-w-[520px] text-[28px] font-semibold leading-none tracking-tighter text-white drop-shadow">
              {anime.title.english ?? anime.title.romaji}
            </h2>
            {anime.title.native && (
              <p className="mt-1 text-xs text-white/60">{anime.title.native}</p>
            )}
          </div>

          {/* Controls over artwork */}
          <div className="absolute bottom-0 left-0 right-0 flex flex-wrap items-center gap-2 px-4 pb-4 sm:px-6">
            {/* progress line */}
            {anime.progress && (
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/10">
                <div className="h-full bg-[#e50914]" style={{ width: `${anime.progress.percent}%` }} />
              </div>
            )}

            <Link
              to={`/watch/${anime.identity.internalId}/${anime.progress ? anime.progress.episode : 1}`}
              className="inline-flex h-8 items-center gap-1.5 rounded bg-white px-4 text-[13px] font-semibold text-black hover:bg-white/90"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5.14v13.72L19 12z" />
              </svg>
              {anime.progress ? 'Resume' : 'Play'}
            </Link>
            {anime.progress && (
              <span className="text-xs text-white/70">
                {anime.progress.episode} of {anime.episodes ?? '?'} • {anime.progress.percent}% watched
              </span>
            )}

            <div className="ml-auto flex items-center gap-2">
              <button
                aria-label="Add to My List"
                className="grid h-8 w-8 place-items-center rounded-full border border-white/20 bg-black/30 text-white backdrop-blur hover:bg-white/10"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
              <button
                aria-label="Rate"
                className="grid h-8 w-8 place-items-center rounded-full border border-white/20 bg-black/30 text-white backdrop-blur hover:bg-white/10"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M12 17 6 21l1.5-6.5L2 9l6.5-.6L12 2l3.5 6.4L22 9l-5.5 5.5L18 21z" />
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="grid gap-6 px-4 py-5 sm:px-6 lg:grid-cols-[1.7fr_0.9fr]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-[12px] text-white/70">
              <span>{meta}</span>
              <span className="rounded border border-white/15 px-1 py-0 text-[10px] font-semibold">T18</span>
              <span className="text-white/50">nudity, violence, language, sex</span>
            </div>

            <p className="mt-2 text-[12px] font-semibold text-white/90">
              S1:E{anime.progress?.episode ?? 1} “Let You Down” — Premiere
            </p>
            <p className="mt-1 line-clamp-3 text-[13px] leading-6 text-white/70">
              {anime.description} After a night of impossible choices, a rundown future collides with a fragile hope for a different life.
            </p>

            <h3 className="mt-6 text-[14px] font-semibold text-white">Episodes</h3>
            <div className="mt-3">
              <EpisodeList anime={anime} />
            </div>
          </div>

          <div className="space-y-3 border-t border-white/10 pt-4 lg:border-t-0 lg:pt-0">
            <div className="text-xs leading-5">
              <span className="text-white/50">Cast: </span>
              <span className="text-white/80">KENN, Aoi Yuki, Hiroki Touchi</span>
              <span className="text-white/50">, more</span>
            </div>
            <div className="text-xs leading-5">
              <span className="text-white/50">Genres: </span>
              <span className="text-white/80">{anime.genres.join(', ')}</span>
            </div>
            <div className="text-xs leading-5">
              <span className="text-white/50">Studios: </span>
              <span className="text-white/80">{(anime.studios ?? []).join(', ')}</span>
            </div>
            <div className="text-xs leading-5">
              <span className="text-white/50">This series is: </span>
              <span className="text-white/80">Explosive, Gritty, Emotional</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
