import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import type { Anime } from '../../types/anime'
import { useTracking } from '../../contexts/TrackingContext'
import { resolveChaptersWithFallback } from '../../providers/manga/weebcentral'
import type { MangaChapter } from '../../providers/manga/types'

/**
 * Manga chapter list — mirrors EpisodeList's contract (loading skeleton →
 * rows → empty state) but operates on provider CHAPTERS, never episodes.
 * Volumes are AniList published-volume metadata shown in the header only;
 * the rows are the provider's actual readable chapters.
 */
export function ChapterList({ manga }: { manga: Anime }) {
  const [chapters, setChapters] = useState<MangaChapter[] | null>(null)
  const [providerId, setProviderId] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const { combinedList, isAuthenticated, updateProgress } = useTracking()

  useEffect(() => {
    setChapters(null)
    setProviderId(null)
    setDone(false)
    const controller = new AbortController()
    let cancelled = false
    const timeout = setTimeout(() => { if (!cancelled) setDone(true) }, 8000)
    resolveChaptersWithFallback(manga, controller.signal, {
      mangaTitle: manga.title.romaji,
      mangaEnglish: manga.title.english,
      mangaNative: manga.title.native,
      mangaChapters: manga.chapters,
      mangaVolumes: manga.volumes,
      mangaFormat: manga.format,
      mangaYear: manga.year,
    })
      .then(res => {
        if (cancelled || controller.signal.aborted) return
        setChapters(res.chapters)
        setProviderId(res.providerId)
      })
      .catch(() => {})
      .finally(() => {
        clearTimeout(timeout)
        if (!cancelled) setDone(true)
      })
    return () => { cancelled = true; controller.abort(); clearTimeout(timeout) }
    // AbortController per manga id — stale results rejected via `cancelled`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manga.identity.internalId])

  const entry = (() => {
    if (!isAuthenticated || !combinedList) return null
    const malId = manga.identity.malId
    const anilistId = manga.identity.anilistId
    return combinedList.find((e) => {
      if (malId && e.anime.identity.malId === malId) return true
      if (anilistId && e.anime.identity.anilistId === anilistId) return true
      return e.anime.identity.internalId === manga.identity.internalId
    }) ?? null
  })()
  const progressCh = entry?.progress ?? 0

  if (!done && !chapters) {
    return (
      <div className="space-y-1" aria-label="Loading chapters">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h3 className="text-[14px] font-semibold text-[var(--text)]">Chapters</h3>
          <span className="shrink-0 text-[14px] text-[var(--text-faint)]">Loading chapters...</span>
        </div>
        {[1, 2, 3, 4, 5].map(i => (
          <div key={i} className={`flex items-center gap-3 bg-[var(--surface)] px-3 py-3 ${i !== 5 ? 'border-b border-[var(--border)]' : ''} animate-pulse`}>
            <span className="h-4 w-14 rounded bg-[color-mix(in_srgb,var(--text)_5%,transparent)]" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-1/3 rounded bg-[color-mix(in_srgb,var(--text)_5%,transparent)]" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (!chapters?.length) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--text)]/[0.02] px-4 py-6 text-center text-xs text-[var(--text-faint)]">
        {providerId === null && done ? 'No readable chapters found for this title.' : 'Chapter information not available for this title.'}
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-[14px] font-semibold text-[var(--text)]">Chapters</h3>
        <span className="shrink-0 text-[14px] text-[var(--text-faint)]">
          {chapters.length} chapters{manga.volumes ? ` • ${manga.volumes} volumes` : ''}
        </span>
      </div>
      <div className="overflow-hidden rounded-lg border border-[var(--border)]">
        {chapters.map((ch, idx) => {
          const isRead = progressCh > 0 && ch.number != null && ch.number <= progressCh
          const isNext = ch.number != null && ch.number === progressCh + 1
          return (
            <Link
              key={ch.id}
              to={`/read/${manga.identity.internalId}/${encodeURIComponent(ch.providerChapterId)}`}
              onClick={() => {
                if (isAuthenticated && ch.number != null) updateProgress(manga, ch.number).catch(() => {})
              }}
              className={`flex items-center gap-3 bg-[var(--surface)] px-3 py-3 text-left transition hover:bg-[var(--text)]/[0.04] ${
                isNext ? 'bg-[var(--text)]/[0.06]' : ''
              } ${idx !== chapters.length - 1 ? 'border-b border-[var(--border)]' : ''}`}
            >
              <span className="w-24 shrink-0 text-[13px] font-medium text-[var(--text)]">{ch.label}</span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-[var(--text-faint)]">
                {ch.publishedAt ? new Date(ch.publishedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : ''}
              </span>
              <span className="hidden text-xs text-[var(--text-faint)] sm:block">{isRead ? 'Read' : ''}</span>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
