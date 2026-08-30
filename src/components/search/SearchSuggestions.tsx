import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { anilistMetadataProvider } from '../../providers/metadata/anilistMetadata'
import type { Anime } from '../../types/anime'
import { deduplicateBySeries } from '../../services/anilist/series'
import { getTitleHierarchy } from '../../lib/titles'

type Props = {
  query: string
  onClose?: () => void
  anchorRef?: React.RefObject<HTMLElement | null>
}

export function SearchSuggestions({ query, onClose }: Props) {
  const [results, setResults] = useState<Anime[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults(null)
      setLoading(false)
      return
    }
    const controller = new AbortController()
    let cancelled = false
    const t = setTimeout(() => {
      setLoading(true)
      anilistMetadataProvider.search(q, 12, controller.signal)
        .then(data => {
          if (cancelled || controller.signal.aborted) return
          const deduped = deduplicateBySeries(data).slice(0, 6)
          setResults(deduped)
          setLoading(false)
          setActiveIdx(-1)
        })
        .catch(() => {
          if (cancelled || controller.signal.aborted) return
          setLoading(false)
          setResults([])
        })
    }, 250)
    return () => { clearTimeout(t); cancelled = true; controller.abort() }
  }, [query])

  // Keyboard nav via container's parent input will handle, but also handle here for completeness
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!results || results.length === 0) return
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIdx(i => (i + 1) % results.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIdx(i => (i - 1 + results.length) % results.length)
      } else if (e.key === 'Enter' && activeIdx >= 0) {
        e.preventDefault()
        const anime = results[activeIdx]
        navigate(`/anime/${anime.identity.internalId}`)
        onClose?.()
      } else if (e.key === 'Escape') {
        onClose?.()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [results, activeIdx, navigate, onClose])

  if (query.trim().length < 2) return null
  if (loading) {
    return (
      <div ref={containerRef} className="absolute left-0 right-0 top-[calc(100%+8px)] z-[70] overflow-hidden rounded-xl border border-white/10 bg-[#141416]/95 p-2 backdrop-blur-xl shadow-[0_16px_48px_rgba(0,0,0,0.6)]">
        <div className="space-y-2">
          {[0,1,2].map(i => (
            <div key={i} className="flex items-center gap-3 px-2 py-2">
              <div className="h-14 w-10 animate-pulse rounded bg-white/10" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-3/4 animate-pulse rounded bg-white/10" />
                <div className="h-2 w-1/2 animate-pulse rounded bg-white/5" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }
  if (!results) return null
  if (results.length === 0) {
    return (
      <div ref={containerRef} className="absolute left-0 right-0 top-[calc(100%+8px)] z-[70] rounded-xl border border-white/10 bg-[#141416]/95 p-4 text-center backdrop-blur-xl shadow-[0_16px_48px_rgba(0,0,0,0.6)]">
        <p className="text-xs text-white/60">No titles for “{query.trim()}”</p>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      role="listbox"
      className="absolute left-0 right-0 top-[calc(100%+8px)] z-[70] max-h-[min(68vh,420px)] overflow-x-hidden overflow-y-auto rounded-xl border border-white/10 bg-[#141416]/95 backdrop-blur-xl shadow-[0_16px_48px_rgba(0,0,0,0.6)]"
    >
      {results.map((anime, idx) => {
        const titles = getTitleHierarchy(anime, null)
        return (
        <button
          key={anime.identity.internalId}
          role="option"
          aria-selected={idx === activeIdx}
          onMouseEnter={() => setActiveIdx(idx)}
          onClick={() => {
            navigate(`/anime/${anime.identity.internalId}`)
            onClose?.()
          }}
          className={`flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-white/5 ${idx === activeIdx ? 'bg-white/10' : ''}`}
        >
          <div className="h-14 w-10 shrink-0 overflow-hidden rounded bg-white/5">
            <img src={anime.coverImage} alt="" className="h-full w-full object-cover" loading="lazy" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium leading-tight text-white">{titles.primary}</p>
            {titles.native && (
              <p className="truncate text-[11px] text-white/45">{titles.native}</p>
            )}
            {titles.romaji && (
              <p className="truncate text-[11px] text-white/40">{titles.romaji}</p>
            )}
            <p className="text-[11px] text-white/50">{[anime.format, anime.year ? String(anime.year) : null].filter(Boolean).join(' · ')}</p>
          </div>
        </button>
      )})}
      <button
        onClick={() => {
          navigate(`/search?q=${encodeURIComponent(query.trim())}`)
          onClose?.()
        }}
        className="w-full border-t border-white/10 px-3 py-2 text-center text-xs text-white/60 hover:bg-white/5 hover:text-white"
      >
        See all results for “{query.trim()}” →
      </button>
    </div>
  )
}
