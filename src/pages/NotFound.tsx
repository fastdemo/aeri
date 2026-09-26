import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useMemo } from 'react'
import { useTracking } from '../contexts/TrackingContext'
import { useAniList } from '../contexts/AniListContext'
import { useMAL } from '../contexts/MALContext'
import { AnimeCard } from '../components/cards/AnimeCard'
import { ContentRow } from '../components/rows/ContentRow'
import { formatRating } from '../lib/rating'

export function NotFound() {
  return (
    <div className="mx-auto grid max-w-[1200px] place-items-center px-4 py-24 text-center sm:px-6">
      <div>
        <p className="text-5xl font-semibold tracking-tight text-[var(--text)]">404</p>
        <p className="mt-3 text-sm font-medium text-[var(--text)]">Page not found</p>
        <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-[var(--text-faint)]">
          The page you&apos;re looking for doesn&apos;t exist or may have been moved.
        </p>
        <Link
          to="/"
          className="mt-6 inline-block rounded-full bg-[var(--text)] px-5 py-2 text-sm font-semibold text-[var(--on-text)] hover:bg-[color-mix(in_srgb,var(--text)_90%,transparent)]"
        >
          Go home
        </Link>
      </div>
    </div>
  )
}

export function MangaPlaceholder() {
  return (
    <div className="mx-auto grid max-w-[1200px] place-items-center px-4 py-24 text-center sm:px-6">
      <div>
        <p className="text-sm font-medium text-[var(--text)]">Manga</p>
        <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-[var(--text-faint)]">
          Manga support is coming soon. Anime discovery, tracking and watching are unaffected.
        </p>
        <Link
          to="/"
          className="mt-6 inline-block rounded-full bg-[var(--text)] px-5 py-2 text-sm font-semibold text-[var(--on-text)] hover:bg-[color-mix(in_srgb,var(--text)_90%,transparent)]"
        >
          Go home
        </Link>
      </div>
    </div>
  )
}

export function ProfilePlaceholder() {
  const { isAuthenticated, combinedList, trackingProvider } = useTracking()
  const { user: anilistUser } = useAniList()
  const { user: malUser } = useMAL()
  const navigate = useNavigate()
  // Avatar + name follow the ACTIVE tracker (switching MAL/AniList swaps
  // both). combinedList + stats below already derive from the same source.
  const user = trackingProvider === 'mal' ? (malUser ?? anilistUser) : (anilistUser ?? malUser)
  const trackerName = trackingProvider === 'mal' ? 'MyAnimeList' : 'AniList'
  const stats = useMemo(() => {
    // PROFILE RULE: anime only — same boundary as Home + My List tab.
    const list = (combinedList ?? []).filter(e => {
      const mt = e.anime.identity.mediaType
      if (mt) return mt === 'ANIME'
      return !['MANGA', 'NOVEL', 'ONE_SHOT'].includes((e.anime.format ?? '').toUpperCase())
    })
    const byStatus = (s: string) => list.filter(e => e.status === s).length
    const scores = list.map(e => e.score ?? 0).filter(s => s > 0)
    const mean = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null
    const eps = list.reduce((a, e) => a + (e.progress ?? 0), 0)
    return { total: list.length, watching: byStatus('watching'), completed: byStatus('completed'), planned: byStatus('planned'), mean, eps, watchingList: list.filter(e => e.status === 'watching') }
  }, [combinedList])
  if (!isAuthenticated) {
    return <Navigate to="/" replace />
  }
  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-12 lg:py-8">
      {/* Header: avatar + name + tracker + stats inline (no dead space) */}
      <div className="flex flex-wrap items-center gap-4 sm:gap-5">
        {user?.avatar?.large ? (
          <img src={user.avatar.large} alt={user.name ?? 'Profile'} className="h-16 w-16 shrink-0 rounded-full object-cover sm:h-20 sm:w-20" loading="lazy" />
        ) : (
          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--text)_10%,transparent)] text-lg font-bold text-[var(--text)] sm:h-20 sm:w-20">
            {(user?.name ?? '?').slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[20px] font-semibold tracking-tight text-[var(--text)] sm:text-[24px]">{user?.name ?? 'Profile'}</h1>
          <p className="mt-0.5 text-xs text-[var(--text-faint)] sm:text-[13px]">
            {trackerName}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              to="/list"
              className="rounded-full bg-[var(--text)] px-4 py-1.5 text-xs font-semibold text-[var(--on-text)] hover:bg-[color-mix(in_srgb,var(--text)_90%,transparent)]"
            >
              My List
            </Link>
            <Link
              to="/settings"
              className="rounded-full bg-[color-mix(in_srgb,var(--text)_10%,transparent)] px-4 py-1.5 text-xs font-medium text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--text)_15%,transparent)]"
            >
              Settings
            </Link>
          </div>
        </div>
      </div>

      {/* Statistics (kept, same numbers) */}
      <section aria-label="Statistics" className="mt-6">
        <h2 className="mb-2 text-[14px] font-semibold text-[var(--text)]">Statistics</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {[
            { label: 'Watching', value: stats.watching },
            { label: 'Completed', value: stats.completed },
            { label: 'Planned', value: stats.planned },
            { label: 'Episodes', value: stats.eps },
            { label: 'Total', value: stats.total },
            { label: 'Mean score', value: stats.mean != null ? (formatRating(stats.mean) ?? stats.mean) : '—' },
          ].map(s => (
            <div key={s.label} className="rounded-xl border border-[var(--border)] bg-[var(--text)]/[0.02] p-4">
              <p className="text-xl font-semibold text-[var(--text)]">{s.value}</p>
              <p className="mt-0.5 text-xs text-[var(--text-faint)]">{s.label}</p>
            </div>
          ))}
        </div>
      </section>

      {stats.watching > 0 ? (
        <div className="mt-8">
          <ContentRow title="Currently watching" subtitle={`${stats.watching} titles`}>
            {stats.watchingList.slice(0, 12).map(e => (
              <div key={e.anime.identity.internalId} className="w-[200px] shrink-0 snap-start sm:w-[240px]">
                <AnimeCard anime={e.anime} onSelect={(a) => navigate(`/anime/${a.identity.anilistId ? `anilist-${a.identity.anilistId}` : a.identity.internalId}`)} variant="continue" />
              </div>
            ))}
          </ContentRow>
        </div>
      ) : (
        <div className="mt-8 rounded-xl border border-[var(--border)] bg-[var(--text)]/[0.02] px-4 py-8 text-center">
          <p className="text-sm font-medium text-[var(--text)]">Nothing in progress</p>
          <p className="mt-1 text-xs text-[var(--text-faint)]">Titles you mark as watching will appear here.</p>
          <Link
            to="/anime"
            className="mt-4 inline-block rounded-full bg-[var(--text)] px-5 py-2 text-xs font-semibold text-[var(--on-text)] hover:bg-[color-mix(in_srgb,var(--text)_90%,transparent)]"
          >
            Browse anime
          </Link>
        </div>
      )}
    </div>
  )
}
