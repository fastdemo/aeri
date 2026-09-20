import { Link } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import type { Anime } from '../../types/anime'
import { useTracking } from '../../contexts/TrackingContext'
import { resolveChaptersWithFallback } from '../../providers/manga/mangadex'
import type { MangaChapter } from '../../providers/manga/types'
import { sortProviderUnits, unitDisplayLabel } from '../../providers/manga/types'
import { getPreferences } from '../../storage/preferences'

/**
 * Manga chapter list — mirrors EpisodeList's contract (loading skeleton →
 * rows → empty state) but operates on provider UNITS, never episodes.
 * A provider unit is opaque: usually a chapter, sometimes a volume — the
 * provider's own label is preserved verbatim ("Volume 3" stays Volume 3).
 * Display order follows the `chapterOrder` pref (default oldest-first),
 * sorted numerically at the presentation layer; provider data untouched.
 */
export function ChapterList({ manga }: { manga: Anime }) {
  const [chapters, setChapters] = useState<MangaChapter[] | null>(null)
  const [providerId, setProviderId] = useState<string | null>(null)
  const [resolveError, setResolveError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [orderTick, setOrderTick] = useState(0)
  const { combinedList, isAuthenticated, updateProgress } = useTracking()

  // Re-sort when the chapterOrder pref changes (Settings writes prefs, then
  // broadcasts; storage event covers other tabs). ALSO re-resolves when
  // manga provider prefs change (enable/disable/reorder): orderTick in the
  // resolve-effect deps re-runs resolution against the CURRENT registry
  // order — the resolver reads prefs itself, so no stale priority.
  useEffect(() => {
    const onChange = () => setOrderTick(t => t + 1)
    window.addEventListener('aeri:prefs-changed', onChange)
    window.addEventListener('storage', onChange)
    return () => {
      window.removeEventListener('aeri:prefs-changed', onChange)
      window.removeEventListener('storage', onChange)
    }
  }, [])

  const ordered = useMemo(() => {
    if (!chapters) return null
    const dir = (getPreferences().chapterOrder ?? 'oldest') === 'latest' ? 'desc' : 'asc'
    // orderTick subscribes this memo to pref changes.
    void orderTick
    return sortProviderUnits(chapters, dir)
  }, [chapters, orderTick])

  // Re-resolve when manga provider prefs change (enable/disable/reorder in
  // Settings broadcasts aeri:prefs-changed). orderTick in the dep array
  // re-runs resolution against the CURRENT registry order — the resolver
  // itself reads prefs, so no stale priority is possible.
  useEffect(() => {
    setChapters(null)
    setProviderId(null)
    setResolveError(null)
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
        if (!res.chapters.length && res.error) setResolveError(res.error)
      })
      .catch(() => {})
      .finally(() => {
        clearTimeout(timeout)
        if (!cancelled) setDone(true)
      })
    return () => { cancelled = true; controller.abort(); clearTimeout(timeout) }
    // AbortController per manga id — stale results rejected via `cancelled`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manga.identity.internalId, orderTick])

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

  if (!ordered?.length) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--text)]/[0.02] px-4 py-6 text-center text-xs text-[var(--text-faint)]">
        {resolveError === 'No Manga providers are enabled.'
          ? 'No Manga providers are enabled. Enable one in Settings → Providers.'
          : providerId === null && done ? 'No readable English chapters available for this title.' : 'Chapter information not available for this title.'}
      </div>
    )
  }

  const nVolumes = ordered.filter(c => c.unitType === 'volume').length
  // Unit IDs are provider-scoped (ch.id = `<provider>-…`): the reader
  // resolves pages from the provider named in the unit id, so listing and
  // reading never mix providers within a title.
  return (
    <div className="space-y-1">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-[14px] font-semibold text-[var(--text)]">Chapters</h3>
        <span className="shrink-0 text-[14px] text-[var(--text-faint)]">
          {ordered.length} {ordered.length === 1 ? 'unit' : 'units'}{nVolumes ? ` • ${nVolumes} ${nVolumes === 1 ? 'volume' : 'volumes'}` : ''}{manga.volumes ? ` • ${manga.volumes} published` : ''}
        </span>
      </div>
      <div className="overflow-hidden rounded-lg border border-[var(--border)]">
        {ordered.map((ch, idx) => {
          const isRead = progressCh > 0 && ch.number != null && ch.number <= progressCh
          const isNext = ch.number != null && ch.number === progressCh + 1
          const label = unitDisplayLabel(ch)
          return (
            <Link
              key={ch.id}
              to={`/read/${manga.identity.internalId}/${encodeURIComponent(ch.providerChapterId)}`}
              onClick={() => {
                if (isAuthenticated && ch.number != null) updateProgress(manga, ch.number).catch(() => {})
              }}
              className={`flex items-center gap-3 bg-[var(--surface)] px-3 py-3 text-left transition hover:bg-[var(--text)]/[0.04] ${
                isNext ? 'bg-[var(--text)]/[0.06]' : ''
              } ${idx !== ordered.length - 1 ? 'border-b border-[var(--border)]' : ''}`}
            >
              <span className="w-24 shrink-0 text-[13px] font-medium text-[var(--text)]">{label}</span>
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
