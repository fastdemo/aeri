import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import type { Anime } from '../../types/anime'
import { useTracking } from '../../contexts/TrackingContext'
import { useAnimeDetail, useMangaDetail } from '../../hooks/useAnimeMetadata'
import { detailSurface, type DetailNavState } from '../../hooks/useDetailOpen'
import { isCompleteRecord } from '../../lib/records'
import { DetailModal } from './DetailModal'
import { Icon } from '../ui/Icon'
import { pillSolid, pillSoft } from '../ui/buttonStyles'

/**
 * AUTO-RETRY LADDER (owner rule 2026-10-18: never paint a half-populated
 * card). When the enrichment fetch is parked behind AniList's shared 429
 * cooldown and the card holds nothing complete, retry QUIETLY on this
 * ladder instead of falling through to the lite copy. THROTTLED fail-fasts
 * cost no network (the client refuses to send while cooling), so the ladder
 * is free; the first attempt after the cooldown lifts carries the full
 * record. Bounded: past the cap the best-held record paints (rare last
 * resort) and the manual Retry button still exists.
 */
const THROTTLE_RETRY_MS = 5000
const MAX_AUTO_RETRIES = 12 // ~60s ≈ the shared cooldown window

/**
 * The route-driven floating card. /anime/:id and /manga/:id render THIS
 * (not the old standalone page): the card floats over the page it was
 * opened from, and deep links float it over Home by default (owner
 * decision). Replaces src/pages/AnimeDetail.tsx entirely — the modal
 * holds every feature the page had (episodes, metadata sidebar, related
 * grid) plus Resume + tracker editing, which the page never had.
 *
 * Resolution order: the fully-populated record that rode in with the
 * navigation (card click — instant, no refetch) → the tracking list copy
 * (covers 'mal-…' ids the AniList detail query cannot resolve) → the
 * type-scoped AniList Media fetch (deep links, shared URLs, stripped
 * history state).
 */
export function DetailRoute({ kind }: { kind: 'anime' | 'manga' }) {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const { isAuthenticated, combinedList } = useTracking()
  // The record that rode in with THIS history entry — read fresh on every
  // render, never frozen in instance state. A related swap pushes the SAME
  // route instance (React Router reconciles identical elements; no remount
  // when only the :id param changes), so an entry carried in useState would
  // forever show the first record behind a silently-updated URL. Reading
  // location.state per render gives: related swap → new record instantly;
  // Back/Forward → each history entry restores its own record; deep links
  // (no state) fall through to the list copy / type-scoped fetch.
  const navState = (location.state ?? null) as DetailNavState | null
  const carriedAnime = navState?.anime ?? null

  // List-copy lookup when the card rode in empty (covers 'mal-…' ids).
  const fromList = useMemo(() => {
    if (carriedAnime || !id || !combinedList) return null
    const found = combinedList.find((e) => {
      const x = e.anime.identity
      if ((detailSurface(e.anime) === 'manga') !== (kind === 'manga')) return false
      if (x.internalId === id) return true
      return (x.anilistId?.toString() ?? '') === id.replace(/^anilist-/, '')
    })
    return found?.anime ?? null
  }, [carriedAnime, id, combinedList, kind])

  // Fetch whenever the best available record is incomplete (lite list rows,
  // related tiles, deep links). Complete rail records skip the network
  // entirely — the common row-click open stays instant. retryNonce re-runs
  // that fetch IN PLACE for the Retry button: the card must never reload
  // the page (owner report 2026-10-18 — window.location.reload() here was
  // a real full-refresh path in the exact open→fail→retry flow).
  const [retryNonce, setRetryNonce] = useState(0)
  const fetchId = isCompleteRecord(carriedAnime) ? undefined : id
  const animeQuery = useAnimeDetail(kind === 'anime' ? fetchId : undefined, retryNonce)
  const mangaQuery = useMangaDetail(kind === 'manga' ? fetchId : undefined, retryNonce)
  const fetched = kind === 'anime' ? animeQuery.data : mangaQuery.data
  const loading = kind === 'anime' ? animeQuery.loading : mangaQuery.loading
  const loadError = kind === 'anime' ? animeQuery.error : mangaQuery.error
  const errorCode = kind === 'anime' ? animeQuery.errorCode : mangaQuery.errorCode

  // Prefer any COMPLETE record (a fetched full record beats a lite carried
  // or list copy — the card upgrades in place once the full record lands);
  // otherwise paint the best available, so a failed enrichment still renders
  // a real card instead of an error wall.
  const resolved =
    [carriedAnime, fetched, fromList].find(isCompleteRecord) ??
    carriedAnime ?? fromList ?? fetched ?? null
  const hasBackground = !!navState?.background

  // Quiet throttle ladder: re-run the enrichment fetch every few seconds
  // while the cooldown is armed and nothing complete is on hand yet.
  // resetNonce keeps the ladder from compounding the manual retry count.
  const [autoRetries, setAutoRetries] = useState(0)
  const autoNonceRef = useRef(0)
  useEffect(() => { setAutoRetries(0); autoNonceRef.current = 0 }, [id])
  const throttleHold = errorCode === 'THROTTLED' && !isCompleteRecord(resolved) && autoRetries < MAX_AUTO_RETRIES
  useEffect(() => {
    if (!throttleHold) return
    const t = setTimeout(() => {
      autoNonceRef.current += 1
      setAutoRetries(n => n + 1)
      setRetryNonce(() => autoNonceRef.current)
    }, THROTTLE_RETRY_MS)
    return () => clearTimeout(t)
  }, [throttleHold, retryNonce])

  // Members-only, same policy the standalone page had — but the signed-out
  // visitor now lands on Home WITH the sign-in popup open (owner decision),
  // via a ?signin=1 hop Home reacts to once.
  useEffect(() => {
    if (isAuthenticated) return
    navigate('/?signin=1', { replace: true })
  }, [isAuthenticated, navigate])

  const close = useCallback(() => {
    // Pushed from in-app → hand the history entry back (Back semantics).
    // Deep link → no page behind to return to; land on Home cleanly.
    if (hasBackground) navigate(-1)
    else navigate('/', { replace: true })
  }, [hasBackground, navigate])

  // Related cards swap the card in place: replace keeps ONE history entry
  // for the whole modal session (Back always closes, never walks a pile),
  // and the original background survives so close still returns to it.
  const openRelated = useCallback(
    (next: Anime) => {
      const surface = detailSurface(next) === 'manga' ? '/manga' : '/anime'
      navigate(`${surface}/${next.identity.internalId}`, {
        replace: true,
        state: { background: navState?.background, anime: next } satisfies DetailNavState,
      })
    },
    [navigate, navState?.background],
  )

  // Signed-out: nothing renders — the redirect effect above handles it.
  if (!isAuthenticated) return null

  if (!resolved) {
    if (loading || throttleHold) {
      return (
        <DetailPanel onClose={close}>
          <DetailSkeleton />
        </DetailPanel>
      )
    }
    return (
      <DetailPanel onClose={close}>
        <div className="flex min-h-[280px] flex-col items-center justify-center gap-3 px-6 py-12 text-center">
          <p className="text-sm font-medium text-[var(--text)]">{loadError ? 'Something went wrong.' : 'Title not found.'}</p>
          <p className="max-w-[420px] text-xs leading-5 text-[var(--text-muted)]">
            {loadError ?? `No ${kind === 'manga' ? 'manga' : 'anime'} matches this URL. It may have been removed or the link is stale.`}
          </p>
          <div className="mt-2 flex items-center gap-2">
            {loadError && (
              <button
                onClick={() => setRetryNonce(n => n + 1)}
                className={pillSoft}
              >
                Retry
              </button>
            )}
            <button
              onClick={close}
              className={pillSolid}
            >
              {hasBackground ? 'Back' : 'Back to Home'}
            </button>
          </div>
        </div>
      </DetailPanel>
    )
  }

  // READY GATE (owner rule): a record that fails the completeness test
  // (lite list copy, related tile) holds the skeleton while its enrichment
  // fetch runs; when the fetch settles, the best record we hold paints even
  // if incomplete — the card never blocks forever, and it never shows a
  // half-populated card that then fills in piece by piece. THROTTLED is
  // the one exception: while the ladder is running, hold the skeleton —
  // the cooldown is the only thing between the card and its final record.
  if ((!isCompleteRecord(resolved) && loading) || (!isCompleteRecord(resolved) && throttleHold)) {
    return (
      <DetailPanel onClose={close}>
        <DetailSkeleton />
      </DetailPanel>
    )
  }

  // DetailModal renders its own overlay + backdrop + Esc handling, so it
  // mounts bare — DetailPanel geometry above is only for the loading and
  // error states so the handoff is visually identical.
  return (
    <DetailModal
      key={resolved.identity.internalId}
      anime={resolved}
      onClose={close}
      onSelectRelated={openRelated}
    />
  )
}

