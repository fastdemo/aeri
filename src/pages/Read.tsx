import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { Link, useParams, useNavigate, Navigate } from 'react-router-dom'
import { useTracking } from '../contexts/TrackingContext'
import { useMangaDetail } from '../hooks/useAnimeMetadata'
import { getReadPos, putReadPos } from '../storage/db'
import { getPreferences } from '../storage/preferences'
import { sortProviderUnits, unitDisplayLabel } from '../providers/manga/types'
import { getTitleHierarchy } from '../lib/titles'
import { Icon } from '../components/ui/Icon'
import type { MangaChapter, MangaPage, MangaProvider, MangaSourceOptions } from '../providers/manga/types'
import { getMangaProviderById, resolveChaptersWithFallback } from '../providers/manga/mangadex'

/** Structural subset: providers that expose off-site licensed units. */
type MangaDexProviderLike = MangaProvider & {
  getExternalUnits(manga: import('../types/anime').Anime, options?: MangaSourceOptions): Promise<{ label: string; url: string }[]>
}

/**
 * Prev/next chapter controls. Previous (earlier in display order, idx-1) on
 * the LEFT, next (later in display order, idx+1) on the RIGHT — both follow
 * the chapterOrder pref via orderedChapters. Both buttons always render:
 * at boundaries the missing side is a disabled greyed-out pill.
 * Filled-white pill style matches the site's primary buttons.
 */
