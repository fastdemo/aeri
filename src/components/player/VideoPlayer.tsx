import { useEffect, useRef, useState } from 'react'
import type { VideoSourceEnhanced, SubtitleTrack } from '../../providers/video/types'

type Props = {
  sources: VideoSourceEnhanced[]
  selectedSource?: VideoSourceEnhanced | null
  onSourceChange?: (s: VideoSourceEnhanced) => void
  subtitles?: SubtitleTrack[]
  onTimeUpdate?: (currentTime: number, duration: number) => void
  onEnded?: () => void
  initialTime?: number
  animeTitle?: string
  episodeNumber: number
  volume?: number
  autoplay?: boolean
}

export function VideoPlayer({ sources, selectedSource, onSourceChange, subtitles, onTimeUpdate, onEnded, initialTime, animeTitle, episodeNumber, volume = 1, autoplay = false }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [currentTime, setCurrentTime] = useState(initialTime ?? 0)

  const source = selectedSource ?? sources[0] ?? null
  const hasMultipleSources = sources.length > 1
  const isHlsSource = !!(source && (source.url.includes('.m3u8') || source.type === 'hls'))

  // HLS support: lazy import, never blocks navigation. Cleanup is synchronous (destroy + src clear)
  const hlsRef = useRef<any>(null)
  useEffect(() => {
    setError(null)
    if (!source || source.embed) return
    const url = source.url
    const isHls = url.includes('.m3u8') || source.type === 'hls'
    if (!isHls) return
    const video = videoRef.current
    if (!video) return
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url
      return () => {
        try { video.pause(); video.removeAttribute('src'); video.load() } catch {}
      }
    }
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    timer = setTimeout(async () => {
      if (cancelled) return
      try {
        const Hls = (await import('hls.js')).default
        if (cancelled || !Hls.isSupported()) {
          if (!cancelled) try { video.src = url } catch {}
          return
        }
        if (hlsRef.current) { try { hlsRef.current.destroy() } catch {}; hlsRef.current = null }
        if (cancelled) return
        const hls = new Hls({ enableWorker: true })
        hlsRef.current = hls
        hls.on(Hls.Events.ERROR, (_evt: any, data: any) => {
          if (data?.fatal) {
            try { hls.destroy() } catch {}
            hlsRef.current = null
            if (!cancelled) setError('Stream error. Try another source.')
          }
        })
        hls.loadSource(url)
        hls.attachMedia(video)
      } catch {
        if (!cancelled) try { video.src = url } catch {}
      }
    }, 0)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      if (hlsRef.current) { try { hlsRef.current.destroy() } catch {}; hlsRef.current = null }
      try { video.pause(); video.removeAttribute('src'); video.load() } catch {}
    }
  }, [source?.url, source?.type, source?.embed])

  // Resume from initialTime
  useEffect(() => {
    if (videoRef.current && initialTime && initialTime > 0 && initialTime < (videoRef.current.duration || Infinity) - 5) {
      videoRef.current.currentTime = initialTime
    }
  }, [initialTime, source?.url])

  // Volume control
  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = Math.max(0, Math.min(1, volume))
  }, [volume])

  // Apply subtitles track mode when subtitles prop changes
  useEffect(() => {
    if (!subtitles || subtitles.length === 0) return
    const v = videoRef.current
    if (!v) return
    const onLoaded = () => {
      for (let i = 0; i < v.textTracks.length; i++) {
        const tt = v.textTracks[i]
        tt.mode = 'showing'
      }
    }
    v.addEventListener('loadedmetadata', onLoaded, { once: true })
    return () => v.removeEventListener('loadedmetadata', onLoaded)
  }, [subtitles, source?.url])

  // No source — don't render video
  if (!source || !source.url) {
    return null
  }

  // Embed: use iframe
  if (source.embed) {
    return (
      <div className="relative aspect-video w-full overflow-hidden bg-black">
        <iframe
          src={source.url}
          title={`${animeTitle ?? 'Anime'} Episode ${episodeNumber}`}
          className="h-full w-full border-0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          allowFullScreen
          loading="lazy"
          referrerPolicy="no-referrer"
          onLoad={() => setIsLoading(false)}
          onError={() => setError('Embed failed to load. Try another source.')}
        />
        {isLoading && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/60">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />
          </div>
        )}
        {hasMultipleSources && onSourceChange && (
          <div className="absolute bottom-2 right-2">
            <select
              value={source.url}
              onChange={e => {
                const s = sources.find(s => s.url === e.target.value)
                if (s) onSourceChange(s)
              }}
              aria-label="Select video source"
              className="rounded-full bg-black/70 px-3 py-1 text-xs text-white backdrop-blur"
            >
              {sources.map(s => (
                <option key={s.url} value={s.url} className="bg-black">
                  {s.provider} {s.quality ? `• ${s.quality}` : ''} {s.language ? `• ${s.language}` : ''}
                </option>
              ))}
            </select>
          </div>
        )}
        {error && <p className="absolute bottom-10 left-1/2 -translate-x-1/2 rounded bg-red-500/90 px-3 py-1 text-xs text-white">{error}</p>}
      </div>
    )
  }

  // Direct video (hls/mp4)
  return (
    <div className="relative aspect-video w-full overflow-hidden bg-black">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        ref={videoRef}
        src={isHlsSource ? undefined : source.url}
        controls
        autoPlay={!!autoplay}
        playsInline
        preload="metadata"
        crossOrigin="anonymous"
        className="h-full w-full object-contain"
        onLoadedMetadata={() => {
          setIsLoading(false)
          if (videoRef.current && initialTime && initialTime > 5) {
            const dur = videoRef.current.duration
            if (initialTime < dur - 10) videoRef.current.currentTime = initialTime
          }
        }}
        onTimeUpdate={e => {
          const v = e.currentTarget
          setCurrentTime(v.currentTime)
          onTimeUpdate?.(v.currentTime, v.duration)
        }}
        onEnded={() => onEnded?.()}
        onError={() => {
          setError('Video failed to load. Try another source.')
        }}
        onWaiting={() => setIsLoading(true)}
        onPlaying={() => setIsLoading(false)}
      >
        {subtitles?.map(track => (
          <track key={track.url} kind="subtitles" src={track.url} srcLang={track.language} label={track.label} />
        ))}
        Your browser does not support video playback.
      </video>

      {isLoading && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/30">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />
        </div>
      )}

      {hasMultipleSources && onSourceChange && (
        <div className="absolute bottom-12 right-2">
          <select
            value={source.url}
            onChange={e => {
              const s = sources.find(s => s.url === e.target.value)
              if (s) onSourceChange(s)
            }}
            aria-label="Select video source"
            className="rounded-full bg-black/70 px-3 py-1 text-xs text-white backdrop-blur"
          >
            {sources.map(s => (
              <option key={s.url} value={s.url} className="bg-black">
                {s.provider} {s.quality ? `• ${s.quality}` : ''} {s.language ? `• ${s.language}` : ''}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && <p className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded bg-red-500/90 px-3 py-1 text-xs text-white">{error}</p>}

      <div className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 text-[10px] text-white/60">
        {Math.floor(currentTime / 60)}:{String(Math.floor(currentTime % 60)).padStart(2, '0')} • Ep {episodeNumber}
      </div>
    </div>
  )
}