/** Card-shaped skeleton body (hero band + text row + two-column layout).
 * Shared by the loading state and the ready-gate hold so both mirror the
 * floating card's geometry exactly — no spinners. */
function DetailSkeleton() {
  return (
    <>
      {/* Skeleton mirrors the floating card: hero band + text row +
          two-column body. No spinners. */}
      <div className="relative h-[360px] w-full sm:h-[420px] animate-pulse rounded-t-xl bg-[color-mix(in_srgb,var(--text)_5%,transparent)]" />
      <div className="grid gap-6 px-4 py-5 sm:px-6 lg:grid-cols-[1.7fr_0.9fr]">
        <div className="h-24 animate-pulse rounded bg-[color-mix(in_srgb,var(--text)_5%,transparent)]" />
        <div className="hidden h-40 animate-pulse rounded bg-[color-mix(in_srgb,var(--text)_5%,transparent)] lg:block" />
        <div className="h-64 animate-pulse rounded bg-[color-mix(in_srgb,var(--text)_5%,transparent)]" />
        <div className="hidden h-64 animate-pulse rounded bg-[color-mix(in_srgb,var(--text)_5%,transparent)] lg:block" />
      </div>
    </>
  )
}

/**
 * Shared shell for the route's non-modal states (skeleton / error). Mirrors
 * DetailModal's overlay geometry so the handoff is seamless.
 */
function DetailPanel({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    // Same click-out-anywhere mechanics as DetailModal (owner 2026-10-20):
    // the veil closes the card directly instead of a fixed backdrop button
    // that the scroller's backdrop-filter traps in content coordinates.
    <div onClick={onClose} className="fixed inset-x-0 bottom-0 top-14 z-40 flex items-start justify-center overflow-y-auto bg-[color-mix(in_srgb,var(--bg)_75%,transparent)] p-2 backdrop-blur-[2px] anim-fade-in sm:p-6 lg:p-8">
      <div onClick={(e) => e.stopPropagation()} className="relative my-2 w-full max-w-[980px] overflow-hidden rounded-xl bg-[var(--bg-soft)] shadow-[0_24px_64px_var(--shadow)] anim-pop-in-center sm:my-6">
        <button
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 z-20 grid h-8 w-8 place-items-center rounded-full bg-[color-mix(in_srgb,var(--bg)_60%,transparent)] text-[var(--text)] backdrop-blur hover:bg-[color-mix(in_srgb,var(--bg)_80%,transparent)]"
        >
          <Icon name="x" size={14} />
        </button>
        {children}
      </div>
    </div>
  )
}
