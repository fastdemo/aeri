import { useEffect, useRef, useState } from 'react'
import { useTracking } from '../../contexts/TrackingContext'
import { useAiring } from '../../hooks/useAnimeMetadata'
import { getTitleHierarchy } from '../../lib/titles'
import type { Anime } from '../../types/anime'

/**
 * Schedule bell: "what's airing soon for ME" (replaces the dead
 * notifications button). Priority 1: watching list entries with a
 * next-airing episode. Fallback: currently-airing rail titles (so the
 * panel is useful even with an empty list). Same dropdown language as
 * search suggestions (blur panel, cover rows). No new data source:
 * nextAiringEpisode already rides on AniList metadata + list entries.
 */
export function SchedulePanel({ onClose, onOpen }: { onClose: () => void; onOpen: (animeId: string) => void }) {
  const { combinedList } = useTracking()
  const { data: airing } = useAiring(24)
  const ref = useRef<HTMLDivElement>(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [onClose])

  const mine = ((combinedList ?? [])
    .filter(e => e.status === 'watching' && e.anime.nextAiringEpisode && e.anime.nextAiringEpisode.airingAt * 1000 > now - 86400000)
    .map(e => ({ e, at: (e.anime.nextAiringEpisode?.airingAt ?? 0) * 1000, mine: true as const }))
    .sort((a, b) => a.at - b.at)).slice(0, 8)
  // Fallback: currently-airing rail titles. Their nextAiringEpisode may be
  // absent (schedule nodes carry the timestamps instead), so derive the
  // soonest future airingAt from airingSchedule when needed.
  const soonest = (a: Anime): number => {
    if (a.nextAiringEpisode?.airingAt) return a.nextAiringEpisode.airingAt * 1000
    const fut = (a.airingSchedule ?? [])
      .map((n: { airingAt: number }) => n.airingAt * 1000)
      .filter((t: number) => t > now - 86400000)
    return fut.length ? Math.min(...fut) : 0
  }
  const seen = new Set(mine.map(m => m.e.anime.identity.internalId))
  const rail = ((airing ?? [])
    .filter(a => !seen.has(a.identity.internalId))
    .map(a => ({ e: { anime: a } as { anime: (typeof a) }, at: soonest(a), mine: false as const }))
    .filter(x => x.at > now - 86400000)
    .sort((a, b) => a.at - b.at)).slice(0, Math.max(0, 8 - mine.length))
  const items = [...mine, ...rail]

  const fmtCountdown = (at: number) => {
    const ms = at - now
    if (ms <= 0) return 'Aired'
    const h = Math.floor(ms / 3600000)
    const d = Math.floor(h / 24)
    if (d >= 1) return `in ${d}d ${h % 24}h`
    if (h >= 1) return `in ${h}h ${Math.floor((ms % 3600000) / 60000)}m`
    return `in ${Math.max(1, Math.floor(ms / 60000))}m`
  }

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Airing schedule"
      style={{ isolation: 'isolate' }}
      className="absolute right-0 top-[calc(100%+8px)] z-[70] max-h-[min(68vh,420px)] w-[300px] overflow-x-hidden overflow-y-auto rounded-xl border border-[var(--border)] bg-[color-mix(in_srgb,var(--bg)_70%,transparent)] backdrop-blur-2xl shadow-[0_16px_48px_var(--shadow)]"
    >
      <p className="sticky top-0 z-10 bg-[color-mix(in_srgb,var(--bg)_70%,transparent)] px-3 pb-1 pt-2 text-[14px] font-semibold text-[var(--text)] backdrop-blur-2xl">
        Airing soon
      </p>
      {items.length === 0 ? (
        <p className="px-3 py-4 text-center text-xs text-[var(--text-muted)]">
          Nothing airing soon. Mark shows as watching to track premieres here.
        </p>
      ) : (
        items.map(({ e, at }) => {
          const titles = getTitleHierarchy(e.anime)
          const ep = e.anime.nextAiringEpisode?.episode
          const id = e.anime.identity.anilistId ? `anilist-${e.anime.identity.anilistId}` : e.anime.identity.internalId
          return (
            <button
              key={e.anime.identity.internalId}
              type="button"
              role="menuitem"
              onClick={() => { onOpen(id); onClose() }}
              className="flex w-full touch-manipulation items-center gap-3 px-3 py-2 text-left hover:bg-[color-mix(in_srgb,var(--text)_5%,transparent)]"
              style={{ touchAction: 'manipulation' } as any}
            >
              <div className="h-14 w-10 shrink-0 overflow-hidden rounded bg-[color-mix(in_srgb,var(--text)_5%,transparent)]">
                <img src={e.anime.coverImage} alt="" className="h-full w-full object-cover" loading="lazy" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium leading-tight text-[var(--text)]">{titles.primary}</p>
                <p className="text-[11px] text-[var(--text-faint)]">
                  {ep ? `Ep ${ep} • ` : ''}{fmtCountdown(at)}
                </p>
              </div>
            </button>
          )
        })
      )}
    </div>
  )
}
