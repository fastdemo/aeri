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
  const { isAuthenticated, combinedList } = useTracking()
  const { user: anilistUser } = useAniList()
  const { user: malUser } = useMAL()
  const navigate = useNavigate()
  const user = anilistUser ?? malUser ?? null
  const stats = useMemo(() => {
    const list = combinedList ?? []
    const byStatus = (s: string) => list.filter(e => e.status === s).length
    const scores = list.map(e => e.score ?? 0).filter(s => s > 0)
    const mean = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null
    const eps = list.reduce((a, e) => a + (e.progress ?? 0), 0)
    return { total: list.length, watching: byStatus('watching'), completed: byStatus('completed'), planned: byStatus('planned'), mean, eps }
  }, [combinedList])
  if (!isAuthenticated) {
    return <Navigate to="/" replace />
  }
  return (
    <div className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6">
      <div className="flex items-center gap-4">
        {user?.avatar?.large ? (
          <img src={user.avatar.large} alt={user.name ?? 'Profile'} className="h-16 w-16 rounded-full object-cover" loading="lazy" />
        ) : (
          <div className="grid h-16 w-16 place-items-center rounded-full bg-[color-mix(in_srgb,var(--text)_10%,transparent)] text-lg font-bold text-[var(--text)]">
            {(user?.name ?? '?').slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-[18px] font-semibold tracking-tight text-[var(--text)]">{user?.name ?? 'Profile'}</h1>
          <p className="text-xs text-[var(--text-faint)]">
            {stats.total} in list • {stats.watching} watching • {stats.completed} completed
            {stats.mean != null ? ` • mean ${formatRating(stats.mean) ?? stats.mean}` : ''} • {stats.eps} episodes watched
          </p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Watching', value: stats.watching },
          { label: 'Completed', value: stats.completed },
          { label: 'Planned', value: stats.planned },
          { label: 'Episodes', value: stats.eps },
        ].map(s => (
          <div key={s.label} className="rounded-xl border border-[var(--border)] bg-[var(--text)]/[0.02] p-4">
            <p className="text-xl font-semibold text-[var(--text)]">{s.value}</p>
            <p className="mt-0.5 text-xs text-[var(--text-faint)]">{s.label}</p>
          </div>
        ))}
      </div>

      {(combinedList ?? []).filter(e => e.status === 'watching').length > 0 && (
        <div className="mt-8">
          <ContentRow title="Currently watching" subtitle={`${(combinedList ?? []).filter(e => e.status === 'watching').length} titles`}>
            {(combinedList ?? []).filter(e => e.status === 'watching').slice(0, 12).map(e => (
              <div key={e.anime.identity.internalId} className="w-[200px] shrink-0 snap-start sm:w-[240px]">
                <AnimeCard anime={e.anime} onSelect={(a) => navigate(`/anime/${a.identity.anilistId ? `anilist-${a.identity.anilistId}` : a.identity.internalId}`)} variant="continue" />
              </div>
            ))}
          </ContentRow>
        </div>
      )}

      <div className="mt-8 flex gap-2">
        <Link
          to="/list"
          className="rounded-full bg-[var(--text)] px-5 py-2 text-sm font-semibold text-[var(--on-text)] hover:bg-[color-mix(in_srgb,var(--text)_90%,transparent)]"
        >
          My List
        </Link>
        <Link
          to="/settings"
          className="rounded-full bg-[color-mix(in_srgb,var(--text)_10%,transparent)] px-5 py-2 text-sm font-medium text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--text)_15%,transparent)]"
        >
          Settings
        </Link>
      </div>
    </div>
  )
}
