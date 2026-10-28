import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from 'react'
import { Link, useParams, useNavigate, useLocation, Navigate } from 'react-router-dom'
import { useTracking } from '../contexts/TrackingContext'
import { useMangaDetail } from '../hooks/useAnimeMetadata'
import { useAeriTitle } from '../hooks/useAeriTitle'
import { getReadPos, putReadPos } from '../storage/db'
import { getPreferences, isIncognitoEnabled } from '../storage/preferences'
import { sortProviderUnits, unitDisplayLabel } from '../providers/manga/types'
import { getTitleHierarchy } from '../lib/titles'
import { Icon } from '../components/ui/Icon'
import { FilterSelect } from '../components/ui/FilterSelect'
import { pillSolid, pillSoft } from '../components/ui/buttonStyles'
import { useRelatedEntries } from '../hooks/useRelatedEntries'
import { RelatedRow } from '../components/related/RelatedRow'
import type { MangaChapter, MangaPage, MangaProvider } from '../providers/manga/types'
import { getMangaProviderById, resolveChaptersWithFallback } from '../providers/manga/mangadex'

/**
 * Prev / chapter picker / next — one row, three cells.
 *
 * Previous (earlier in display order, idx-1) sits on the LEFT and next
 * (later, idx+1) on the RIGHT, both following the chapterOrder pref via
 * orderedChapters. At the boundaries the missing side is a disabled
 * greyed-out pill, so the row never reflows between chapters.
 *
 * The picker is the middle cell of a `1fr auto 1fr` grid: it is centred on
 * the row itself, not pushed off-centre by whatever width the prev/next
 * labels happen to have. Rendered twice (top and bottom of the reader) so a
 * chapter switch never requires scrolling back up.
 */
function ChapterNavButtons({
  id,
  prevChapter,
  nextChapter,
  chapters,
  currentChapter,
  testId,
}: {
  id: string
  prevChapter: MangaChapter | null
  nextChapter: MangaChapter | null
  chapters: MangaChapter[]
  currentChapter: MangaChapter | null
  testId: string
}) {
  const navigate = useNavigate()
  const pill = `${pillSolid} max-w-full truncate`
  return (
    <div data-testid={testId} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
      <div className="flex min-w-0 justify-start">
        {prevChapter ? (
          <Link
            to={`/read/${id}/${encodeURIComponent(prevChapter.providerChapterId)}`}
            aria-label="Previous chapter"
            data-testid={`${testId}-prev`}
            className={pill}
          >
            ← Previous
          </Link>
        ) : (
          <button type="button" disabled aria-label="Previous chapter" data-testid={`${testId}-prev`} className={pill}>
            ← Previous
          </button>
        )}
      </div>

      <div data-testid={`${testId}-select`} className="flex min-w-0 justify-center">
        {chapters.length > 0 && (
          <FilterSelect
            value={currentChapter?.providerChapterId ?? ''}
            onChange={v => { if (v) navigate(`/read/${id}/${encodeURIComponent(v)}`) }}
            ariaLabel="Select chapter"
            tone="solid"
            options={chapters.map(c => ({ value: c.providerChapterId, label: unitDisplayLabel(c) }))}
          />
        )}
      </div>

      <div className="flex min-w-0 justify-end">
        {nextChapter ? (
          <Link
            to={`/read/${id}/${encodeURIComponent(nextChapter.providerChapterId)}`}
            aria-label="Next chapter"
            data-testid={`${testId}-next`}
            className={pill}
          >
            Next →
          </Link>
        ) : (
          <button type="button" disabled aria-label="Next chapter" data-testid={`${testId}-next`} className={pill}>
            Next →
          </button>
        )}
      </div>
    </div>
  )
}

