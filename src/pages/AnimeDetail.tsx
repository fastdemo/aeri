import { useParams, Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { mockAnime } from '../data/mockAnime'
import { EpisodeList } from '../components/episodes/EpisodeList'
import { useAniList } from '../contexts/AniListContext'
import { aniListProvider } from '../providers/anilist/provider'
import type { Anime } from '../types/anime'

export function AnimeDetail() {
  const { id } = useParams<{ id: string }>()
  const { animeList } = useAniList()
  const [remote, setRemote] = useState<Anime | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const mock = id ? mockAnime.find((a) => a.identity.internalId === id) : null
  const fromList = id ? animeList?.find((e) => e.anime.identity.internalId === id || e.anime.identity.anilistId?.toString() === id || `anilist-${e.anime.identity.anilistId}` === id)?.anime : null

  useEffect(() => {
    if (mock || fromList || !id) return
    // Try to fetch via AniList if id looks like anilist-
    const isAnilist = id.startsWith('anilist-') || /^\d+$/.test(id)
    if (!isAnilist) return
    setLoading(true)
    setErr(null)
    aniListProvider
      .getAnime(id)
      .then(setRemote)
      .catch((e) => setErr(e instanceof Error ? e.message : 'Not found'))
      .finally(() => setLoading(false))
  }, [id, mock, fromList])

  const anime = fromList ?? mock ?? remote

  if (loading) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-16">
        <div className="h-[420px] animate-pulse rounded-xl bg-white/5" />
      </div>
    )
  }
  if (err) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-16 text-center">
        <p className="text-amber-200/80">{err}</p>
        <Link to="/" className="mt-4 inline-block text-sm text-white/60 underline">Back</Link>
      </div>
    )
  }
  if (!anime) {
    return (
      <div className="mx-auto max-w-[1200px] px-4 py-16 text-center">
        <p className="text-white">Anime not found.</p>
        <Link to="/" className="mt-4 inline-block text-sm text-white/60 underline">Back</Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[1200px] px-4 pb-12 sm:px-6 lg:px-12">
      <div className="relative overflow-hidden rounded-xl bg-[var(--surface)]">
        <div className="relative h-[420px] w-full overflow-hidden">
          <img src={anime.backdropImage} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(0deg, #0e0e10 6%, rgba(14,14,16,0.75) 22%, transparent 58%)' }} />
          <div className="absolute inset-0" style={{ background: 'linear-gradient(90deg, rgba(7,7,8,0.85) 0%, transparent 62%)' }} />
          <div className="absolute bottom-0 left-0 p-6 sm:p-8">
            <h1 className="text-2xl font-semibold text-white">{anime.title.english ?? anime.title.romaji}</h1>
            <p className="mt-1 text-sm text-white/60">{anime.year} · {anime.format} · {anime.episodes} episodes</p>
            <div className="mt-3 flex gap-2">
              <Link to={`/watch/${anime.identity.internalId}/1`} className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-black">Play</Link>
              <Link to="/" className="rounded-full bg-white/15 px-5 py-2 text-sm font-medium text-white backdrop-blur">Back to Home</Link>
            </div>
          </div>
        </div>
        <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[1.6fr_0.8fr]">
          <div>
            <p className="text-sm leading-6 text-white/70">{anime.description}</p>
            <div className="mt-6">
              <EpisodeList anime={anime} />
            </div>
          </div>
          <div className="space-y-3 text-xs leading-5">
            <div><span className="text-white/50">Genres: </span><span className="text-white/80">{anime.genres.join(', ')}</span></div>
            <div><span className="text-white/50">Studios: </span><span className="text-white/80">{anime.studios?.join(', ')}</span></div>
          </div>
        </div>
      </div>
    </div>
  )
}
