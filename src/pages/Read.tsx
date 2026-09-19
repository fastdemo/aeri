import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { Link, useParams, useNavigate, Navigate } from 'react-router-dom'
import { useTracking } from '../contexts/TrackingContext'
import { useMangaDetail } from '../hooks/useAnimeMetadata'
import { getReadPos, putReadPos } from '../storage/db'
import { getPreferences } from '../storage/preferences'
import { getTitleHierarchy } from '../lib/titles'
import { weebCentralProvider } from '../providers/manga/weebcentral'
import type { MangaChapter, MangaPage } from '../providers/manga/types'

/**
 * Manga reader (`#/read/:id/:chapter`). Architectural sibling of Watch:
 * same route-convention shape, same loading/error shell, same progress
 * persistence pattern — but manga-native behavior:
 * - vertical continuous scroll (default; `readerMode` reserves single/double)
 * - lazy page images, per-image retry, no layout shift while loading
 * - chapter selector + prev/next, keyboard navigation
 * - progress = chapter + page (throttled IDB writes, no per-scroll setState
 *   into global state — local refs + one throttled persist)
 */
export function Read() {
  const { id, chapter } = useParams<{ id: string; chapter: string }>()
  const navigate = useNavigate()
  const { isAuthenticated, combinedList, updateProgress } = useTracking()

  const trackingEntry = isAuthenticated && id ? combinedList?.find((e) => e.anime.identity.internalId === id || e.anime.identity.anilistId?.toString() === id || e.anime.identity.malId?.toString() === id) : null
  const realId = (() => {
    if (!id) return undefined
    if (id.startsWith('anilist-') || id.startsWith('mal-') || /^\d+$/.test(id)) return id
    if (trackingEntry?.anime.identity.anilistId) return `anilist-${trackingEntry.anime.identity.anilistId}`
    return id
  })()

  const { data: remote, loading: loadingManga } = useMangaDetail(realId)
  const manga = trackingEntry?.anime ?? remote
  const titles = useMemo(() => (manga ? getTitleHierarchy(manga) : { primary: '' } as any), [manga])

  const chapterParam = decodeURIComponent(chapter ?? 'first')

  // Chapter list (provider chapters). Abortable; stale results rejected.
  const [chapters, setChapters] = useState<MangaChapter[] | null>(null)
  const [chaptersError, setChaptersError] = useState<string | null>(null)
  useEffect(() => {
    if (!manga) return
    const controller = new AbortController()
    let cancelled = false
    setChapters(null)
    setChaptersError(null)
    weebCentralProvider.getChapters(manga, {
      signal: controller.signal,
      mangaTitle: manga.title.romaji,
      mangaEnglish: manga.title.english,
      mangaNative: manga.title.native,
      mangaChapters: manga.chapters,
      mangaVolumes: manga.volumes,
      mangaFormat: manga.format,
      mangaYear: manga.year,
    })
      .then(list => { if (!cancelled && !controller.signal.aborted) setChapters(list) })
      .catch(e => {
        if (cancelled || controller.signal.aborted || (e as any)?.name === 'AbortError') return
        setChaptersError(e instanceof Error ? e.message : 'Couldn’t load chapters')
      })
    return () => { cancelled = true; controller.abort() }
  }, [manga?.identity.internalId])

  // Resolve the URL chapter param to a concrete provider chapter.
  // 'first' = oldest chapter (index 0 of provider list, which is newest-first
  // from WeebCentral — so last element); 'latest' = newest; 'ch-N' = chapter
  // number N; otherwise a raw provider chapter id.
  const currentChapter: MangaChapter | null = useMemo(() => {
    if (!chapters?.length) return null
    if (chapterParam === 'first') return chapters[chapters.length - 1]
    if (chapterParam === 'latest') return chapters[0]
    const chNum = /^ch-(\d+(?:\.\d+)?)$/.exec(chapterParam)
    if (chNum) {
      const n = Number(chNum[1])
      return chapters.find(c => c.number === n) ?? null
    }
    return chapters.find(c => c.providerChapterId === chapterParam) ?? null
  }, [chapters, chapterParam])

  const chapterIdx = currentChapter ? chapters!.findIndex(c => c.id === currentChapter.id) : -1
  // Provider list is newest-first: prev = newer (idx-1), next = older (idx+1)
  const newerChapter = chapterIdx > 0 ? chapters![chapterIdx - 1] : null
  const olderChapter = chapterIdx >= 0 && chapterIdx < chapters!.length - 1 ? chapters![chapterIdx + 1] : null

  // Pages for the current chapter.
  const [pages, setPages] = useState<MangaPage[] | null>(null)
  const [pagesError, setPagesError] = useState<string | null>(null)
  const [pagesLoading, setPagesLoading] = useState(false)
  useEffect(() => {
    if (!currentChapter) return
    const controller = new AbortController()
    let cancelled = false
    setPages(null)
    setPagesError(null)
    setPagesLoading(true)
    weebCentralProvider.getChapterPages(currentChapter, { signal: controller.signal })
      .then(list => {
        if (cancelled || controller.signal.aborted) return
        setPages(list)
        setPagesLoading(false)
      })
      .catch(e => {
        if (cancelled || controller.signal.aborted || (e as any)?.name === 'AbortError') return
        setPagesError(e instanceof Error ? e.message : 'Couldn’t load pages')
        setPagesLoading(false)
      })
    return () => { cancelled = true; controller.abort() }
  }, [currentChapter?.providerChapterId])

  // Resume: stored read position for this manga (chapter + page).
  const [resume, setResume] = useState<{ chapterId: string; page: number } | null>(null)
  useEffect(() => {
    if (!manga) return
    let cancelled = false
    getReadPos(manga.identity.internalId).then(pos => {
      if (cancelled || !pos) return
      setResume({ chapterId: pos.chapterId, page: pos.page })
    }).catch(() => {})
    return () => { cancelled = true }
  }, [manga?.identity.internalId])

  // Tracker progress sync (chapter-based): mark chapter read once the user
  // reaches the last page. Fires once per chapter.
  const completedRef = useRef(false)
  useEffect(() => { completedRef.current = false }, [currentChapter?.providerChapterId])

  // Throttled read-position persist. Scroll position lives in refs, never in
  // global React state; a single IntersectionObserver updates the current
  // page ref, and a 5s-throttled writer persists to IDB.
  const pageRef = useRef(0)
  const maxPageRef = useRef(0)
  const lastSaveRef = useRef(0)
  const persistPos = useCallback(() => {
    if (!manga || !currentChapter || !pages?.length) return
    const now = Date.now()
    if (now - lastSaveRef.current < 5000) return
    lastSaveRef.current = now
    putReadPos({
      id: `read:${manga.identity.internalId}`,
      chapterId: currentChapter.providerChapterId,
      chapterLabel: currentChapter.label,
      page: pageRef.current,
      maxPage: pages.length,
      updatedAt: now,
    }).catch(() => {})
    // Reached the final page → chapter counts as read for the tracker.
    if (isAuthenticated && !completedRef.current && pageRef.current >= pages.length - 1 && currentChapter.number != null) {
      completedRef.current = true
      updateProgress(manga, currentChapter.number).catch(() => {})
    }
  }, [manga, currentChapter, pages?.length, isAuthenticated, updateProgress])

  const observerRef = useRef<IntersectionObserver | null>(null)
  const pageElsRef = useRef<Map<number, HTMLElement>>(new Map())
  useEffect(() => {
    observerRef.current?.disconnect()
    pageElsRef.current.clear()
    pageRef.current = resume && resume.chapterId === currentChapter?.providerChapterId ? Math.min(resume.page, Math.max(0, (pages?.length ?? 1) - 1)) : 0
    maxPageRef.current = pageRef.current
    if (!pages?.length) return
    const obs = new IntersectionObserver((entries) => {
      let advanced = false
      for (const en of entries) {
        if (!en.isIntersecting) continue
        const idx = Number((en.target as HTMLElement).dataset.pageIndex ?? -1)
        if (idx >= 0 && idx > maxPageRef.current) {
          maxPageRef.current = idx
          pageRef.current = idx
          advanced = true
        }
      }
      if (advanced) persistPos()
    }, { rootMargin: '0px 0px -40% 0px' })
    observerRef.current = obs
    // Observe after paint — elements register via ref callback below.
    const t = setTimeout(() => {
      for (const el of pageElsRef.current.values()) obs.observe(el)
    }, 50)
    return () => { clearTimeout(t); obs.disconnect() }
  }, [pages?.length, currentChapter?.providerChapterId])

  useEffect(() => () => { observerRef.current?.disconnect() }, [])

  // Keyboard: arrows navigate pages (scroll), [ ] switch chapters.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'SELECT' || (e.target as HTMLElement)?.tagName === 'INPUT') return
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const dir = e.key === 'ArrowRight' ? 1 : -1
        const next = Math.min(Math.max(0, pageRef.current + dir), (pages?.length ?? 1) - 1)
        pageElsRef.current.get(next)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      } else if (e.key === '[' && olderChapter && id) {
        navigate(`/read/${id}/${encodeURIComponent(olderChapter.providerChapterId)}`)
      } else if (e.key === ']' && newerChapter && id) {
        navigate(`/read/${id}/${encodeURIComponent(newerChapter.providerChapterId)}`)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pages?.length, olderChapter, newerChapter, id, navigate])

  if (!id) return <Navigate to="/" replace />
  if (loadingManga && !manga) {
    return (
      <div className="mx-auto max-w-[800px] px-4 py-16">
        <div className="h-8 w-2/3 animate-pulse rounded bg-[color-mix(in_srgb,var(--text)_5%,transparent)]" />
        <div className="mt-6 space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="aspect-[3/4] w-full animate-pulse rounded bg-[color-mix(in_srgb,var(--text)_5%,transparent)]" />
          ))}
        </div>
      </div>
    )
  }
  if (!manga) {
    return (
      <div className="mx-auto grid max-w-[800px] place-items-center px-4 py-24 text-center">
        <div>
          <p className="text-sm font-medium text-[var(--text)]">Manga not found</p>
          <Link to="/manga" className="mt-6 inline-block rounded-full bg-[var(--text)] px-5 py-2 text-sm font-semibold text-[var(--on-text)]">Back to Manga</Link>
        </div>
      </div>
    )
  }

  const prefs = getPreferences()
  const fit = prefs.readerFit ?? 'width'

  return (
    <div className="mx-auto max-w-[800px] px-4 pb-16 sm:px-6">
      {/* Header */}
      <div className="flex items-center gap-3 py-4">
        <Link to="/manga" aria-label="Back to Manga" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[var(--text-muted)] hover:bg-[color-mix(in_srgb,var(--text)_10%,transparent)] hover:text-[var(--text)]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6" /></svg>
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-semibold text-[var(--text)]">{titles.primary}</h1>
          <p className="truncate text-xs text-[var(--text-faint)]">{currentChapter ? currentChapter.label : 'Loading chapters…'}</p>
        </div>
        {/* Chapter selector */}
        {chapters && chapters.length > 0 && (
          <div className="relative shrink-0">
            <select
              value={currentChapter?.providerChapterId ?? ''}
              onChange={e => { if (e.target.value && id) navigate(`/read/${id}/${encodeURIComponent(e.target.value)}`) }}
              aria-label="Select chapter"
              className="max-w-[150px] appearance-none truncate rounded-full border border-[var(--border)] bg-[var(--bg-soft)] py-1.5 pl-3.5 pr-8 text-xs font-medium text-[var(--text)] focus:border-[var(--border-strong)] focus:outline-none"
            >
              {chapters.map(c => (
                <option key={c.id} value={c.providerChapterId} className="bg-[var(--surface)]">{c.label}</option>
              ))}
            </select>
            <svg aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--text-faint)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
          </div>
        )}
      </div>

      {chaptersError && !chapters && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--text)]/[0.03] px-4 py-6 text-center">
          <p className="text-sm text-[var(--warn)]">{chaptersError}</p>
          <p className="mt-1 text-xs text-[var(--text-faint)]">Weeb Central may be challenging this network — try again shortly.</p>
        </div>
      )}

      {chapters && chapters.length === 0 && !chaptersError && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--text)]/[0.03] px-4 py-6 text-center">
          <p className="text-sm text-[var(--text-muted)]">No readable chapters found for this title.</p>
        </div>
      )}

      {/* Prev/next chapter */}
      {currentChapter && (
        <div className="mb-4 flex items-center justify-between gap-2">
          {olderChapter ? (
            <Link to={`/read/${id}/${encodeURIComponent(olderChapter.providerChapterId)}`} className="rounded-full border border-[var(--border)] bg-[var(--bg-soft)] px-4 py-1.5 text-xs font-medium text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--text)_10%,transparent)]">← {olderChapter.label}</Link>
          ) : <span />}
          {newerChapter ? (
            <Link to={`/read/${id}/${encodeURIComponent(newerChapter.providerChapterId)}`} className="rounded-full border border-[var(--border)] bg-[var(--bg-soft)] px-4 py-1.5 text-xs font-medium text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--text)_10%,transparent)]">{newerChapter.label} →</Link>
          ) : <span />}
        </div>
      )}

      {/* Pages — vertical continuous */}
      {pagesLoading && (
        <div className="space-y-3" aria-label="Loading pages">
          {[1, 2].map(i => (
            <div key={i} className="aspect-[3/4] w-full animate-pulse rounded bg-[color-mix(in_srgb,var(--text)_5%,transparent)]" />
          ))}
        </div>
      )}
      {pagesError && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--text)]/[0.03] px-4 py-6 text-center">
          <p className="text-sm text-[var(--warn)]">{pagesError}</p>
          <button onClick={() => window.location.reload()} className="mt-3 rounded-full bg-[color-mix(in_srgb,var(--text)_10%,transparent)] px-4 py-1.5 text-xs font-medium text-[var(--text)]">Retry</button>
        </div>
      )}
      {pages && pages.length > 0 && (
        <div className="flex flex-col items-center gap-0">
          {pages.map(p => (
            <MangaPageImage
              key={p.index}
              page={p}
              fit={fit}
              register={el => { if (el) pageElsRef.current.set(p.index, el); else pageElsRef.current.delete(p.index) }}
            />
          ))}
        </div>
      )}

      {/* End-of-chapter nav */}
      {pages && pages.length > 0 && (
        <div className="mt-8 flex items-center justify-between gap-2">
          {olderChapter ? (
            <Link to={`/read/${id}/${encodeURIComponent(olderChapter.providerChapterId)}`} className="rounded-full bg-[var(--text)] px-5 py-2 text-sm font-semibold text-[var(--on-text)]">Next: {olderChapter.label}</Link>
          ) : <span className="text-xs text-[var(--text-faint)]">You’re all caught up</span>}
          {newerChapter ? (
            <Link to={`/read/${id}/${encodeURIComponent(newerChapter.providerChapterId)}`} className="rounded-full bg-[color-mix(in_srgb,var(--text)_10%,transparent)] px-5 py-2 text-sm font-medium text-[var(--text)]">← {newerChapter.label}</Link>
          ) : <span />}
        </div>
      )}
    </div>
  )
}

function MangaPageImage({ page, fit, register }: { page: MangaPage; fit: string; register: (el: HTMLElement | null) => void }) {
  const [failed, setFailed] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  return (
    <div
      ref={register as any}
      data-page-index={page.index}
      className={`relative w-full overflow-hidden bg-[var(--surface)] ${page.index === 0 ? 'rounded-t-lg' : ''}`}
      style={{ minHeight: 400 }}
    >
      {!failed ? (
        <img
          key={retryKey}
          src={page.url}
          alt={`Page ${page.index + 1}`}
          loading={page.index < 3 ? 'eager' : 'lazy'}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className={`w-full ${fit === 'height' ? 'max-h-screen object-contain' : 'h-auto object-cover'}`}
        />
      ) : (
        <div className="grid min-h-[400px] place-items-center px-4 py-12 text-center">
          <div>
            <p className="text-xs text-[var(--text-faint)]">Page {page.index + 1} failed to load</p>
            <button
              onClick={() => { setFailed(false); setRetryKey(k => k + 1) }}
              className="mt-3 rounded-full bg-[color-mix(in_srgb,var(--text)_10%,transparent)] px-4 py-1.5 text-xs font-medium text-[var(--text)]"
            >
              Retry
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