/**
 * Manga reader (`/read/:id/:chapter`). Architectural sibling of Watch:
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
  const location = useLocation()
  const { isAuthenticated, combinedList, updateProgress, updateStatus } = useTracking()

  const trackingEntry = isAuthenticated && id ? combinedList?.find((e) => e.anime.identity.internalId === id || e.anime.identity.anilistId?.toString() === id || e.anime.identity.malId?.toString() === id) : null
  const realId = (() => {
    if (!id) return undefined
    if (id.startsWith('anilist-') || id.startsWith('mal-') || /^\d+$/.test(id)) return id
    if (trackingEntry?.anime.identity.anilistId) return `anilist-${trackingEntry.anime.identity.anilistId}`
    return id
  })()

  const { data: remote, loading: loadingManga } = useMangaDetail(realId)
  // DISPLAY RECORD RULE (same root cause as AnimeDetail): the tracker's
  // list copy is thin (no relations/chapters detail). Display comes from
  // the full MANGA Media record only.
  const manga = remote ?? null
  const titles = useMemo(() => (manga ? getTitleHierarchy(manga) : { primary: '' } as any), [manga])
  // TAB TITLE: the manga's own name; route fallback
  // ("Read") until the record resolves.
  useAeriTitle(titles.primary || null, 'override')

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
        // Licensed titles (e.g. Solo Leveling, One Piece post-2026) host
        // zero readable units: the resolver returns the first all-external
        // source's off-site links instead of a dead wall. Never an error
        // when those links exist — they ARE the answer.
        setExternalUnits(res.externalUnits?.length ? res.externalUnits : null)
        if (!res.chapters.length && !res.externalUnits?.length) {
          setChaptersError(res.error && res.error === 'No Manga providers are enabled.' ? res.error : 'Couldn’t load chapters')
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
  // 'first' = oldest unit, 'latest' = newest (reader always oldest-first;
  // the list's local toggle is display-only and never rewrites routes);
  // 'ch-N' = unit number N; otherwise a raw provider unit id.
  // Selector/prev/next all follow the same display ordering.
  const orderedChapters: MangaChapter[] | null = useMemo(() => {
    if (!chapters) return null
    void orderTick
    return sortProviderUnits(chapters, 'asc')
  }, [chapters, orderTick])
  /**
   * Resolve the URL param to a readable unit.
   *
   * `requested` carries the param ONLY when it could not be matched exactly
   * — the reader then shows a one-line notice instead of pretending. A
   * miss never dead-ends: numeric targets (`ch-N`, written by every Resume /
   * Read button) snap to the nearest unit after N, then before N, then the
   * last unit. Skip-numbered catalogues (volumes, .5 chapters, provider gaps)
   * previously left `currentChapter === null`, which rendered the header
   * with "Loading chapters…" forever — the "chapter not found" wall
   * on most titles. An unknown raw provider id (list rebuilt by another
   * source) falls back to the first unit instead of a blank reader.
   */
  const resolvedChapter = useMemo<{ chapter: MangaChapter; requested: string | null } | null>(() => {
    if (!orderedChapters?.length) return null
    if (chapterParam === 'first') return { chapter: orderedChapters[0], requested: null }
    if (chapterParam === 'latest') {
      return { chapter: orderedChapters[orderedChapters.length - 1], requested: null }
    }
    const chNum = /^ch-(\d+(?:\.\d+)?)$/.exec(chapterParam)
    if (chNum) {
      const n = Number(chNum[1])
      const exact = orderedChapters.find(c => c.number === n)
      if (exact) return { chapter: exact, requested: null }
      const after = orderedChapters.find(c => typeof c.number === 'number' && c.number > n)
      const before = [...orderedChapters].reverse().find(c => typeof c.number === 'number' && c.number < n)
      const target = after ?? before ?? orderedChapters[orderedChapters.length - 1]
      return { chapter: target, requested: chapterParam }
    }
    const byId = orderedChapters.find(c => c.providerChapterId === chapterParam)
    if (byId) return { chapter: byId, requested: null }
    return { chapter: orderedChapters[0], requested: chapterParam }
  }, [orderedChapters, chapterParam])
  const currentChapter: MangaChapter | null = resolvedChapter?.chapter ?? null
  // Set only when the requested unit was missing from this source's list.
  const chapterFallbackNotice = resolvedChapter?.requested ?? null

  const chapterIdx = currentChapter ? orderedChapters!.findIndex(c => c.id === currentChapter.id) : -1
  // Display order: prev = earlier in reading order (idx-1), next = later (idx+1).
  // With oldest-first default, next walks toward the newest unit.
  const prevChapter = chapterIdx > 0 ? orderedChapters![chapterIdx - 1] : null
  const nextChapter = chapterIdx >= 0 && chapterIdx < orderedChapters!.length - 1 ? orderedChapters![chapterIdx + 1] : null
  // Legacy names used below: older = next in reading order, newer = previous.
  const olderChapter = nextChapter
  const newerChapter = prevChapter

  // Pages for the current unit. Provider comes from the unit's own id
  // prefix — the list is single-source (one winning provider), but pages
  // still serve by the unit's own prefix as a
  // safety net (a stale cached list from another provider must not 404).
  // activeMangaProvider is the fallback only when the prefix names an
  // unknown/disabled provider.
  // NOTE: pages are keyed per chapter — do NOT clear on chapter change
  // (clearing causes a pages=null render that resets effects keyed on
  // pages.length and drops in-flight resume state).
  const [pages, setPages] = useState<MangaPage[] | null>(null)
  const [pagesError, setPagesError] = useState<string | null>(null)
  const [pagesLoading, setPagesLoading] = useState(false)
  const pagesByChapterRef = useRef<Map<string, MangaPage[]>>(new Map())

  // READER PAGE READINESS — the navbar's scroll bar is only meaningful once
  // the document has stopped growing. Every page image reports load/error
  // here; when the whole chapter has resolved, publish `aeri:reader-pages`
  // (plus a dataset mirror) so Navbar starts painting the fill. Errors
  // count as resolved: a page that will never load must not freeze the bar
  // forever. A fresh tracker per page list (useMemo, keyed on `pages`)
  // means a chapter change re-arms the gate; no render-time ref writes.
  const publishReaderPages = useCallback((ready: boolean) => {
    try { document.documentElement.dataset.readerPagesReady = ready ? '1' : '0' } catch {}
    try { window.dispatchEvent(new CustomEvent('aeri:reader-pages', { detail: { ready } })) } catch {}
  }, [])
  const readiness = useMemo(() => ({ resolved: new Set<number>(), ready: false }), [pages])
  const markPageResolved = useCallback((index: number, url: string) => {
    // A late load from the previous chapter must never count toward the
    // current one — only a page whose URL still exists at this index does.
    if (!pages || !pages.some(p => p.index === index && p.url === url)) return
    readiness.resolved.add(index)
    if (!readiness.ready && readiness.resolved.size >= pages.length) {
      readiness.ready = true
      publishReaderPages(true)
    }
  }, [pages, readiness, publishReaderPages])
  useLayoutEffect(() => {
    publishReaderPages(pages != null && pages.length > 0 && readiness.resolved.size >= pages.length)
    return () => publishReaderPages(false)
  }, [pages, readiness, publishReaderPages])
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
    // Cross-provider guard: the URL chapter param must belong to the
    // resolved list. A raw id from another title/provider (stale
    // bookmark, hand-typed URL) resolves pages against the WRONG series —
    // fail closed instead.
    if (chapters && !chapters.some(c => c.providerChapterId === currentChapter.providerChapterId && c.id === currentChapter.id)) {
      setPagesError('Chapter not found in this title.')
      setPagesLoading(false)
      return
    }
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
  }, [currentChapter?.providerChapterId, currentChapter?.id, chapters, activeMangaProvider])

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
    // GUEST MODE: no saved position is read — a signed-out reader always
    // opens at the top of the chapter (fully fresh, like incognito).
    if (!manga || !isAuthenticated) return
    let cancelled = false
    getReadPos(manga.identity.internalId.replace(/^read:/, '')).then(pos => {
      if (cancelled || !pos) return
      setResume({ chapterId: pos.chapterId, page: pos.page })
    }).catch(() => {})
    return () => { cancelled = true }
  }, [manga?.identity.internalId, chapterParam, isAuthenticated])

  // Tracker progress sync (chapter-based): mark chapter read once the user
  // reaches the last page. Fires once per chapter.
  const completedRef = useRef(false)
  useEffect(() => { completedRef.current = false }, [currentChapter?.providerChapterId])

  // PROGRESS VALIDITY: a tracker write requires a
  // properly loaded manga — at least one tracker id, a real chapter number,
  // provider pages, and a chapter inside the known total when one exists.
  // Broken/partial records write NOTHING (that was the reported bug).
  const canTrackChapter = Boolean(
    manga &&
    currentChapter &&
    currentChapter.number != null &&
    Number.isFinite(currentChapter.number) &&
    (manga.identity.anilistId != null || manga.identity.malId != null) &&
    (manga.chapters == null || manga.chapters <= 0 || currentChapter.number <= manga.chapters) &&
    (pages?.length ?? 0) > 0,
  )

  // opening a chapter puts the title in Reading — status
  // + start date — even when the chapter is unfinished (the "I started this"
  // signal, separate from chapter completion). Written once per open, only
  // when the entry isn't already Watching. Incognito suppresses it.
  const trackingStatus = trackingEntry?.status ?? manga?.listStatus ?? null
  const autoWatchingRef = useRef(false)
  useEffect(() => {
    if (!manga || !canTrackChapter || !isAuthenticated) return
    if (autoWatchingRef.current || trackingStatus === 'watching') return
    if (isIncognitoEnabled()) return
    autoWatchingRef.current = true
    updateStatus(manga, 'watching').catch(() => { autoWatchingRef.current = false })
  }, [manga, canTrackChapter, isAuthenticated, trackingStatus, updateStatus])

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
    // GUEST MODE (owner 2026-10-28): signed-out reading is a fresh session —
    // no read position is written. Tracker progress is already gated below.
    if (!isAuthenticated) return
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
      // The serving provider (unit's own prefix), not the resolver winner —
      // resume must reopen the same pages, not the winner's equivalent.
      provider: currentChapter.id.split('-')[0] || 'unknown',
      page: pageRef.current,
      maxPage: pages.length,
      updatedAt: now,
    }).catch(() => {})
    // Reached ~80% of the chapter → counts as read for the tracker
    // (+1 chapter). Discrete pages: furthest page >= 80% of the page count.
    // Invalid/partial records never reach this branch (canTrackChapter).
    // never REGRESS the tracker — rereading chapter 3
    // while progress is 12 must leave progress at 12. Only a not-yet-counted
    // chapter advances it.
    const readThreshold = Math.max(1, Math.ceil(pages.length * 0.8))
    const chapterNumber = currentChapter.number
    const trackedProgress = trackingEntry?.progress ?? manga.progress?.episode ?? 0
    if (isAuthenticated && canTrackChapter && !completedRef.current && chapterNumber != null && chapterNumber > trackedProgress && pageRef.current + 1 >= readThreshold) {
      completedRef.current = true
      updateProgress(manga, chapterNumber).catch(() => {})
    }
  }, [manga, currentChapter, pages?.length, isAuthenticated, updateProgress, canTrackChapter, trackingEntry?.progress])
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
  // Resume scroll: after pages render, jump ONCE to the saved page.
  // The old implementation retried `scrollIntoView` every 800ms (up to 16
  // times) while images below resolved — each retry yanked the viewport
  // again, so opening a chapter "scrolled along" with the loading pages.
  // Now the jump is readiness-gated: wait until the target exists AND every
  // page ABOVE it has resolved (their heights are final, so one scroll lands
  // where the saved page really is), then scroll exactly once. A 3s ceiling
  // keeps a stalled image from blocking the resume forever, and any real
  // user gesture (wheel / touch / key) cancels the jump so the reader never
  // fights the reader.
  const resumeDoneRef = useRef(false)
  const resumeRef = useRef<{ chapterId: string; page: number } | null>(null)
  useEffect(() => { resumeRef.current = resume }, [resume])
  useEffect(() => { resumeDoneRef.current = false }, [currentChapter?.providerChapterId])
  useEffect(() => {
    if (resumeDoneRef.current || !pages?.length) return
    const saved = resumeRef.current
    if (!saved || saved.chapterId !== currentChapter?.providerChapterId || saved.page <= 0) return
    const target = Math.min(saved.page, pages.length - 1)
    let raf = 0
    let done = false
    const startedAt = performance.now()
    const stop = () => {
      done = true
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      window.removeEventListener('wheel', onUserIntent, true)
      window.removeEventListener('touchmove', onUserIntent, true)
      window.removeEventListener('keydown', onUserIntent, true)
    }
    function onUserIntent() {
      // The reader took over: never move the viewport under them.
      if (done) return
      resumeDoneRef.current = true
      stop()
    }
    const tick = () => {
      raf = 0
      if (done) return
      const el = pageElsRef.current.get(target)
      let aboveReady = true
      for (let i = 0; i < target; i++) {
        if (!readiness.resolved.has(i)) { aboveReady = false; break }
      }
      const timedOut = performance.now() - startedAt > 3000
      if (el && (aboveReady || timedOut)) {
        resumeDoneRef.current = true
        // Instant, not smooth: the jump must be a single placement, never an
        // animation that reads as the reader scrolling by itself.
        el.scrollIntoView({ block: 'start', behavior: 'instant' })
        pageRef.current = target
        maxPageRef.current = Math.max(maxPageRef.current, target)
        stop()
        return
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    window.addEventListener('wheel', onUserIntent, { capture: true, passive: true })
    window.addEventListener('touchmove', onUserIntent, { capture: true, passive: true })
    window.addEventListener('keydown', onUserIntent, true)
    return stop
  }, [pages?.length, currentChapter?.providerChapterId, readiness, resume])
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
          <Link to="/manga" className={`${pillSolid} mt-6`}>Back to Manga</Link>
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
          <Link to={`/anime/${id}`} state={{ background: { pathname: location.pathname, search: location.search } }} className={`${pillSolid} mt-6`}>Open anime page</Link>
        </div>
      </div>
    )
  }

  const prefs = getPreferences()
  const fit = prefs.readerFit ?? 'width'

  // Which provider serves THIS chapter's pages. Merged lists mix providers,
  // so the winner alone is misleading — the unit's own id prefix is the
  // truth. Unknown prefix (stale cache) shows nothing rather than a guess.
  // This rides on the chapter pill as a `· Provider` suffix (the standalone
  // "Source: …" line is gone).
  const chapterProvider = (() => {
    const prov = currentChapter?.id.split('-')[0] || ''
    return prov === 'mangadex' ? 'MangaDex'
      : prov === 'weebcentral' ? 'WeebCentral'
      : prov === 'mangapill' ? 'MangaPill'
      : prov === 'mangahere' ? 'MangaHere'
      : prov === 'bato1' ? 'Bato1'
      : prov === 'kakalot' ? 'Kakalot'
      : prov === 'mangaread' ? 'MangaRead'
      : ''
  })()

  return (
    <div className="mx-auto max-w-[800px] px-4 pb-16 sm:px-6">
      {/* Header */}
      <div data-testid="reader-header" className="flex items-center gap-3 py-4">
        <Link to="/manga" aria-label="Back to Manga" className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-[var(--text-muted)] hover:bg-[color-mix(in_srgb,var(--text)_10%,transparent)] hover:text-[var(--text)]">
          <Icon name="chevron-left" size={16} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-semibold text-[var(--text)]">{titles.primary}</h1>
          {/* Chapter + serving provider: the subtitle carries
              `Chapter 1 · WeebCentral` — chapter, middle dot, provider. The
              chapter picker lives on the nav rows, next to prev/next. */}
          <p className="truncate text-xs text-[var(--text-faint)]">
            {currentChapter
              ? `${unitDisplayLabel(currentChapter)}${chapterProvider ? ` · ${chapterProvider}` : ''}`
              : 'Loading chapters…'}
          </p>
        </div>
      </div>

      {/* Requested unit missing (skip-numbered list, or a chapter id that
          belonged to a source we no longer resolve): say so, and land on a
          readable unit instead of a dead reader. */}
      {chapterFallbackNotice && currentChapter && (
        <p className="pb-3 text-[11px] leading-5 text-[var(--text-muted)]">
          {/^ch-/.test(chapterFallbackNotice) ? 'That chapter' : 'That chapter link'} isn&apos;t in this source&apos;s list — opened{' '}
          <span className="text-[var(--text)]">{unitDisplayLabel(currentChapter)}</span> instead.
        </p>
      )}

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
                  <a key={i} href={u.url} target="_blank" rel="noopener noreferrer" className={pillSoft}>{u.label}</a>
                ))}
              </div>
            </div>
          ) : (
            <p className="mt-1 text-xs text-[var(--text-faint)]">The publisher hosts these chapters off-site (licensed).</p>
          )}
        </div>
      )}

      {/* Prev / picker / next (top) — always both sides, picker centred */}
      {currentChapter && (
        <div className="mb-4">
          <ChapterNavButtons
            id={id}
            prevChapter={prevChapter}
            nextChapter={nextChapter}
            chapters={orderedChapters ?? []}
            currentChapter={currentChapter}
            testId="chapter-nav-top"
          />
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
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <button onClick={() => window.location.reload()} className={pillSoft}>Retry</button>
            {currentChapter && !/^(first|latest)$/.test(chapterParam) && (
              <button onClick={() => navigate(`/read/${id}/first`)} className={pillSoft}>Start from chapter 1</button>
            )}
          </div>
        </div>
      )}
      {/* A provider that answers 200 with zero pages used to render NOTHING —
          a blank reader with no explanation (the second half of the "chapter
          not found" reports). Name the unit and offer the way out. */}
      {pages && pages.length === 0 && !pagesLoading && !pagesError && currentChapter && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--text)]/[0.03] px-4 py-6 text-center">
          <p className="text-sm text-[var(--text-muted)]">
            {unitDisplayLabel(currentChapter)} has no pages on this source right now.
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            {nextChapter && (
              <button onClick={() => navigate(`/read/${id}/${encodeURIComponent(nextChapter.providerChapterId)}`)} className={pillSolid}>
                Next chapter
              </button>
            )}
            <button onClick={() => navigate(`/read/${id}/first`)} className={pillSoft}>
              Start from chapter 1
            </button>
          </div>
        </div>
      )}
      {pages && pages.length > 0 && (
        <div className="flex flex-col items-center gap-0">
          {pages.map(p => (
            <MangaPageImage
              key={p.index}
              page={p}
              fit={fit}
              isLast={p.index === pages[pages.length - 1].index}
              register={el => { if (el) pageElsRef.current.set(p.index, el); else pageElsRef.current.delete(p.index) }}
              onResolved={markPageResolved}
            />
          ))}
        </div>
      )}

      {/* End-of-chapter nav (bottom) — same three cells; 16px below the last
          page, matching the 16px between the top nav and the first page. */}
      {pages && pages.length > 0 && (
        <div className="mt-4">
          <ChapterNavButtons
            id={id}
            prevChapter={prevChapter}
            nextChapter={nextChapter}
            chapters={orderedChapters ?? []}
            currentChapter={currentChapter}
            testId="chapter-nav-bottom"
          />
        </div>
      )}

      {/* Synopsis — same block as Watch, above the related rail. */}
      <div className="mt-10 max-w-[720px]">
        <h2 className="mb-2 text-sm font-semibold text-[var(--text)]">Synopsis</h2>
        <p className="text-sm leading-6 text-[var(--text-muted)]">{manga.description || 'No description available.'}</p>
      </div>

      {/* Related — anime adaptations first (the most common reason a reader
          looks sideways), then manga. Both rails read the SAME relations
          list; RelatedRow splits it by each node's own format, so an entry
          can never appear in the wrong rail or open on the wrong route. */}
      {manga.identity.anilistId && (
        <ReadRelatedRows anilistId={manga.identity.anilistId} relations={manga.relations} />
      )}
    </div>
  )
}

