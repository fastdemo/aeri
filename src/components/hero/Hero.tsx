import { Link } from 'react-router-dom'
import type { Anime } from '../../types/anime'

export function Hero({ anime, onMoreInfo }: { anime: Anime; onMoreInfo?: () => void }) {
  const meta = [anime.format ?? 'TV', anime.year, anime.episodes ? `${anime.episodes} Episodes` : null, anime.rating ? `${anime.rating.toFixed(1)}` : null]
    .filter(Boolean)
    .join(' · ')

  return (
    <section className="relative overflow-hidden rounded-xl bg-[var(--surface)] sm:rounded-[14px]">
      {/* Backdrop image */}
      <div className="relative aspect-[16/9] w-full overflow-hidden sm:aspect-[21/9] lg:aspect-[2.2/1] lg:min-h-[460px] lg:max-h-[640px]">
        <img
          src={anime.backdropImage}
          alt=""
          className="h-full w-full object-cover"
          loading="eager"
          decoding="async"
          fetchPriority="high"
        />

        {/* Gradients — cinematic */}
        {/* left */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(90deg, rgba(7,7,8,0.96) 0%, rgba(7,7,8,0.78) 22%, rgba(7,7,8,0.45) 42%, rgba(7,7,8,0.14) 62%, transparent 78%)',
          }}
        />
        {/* bottom */}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(0deg, var(--bg) 0%, rgba(7,7,8,0.85) 8%, rgba(7,7,8,0.45) 22%, transparent 46%)',
          }}
        />
        {/* top subtle for nav */}
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/40 to-transparent"
        />

        {/* Content */}
        <div className="absolute inset-0 flex">
          <div className="flex w-full max-w-[560px] flex-col justify-end gap-3 px-5 pb-6 pt-16 sm:px-8 sm:pb-8 lg:justify-center lg:pb-0 lg:pl-12 lg:pr-0">
            {/* Title mimic — romaji/english */}
            <h1 className="text-[22px] font-semibold leading-[1.05] tracking-[-0.03em] text-white sm:text-[30px] lg:text-[34px]">
              {anime.title.english ?? anime.title.romaji}
            </h1>

            {anime.title.english && anime.title.romaji !== anime.title.english && (
              <p className=" -mt-1 text-[11px] tracking-wide text-white/60">{anime.title.romaji}</p>
            )}

            <p className="text-[12px] font-medium tracking-wide text-white/70">
              {meta}
              <span className="ml-2 inline-flex items-center gap-1 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-widest text-white/90">
                HD
              </span>
              <span className="ml-1 text-[11px] text-white/50">• T18</span>
            </p>

            <p className="line-clamp-2 max-w-[520px] text-[13px] leading-6 text-white/75 sm:line-clamp-3 sm:text-[14px]">
              {anime.description}
            </p>

            <div className="mt-1 flex items-center gap-2">
              <Link
                to={`/watch/${anime.identity.internalId}/1`}
                className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white px-5 text-[13px] font-semibold text-black transition hover:bg-white/90 active:scale-[0.98]"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                  <path d="M8 5.14v13.72L19 12z" />
                </svg>
                Play
              </Link>
              <button
                onClick={onMoreInfo}
                className="inline-flex h-8 items-center rounded-full bg-white/14 px-4 text-[13px] font-medium text-white backdrop-blur transition hover:bg-white/20"
                aria-label={`More info about ${anime.title.english ?? anime.title.romaji}`}
              >
                More Info
              </button>
            </div>
          </div>

          {/* Right side muted artwork hint for desktop - keeps empty so image breathes */}
          <div className="hidden flex-1 lg:block" />
        </div>

        {/* Recently Added badge — bottom right to match ref */}
        <div className="absolute bottom-3 right-3 hidden rounded bg-black/55 px-2 py-1 text-[11px] font-medium text-white/80 backdrop-blur sm:block">
          <span className="mr-1 text-pink-400">◆</span> Recently Added
        </div>
      </div>
    </section>
  )
}