function ChapterNavButtons({
  id,
  prevChapter,
  nextChapter,
  testId,
}: {
  id: string
  prevChapter: MangaChapter | null
  nextChapter: MangaChapter | null
  testId: string
}) {
  const pill =
    'max-w-[48%] truncate rounded-full bg-[var(--text)] px-5 py-2 text-sm font-semibold text-[var(--on-text)] transition hover:bg-[color-mix(in_srgb,var(--text)_90%,transparent)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40'
  return (
    <div data-testid={testId} className="flex items-center justify-between gap-2">
      {prevChapter ? (
        <Link
          to={`/read/${id}/${encodeURIComponent(prevChapter.providerChapterId)}`}
          aria-label="Previous chapter"
          data-testid={`${testId}-prev`}
          className={pill}
        >
          ← {unitDisplayLabel(prevChapter)}
        </Link>
      ) : (
        <button type="button" disabled aria-label="Previous chapter" data-testid={`${testId}-prev`} className={pill}>
          No previous chapter
        </button>
      )}
      {nextChapter ? (
        <Link
          to={`/read/${id}/${encodeURIComponent(nextChapter.providerChapterId)}`}
          aria-label="Next chapter"
          data-testid={`${testId}-next`}
          className={pill}
        >
          {unitDisplayLabel(nextChapter)} →
        </Link>
      ) : (
        <button type="button" disabled aria-label="Next chapter" data-testid={`${testId}-next`} className={pill}>
          No next chapter
        </button>
      )}
    </div>
  )
}

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

  // Chapter list (verified+enabled providers, registry order). Records
  // which provider won so pages + external links use the SAME provider
  // (unit IDs are provider-scoped — never mix providers within a title).
  const [chapters, setChapters] = useState<MangaChapter[] | null>(null)
  const [chaptersError, setChaptersError] = useState<string | null>(null)
  const [activeMangaProvider, setActiveMangaProvider] = useState<MangaProvider | null>(null)
  const [externalUnits, setExternalUnits] = useState<{ label: string; url: string }[] | null>(null)
  // Pref-change tick: drives BOTH re-resolution (registry order) and
  // re-sorting (chapterOrder). Declared before the effects that use it.
  const [orderTick, setOrderTick] = useState(0)
  useEffect(() => {
    const onChange = () => setOrderTick(t => t + 1)
    window.addEventListener('aeri:prefs-changed', onChange)
    window.addEventListener('storage', onChange)
    return () => {
      window.removeEventListener('aeri:prefs-changed', onChange)
      window.removeEventListener('storage', onChange)
    }
  }, [])

  // Re-resolve when manga provider prefs change (enable/disable/reorder):
  // orderTick in deps re-runs resolution against the CURRENT registry
  // order — the resolver reads prefs itself, so no stale priority.
  useEffect(() => {
    if (!manga) return
    const controller = new AbortController()
    let cancelled = false
    setChapters(null)
    setChaptersError(null)
    setActiveMangaProvider(null)
    setExternalUnits(null)
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
        const won = res.providerId ? getMangaProviderById(res.providerId) ?? null : null
        setActiveMangaProvider(won)
        if (!res.chapters.length && !res.error) {
          setChaptersError('Couldn’t load chapters')
        } else if (!res.chapters.length && res.error) {
          setChaptersError(res.error === 'No Manga providers are enabled.' ? res.error : 'Couldn’t load chapters')
        }
        // Licensed titles (e.g. Solo Leveling) have zero hosted pages but
        // real off-site chapters — offer those as external links instead of
        // a dead "no chapters" wall. Only the winning provider's externals.
        if (!res.chapters.length && won && 'getExternalUnits' in won) {
          ;(won as MangaDexProviderLike).getExternalUnits(manga, { signal: controller.signal })
            .then(ext => { if (!cancelled) setExternalUnits(ext) })
            .catch(() => {})
        }
      })
      .catch(e => {
        if (cancelled || controller.signal.aborted || (e as any)?.name === 'AbortError') return
        setChaptersError(e instanceof Error ? e.message : 'Couldn’t load chapters')
      })
    return () => { cancelled = true; controller.abort() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manga?.identity.internalId, orderTick])

  // Resolve the URL chapter param to a concrete provider unit.
  // 'first' = oldest unit, 'latest' = newest (per chapterOrder pref);
  // 'ch-N' = unit number N; otherwise a raw provider unit id.
  // Selector/prev/next all follow the same display ordering.
  const orderedChapters: MangaChapter[] | null = useMemo(() => {
    if (!chapters) return null
    void orderTick
    const dir = (getPreferences().chapterOrder ?? 'oldest') === 'latest' ? 'desc' : 'asc'
    return sortProviderUnits(chapters, dir)
  }, [chapters, orderTick])
  const currentChapter: MangaChapter | null = useMemo(() => {
    if (!orderedChapters?.length) return null
    if (chapterParam === 'first') return orderedChapters[0]
    if (chapterParam === 'latest') return orderedChapters[orderedChapters.length - 1]
    const chNum = /^ch-(\d+(?:\.\d+)?)$/.exec(chapterParam)
    if (chNum) {
      const n = Number(chNum[1])
      return orderedChapters.find(c => c.number === n) ?? null
    }
    return orderedChapters.find(c => c.providerChapterId === chapterParam) ?? null
  }, [orderedChapters, chapterParam])

  const chapterIdx = currentChapter ? orderedChapters!.findIndex(c => c.id === currentChapter.id) : -1
  // Display order: prev = earlier in reading order (idx-1), next = later (idx+1).
  // With oldest-first default, next walks toward the newest unit.
  const prevChapter = chapterIdx > 0 ? orderedChapters![chapterIdx - 1] : null
  const nextChapter = chapterIdx >= 0 && chapterIdx < orderedChapters!.length - 1 ? orderedChapters![chapterIdx + 1] : null
  // Legacy names used below: older = next in reading order, newer = previous.
  const olderChapter = nextChapter
  const newerChapter = prevChapter

  // Pages for the current unit (MangaDex data-saver by default).
  // NOTE: pages are keyed per chapter — do NOT clear on chapter change
  // (clearing causes a pages=null render that resets effects keyed on
  // pages.length and drops in-flight resume state).
  const [pages, setPages] = useState<MangaPage[] | null>(null)
  const [pagesError, setPagesError] = useState<string | null>(null)
  const [pagesLoading, setPagesLoading] = useState(false)
  const pagesByChapterRef = useRef<Map<string, MangaPage[]>>(new Map())
  useEffect(() => {
    if (!currentChapter) return
    // Page cache is namespaced per provider+chapter: unit IDs are
    // provider-scoped, so the same raw id from two providers must never
    // share entries. Tracking identity already includes the provider.
    const provId = currentChapter.id.split('-')[0] ?? 'unknown'
    const cacheKey = `${provId}:${currentChapter.providerChapterId}`
    const cached = pagesByChapterRef.current.get(cacheKey)
    // Served from cache when revisiting: no loading flash, no pages=null
    // reset, resume state intact.
    if (cached) {
      setPages(cached)
      setPagesError(null)
      setPagesLoading(false)
      return
    }
    const controller = new AbortController()
    let cancelled = false
    setPagesError(null)
    setPagesLoading(true)
    const provider = getMangaProviderById(provId) ?? activeMangaProvider
    if (!provider) {
      setPagesError('No Manga providers are enabled.')
      setPagesLoading(false)
      return
    }
    provider.getChapterPages(currentChapter, { signal: controller.signal })
      .then(list => {
        if (cancelled || controller.signal.aborted) return
        pagesByChapterRef.current.set(cacheKey, list)
        setPages(list)
        setPagesLoading(false)
      })
      .catch(e => {
        if (cancelled || controller.signal.aborted || (e as any)?.name === 'AbortError') return
        setPagesError(e instanceof Error ? e.message : 'Couldn’t load pages')
        setPagesLoading(false)
      })
    return () => { cancelled = true; controller.abort() }
  }, [currentChapter?.providerChapterId, activeMangaProvider])

  // Resume: stored read position. Identity = AniList Manga ID + provider +
  // provider unit ID — never a bare chapter number, never shared across
  // titles. Key: `read:<internalId>` (internalId is anilist-<id>).
  // NOTE: getReadPos takes the BARE internalId (it prepends `read:`).
  // NOTE 2: must depend on the resolved chapter param, not just manga —
  // when navigating manga→reader the manga object arrives before chapters
  // resolve; reading too early is fine (resume applies when pages land via
  // resumeRef), but a STALE resume from a previous title must never apply.
  const [resume, setResume] = useState<{ chapterId: string; page: number } | null>(null)
  useEffect(() => {
    setResume(null)
    if (!manga) return
    let cancelled = false
    getReadPos(manga.identity.internalId.replace(/^read:/, '')).then(pos => {
      if (cancelled || !pos) return
      setResume({ chapterId: pos.chapterId, page: pos.page })
    }).catch(() => {})
    return () => { cancelled = true }
  }, [manga?.identity.internalId, chapterParam])

  // Tracker progress sync (chapter-based): mark chapter read once the user
  // reaches the last page. Fires once per chapter.
  const completedRef = useRef(false)
  useEffect(() => { completedRef.current = false }, [currentChapter?.providerChapterId])

  // Throttled read-position persist. Key = `read:<internalId>` (AniList
  // Manga ID + mangadex provider + provider unit ID). Scroll position lives
  // in refs, never in global React state; a single IntersectionObserver
  // updates the current page ref, and a 5s-throttled writer persists to IDB.
  // Never persist page 0 over a nonzero saved page on mount: the observer
  // fires for page 0 on first paint (before the user scrolls), and without
  // this guard a reopen would clobber the saved position with 0.
  // Also persists on unmount/chapter change (flush) so short visits
  // and rapid navigation never lose position.
  const pageRef = useRef(0)
  const maxPageRef = useRef(0)
  const lastSaveRef = useRef(0)
  const flushRef = useRef<() => void>(() => {})
  const persistPos = useCallback((force = false) => {
    if (!manga || !currentChapter || !pages?.length) return
    // Guard: never overwrite a nonzero saved page with page 0. On mount the
    // observer fires for page 0 on first paint; pageRef is also 0 until the
    // user actually scrolls. Without this, reopening a chapter would erase
    // the resume position before resume scroll even runs.
    if (pageRef.current <= 0 && !force) return
    const now = Date.now()
    if (!force && now - lastSaveRef.current < 5000) return
    lastSaveRef.current = now
    putReadPos({
      id: `read:${manga.identity.internalId}`,
      chapterId: currentChapter.providerChapterId,
      chapterLabel: unitDisplayLabel(currentChapter),
      provider: 'mangadex',
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
  useEffect(() => { flushRef.current = () => persistPos(true) }, [persistPos])
  // Flush on unmount / chapter change so position survives short visits.
  // Skip when the user never scrolled (pageRef 0): flushing 0 would erase
  // a valid saved position (e.g. reopen → close before scrolling).
  useEffect(() => () => { if (pageRef.current > 0) flushRef.current() }, [currentChapter?.providerChapterId])
  // Also flush on page hide (tab close / navigation) — beacon-style.
  useEffect(() => {
    const onHide = () => { try { if (pageRef.current > 0) flushRef.current() } catch {} }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onHide)
    }
  }, [])

  const observerRef = useRef<IntersectionObserver | null>(null)
  const pageElsRef = useRef<Map<number, HTMLElement>>(new Map())
  // Resume scroll: after pages render, jump to the saved page. Retried
  // because images load lazily and layout shifts as they resolve.
  // NOTE: Layout scrolls to top on every pathname change — the resume
  // effect below compensates by scrolling to the saved page after layout
  // settles. Longer retry window (images load lazily and shift layout).
  const resumeDoneRef = useRef(false)
  const resumeRef = useRef<{ chapterId: string; page: number } | null>(null)
  useEffect(() => { resumeRef.current = resume }, [resume])
  useEffect(() => { resumeDoneRef.current = false }, [currentChapter?.providerChapterId])
  useEffect(() => {
    if (resumeDoneRef.current || !pages?.length) return
    const saved = resumeRef.current
    if (!saved || saved.chapterId !== currentChapter?.providerChapterId || saved.page <= 0) return
    const target = Math.min(saved.page, pages.length - 1)
    let tries = 0
    const t = setInterval(() => {
      tries++
      const el = pageElsRef.current.get(target)
      // Scroll once the target exists in layout — even at minHeight. Lazy
      // images below keep resolving, but scrollIntoView on the real element
      // lands within one viewport; later images shift it minimally since
      // widths are fixed and only heights grow downward.
      if (el) {
        el.scrollIntoView({ block: 'start' })
        pageRef.current = target
        maxPageRef.current = Math.max(maxPageRef.current, target)
        if (tries >= 4) { resumeDoneRef.current = true; clearInterval(t) }
      }
      if (tries >= 16) { resumeDoneRef.current = true; clearInterval(t) }
    }, 800)
    return () => clearInterval(t)
  }, [pages?.length, currentChapter?.providerChapterId])
  useEffect(() => {
    observerRef.current?.disconnect()
    // NOTE: do NOT clear pageElsRef here — ref callbacks attach before
    // passive effects run, so clear() would wipe the just-populated map and
    // the observer would watch zero elements (broke all scroll tracking and
    // resume). Stale entries self-clean: register deletes on unmount.
    pageRef.current = resume && resume.chapterId === currentChapter?.providerChapterId ? Math.min(resume.page, Math.max(0, (pages?.length ?? 1) - 1)) : 0
    maxPageRef.current = pageRef.current
    lastSaveRef.current = 0
    if (!pages?.length) return
    const obs = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue
        const idx = Number((en.target as HTMLElement).dataset.pageIndex ?? -1)
        if (idx < 0) continue
        // Track the topmost visible page (scroll-up aware), not just max.
        if (idx > maxPageRef.current) maxPageRef.current = idx
        if (idx !== pageRef.current) {
          pageRef.current = idx
          persistPos()
        }
      }
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
  // Identity guard: the reader route resolves type: MANGA. If the resolved
  // record is actually an anime (stale cross-type cache, wrong id), fail
  // closed — never render an anime as manga, never send it to providers.
  const mangaFormat = (manga.format ?? '').toUpperCase()
  if (mangaFormat !== '' && mangaFormat !== 'MANGA' && mangaFormat !== 'NOVEL' && mangaFormat !== 'ONE_SHOT') {
    return (
      <div className="mx-auto grid max-w-[800px] place-items-center px-4 py-24 text-center">
        <div>
          <p className="text-sm font-medium text-[var(--text)]">This entry is an anime, not a manga.</p>
          <Link to={`/anime/${id}`} className="mt-6 inline-block rounded-full bg-[var(--text)] px-5 py-2 text-sm font-semibold text-[var(--on-text)]">Open anime page</Link>
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
          <Icon name="chevron-left" size={16} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-semibold text-[var(--text)]">{titles.primary}</h1>
          <p className="truncate text-xs text-[var(--text-faint)]">{currentChapter ? unitDisplayLabel(currentChapter) : 'Loading chapters…'}</p>
        </div>
        {/* Chapter selector (follows chapterOrder pref) */}
        {orderedChapters && orderedChapters.length > 0 && (
          <div className="relative shrink-0">
            <select
              value={currentChapter?.providerChapterId ?? ''}
              onChange={e => { if (e.target.value && id) navigate(`/read/${id}/${encodeURIComponent(e.target.value)}`) }}
              aria-label="Select chapter"
              className="max-w-[150px] appearance-none truncate rounded-full border border-[var(--border)] bg-[var(--bg-soft)] py-1.5 pl-3.5 pr-8 text-xs font-medium text-[var(--text)] focus:border-[var(--border-strong)] focus:outline-none"
            >
              {orderedChapters.map(c => (
                <option key={c.id} value={c.providerChapterId} className="bg-[var(--surface)]">{unitDisplayLabel(c)}</option>
              ))}
            </select>
            <Icon name="chevron-down" size={12} className="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--text-faint)]" />
          </div>
        )}
      </div>

      {chaptersError && !chapters && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--text)]/[0.03] px-4 py-6 text-center">
          <p className="text-sm text-[var(--warn)]">{chaptersError}</p>
          <p className="mt-1 text-xs text-[var(--text-faint)]">The manga providers may be busy — try again shortly.</p>
        </div>
      )}

      {chapters && chapters.length === 0 && !chaptersError && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--text)]/[0.03] px-4 py-6 text-center">
          <p className="text-sm text-[var(--text-muted)]">No readable English chapters available for this title.</p>
          {externalUnits && externalUnits.length > 0 ? (
            <div className="mt-3">
              <p className="text-xs text-[var(--text-faint)]">Licensed — read officially:</p>
              <div className="mt-2 flex flex-wrap justify-center gap-2">
                {externalUnits.slice(0, 6).map((u, i) => (
                  <a key={i} href={u.url} target="_blank" rel="noopener noreferrer" className="rounded-full border border-[var(--border)] bg-[var(--bg-soft)] px-4 py-1.5 text-xs font-medium text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--text)_10%,transparent)]">{u.label}</a>
                ))}
              </div>
            </div>
          ) : (
            <p className="mt-1 text-xs text-[var(--text-faint)]">The publisher hosts these chapters off-site (licensed).</p>
          )}
        </div>
      )}

      {/* Prev/next chapter (top) — prev LEFT, next RIGHT, always both */}
      {currentChapter && (
        <div className="mb-4">
          <ChapterNavButtons id={id} prevChapter={prevChapter} nextChapter={nextChapter} testId="chapter-nav-top" />
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

      {/* End-of-chapter nav (bottom) — prev LEFT, next RIGHT, always both */}
      {pages && pages.length > 0 && (
        <div className="mt-8">
          <ChapterNavButtons id={id} prevChapter={prevChapter} nextChapter={nextChapter} testId="chapter-nav-bottom" />
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