function ReadRelatedRows({ anilistId, relations }: { anilistId: number; relations: import('../types/anime').Anime['relations'] }) {
  const { entries, loading } = useRelatedEntries(`page-manga-${anilistId}:${anilistId}`, relations, 'MANGA')
  return (
    <>
      <RelatedRow entries={entries} loading={loading} mediaKind="anime" title="Related Anime" className="mt-12" />
      <RelatedRow entries={entries} loading={loading} mediaKind="manga" title="Related Manga" className="mt-12" />
    </>
  )
}

function MangaPageImage({ page, fit, isLast, register, onResolved }: { page: MangaPage; fit: string; isLast: boolean; register: (el: HTMLElement | null) => void; onResolved: (index: number, url: string) => void }) {
  const [failed, setFailed] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  // Reports are idempotent in the parent (a Set + a ready flag), so the
  // image can report on every load / complete check without local state.
  const markResolved = () => onResolved(page.index, page.url)
  return (
    <div
      ref={register as any}
      data-page-index={page.index}
      className={`relative w-full overflow-hidden bg-[var(--surface)] ${page.index === 0 ? 'rounded-t-lg' : ''} ${isLast ? 'rounded-b-lg' : ''}`}
      style={{ minHeight: 400 }}
    >
      {!failed ? (
        <img
          key={retryKey}
          ref={el => {
            // A cached image can already be complete before the load event
            // is dispatched; count it now rather than waiting for an event
            // that may never arrive.
            if (el?.complete && el.naturalWidth > 0) markResolved()
          }}
          src={page.url}
          alt={`Page ${page.index + 1}`}
          // EAGER on every page: lazy images below the fold never load until
          // scrolled, so "all pages loaded" (the navbar bar gate) would never
          // become true and the bar would stay dead for the whole chapter.
          loading="eager"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={markResolved}
          onError={() => { setFailed(true); markResolved() }}
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
