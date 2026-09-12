import { useEffect, useRef, useState } from 'react'
import type { VideoSourceEnhanced, SubtitleTrack } from '../../providers/video/types'

type Props = {
  sources: VideoSourceEnhanced[]
  selectedSource?: VideoSourceEnhanced | null
  subtitles?: SubtitleTrack[]
  onTimeUpdate?: (currentTime: number, duration: number) => void
  onEnded?: () => void
  initialTime?: number
  animeTitle?: string
  episodeNumber: number
  volume?: number
  autoplay?: boolean
}

export function VideoPlayer({ sources, selectedSource, subtitles, onTimeUpdate, onEnded, initialTime, animeTitle, episodeNumber, volume = 1, autoplay = false }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  // Device targets appear only when the OS reports one — no extra chrome otherwise.
  const [airPlayAvailable, setAirPlayAvailable] = useState(false)
  const [castAvailable, setCastAvailable] = useState(false)

  const source = selectedSource ?? sources[0] ?? null
  const isHlsSource = !!(source && (source.url.includes('.m3u8') || source.type === 'hls'))

  // Reset loading/error/time when source changes
  useEffect(() => {
    setError(null)
    setIsLoading(true)
    // reset video element time as well (React state alone doesn't seek)
    if (videoRef.current) {
      try { videoRef.current.currentTime = initialTime ?? 0 } catch {}
    }
  }, [source?.url])

  // HLS support: lazy import, never blocks navigation. Cleanup destroys hls instance but does NOT clear src (MP4 src is managed via JSX)
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
      // Native HLS: only pause on cleanup, do not clear src (next MP4 will set via JSX)
      return () => {
        try { video.pause() } catch {}
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
      try { video.pause() } catch {}
    }
  }, [source?.url, source?.type, source?.embed])

  // Resume from initialTime — seek only after metadata is available
  useEffect(() => {
    const v = videoRef.current
    if (!v || !initialTime || initialTime <= 0) return
    const trySeek = () => {
      try {
        const dur = v.duration
        if (!isFinite(dur) || dur === 0) return
        if (initialTime > 5 && initialTime < dur - 5) v.currentTime = initialTime
      } catch {}
    }
    if (v.readyState >= 1) {
      trySeek()
    } else {
      const onMeta = () => trySeek()
      v.addEventListener('loadedmetadata', onMeta, { once: true })
      return () => v.removeEventListener('loadedmetadata', onMeta)
    }
  }, [initialTime, source?.url])

  // Volume control
  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = Math.max(0, Math.min(1, volume))
  }, [volume])

  // OS integration: AirPlay (Safari) + Chromecast (Remote Playback API).
  // Native controls already surface these where the OS provides them; this
  // only wires availability detection and the explicit pickers.
  useEffect(() => {
    const v = videoRef.current as any
    if (!v) return
    // Chromecast: opt into Remote Playback so supporting browsers (Chrome/Edge)
    // inject their Cast entry point; track availability for our button.
    let watchCb: ((available: boolean) => void) | null = null
    let watchHandle: Promise<number> | null = null
    try {
      if (v.remote && typeof v.remote.watchAvailability === 'function') {
        try { v.setAttribute('remote', '') } catch {}
        watchCb = (available: boolean) => setCastAvailable(!!available)
        watchHandle = v.remote.watchAvailability(watchCb).catch?.(() => null) ?? null
      }
    } catch {}
    // AirPlay: Safari fires availability events on the element.
    const onAirPlay = (e: any) => setAirPlayAvailable(e?.availability === 'available')
    try { v.addEventListener?.('webkitplaybacktargetavailabilitychanged', onAirPlay) } catch {}
    // Probe once in case the event already fired before listeners attached.
    try {
      if (typeof v.webkitShowPlaybackTargetPicker === 'function' && v.webkitCurrentPlaybackTargetIsWireless === true) {
        setAirPlayAvailable(true)
      }
    } catch {}
    return () => {
      try { v.removeEventListener?.('webkitplaybacktargetavailabilitychanged', onAirPlay) } catch {}
      try {
        if (v.remote && watchHandle && typeof v.remote.cancelWatchAvailability === 'function') {
          v.remote.cancelWatchAvailability()
        }
      } catch {}
    }
  }, [source?.url])

  // Lock-screen / Bluetooth / PiP metadata (Media Session API).
  useEffect(() => {
    try {
      const md = (navigator as any).mediaSession
      if (!md) return
      const title = animeTitle ? `${animeTitle} — E${episodeNumber}` : `Episode ${episodeNumber}`
      md.metadata = new (window as any).MediaMetadata({
        title,
        artist: animeTitle || 'Aeri',
        album: animeTitle || 'Aeri',
      })
      const v = videoRef.current
      const onPlay = () => { try { v?.play() } catch {} }
      const onPause = () => { try { v?.pause() } catch {} }
      const onSeek = (d: any) => {
        try {
          if (!v || !Number.isFinite(v.duration)) return
          const off = Number(d?.seekOffset) || 10
          v.currentTime = Math.max(0, Math.min(v.duration, v.currentTime + off))
        } catch {}
      }
      md.setActionHandler('play', onPlay)
      md.setActionHandler('pause', onPause)
      md.setActionHandler('seekbackward', onSeek)
      md.setActionHandler('seekforward', onSeek)
      return () => {
        try {
          md.setActionHandler('play', null)
          md.setActionHandler('pause', null)
          md.setActionHandler('seekbackward', null)
          md.setActionHandler('seekforward', null)
        } catch {}
      }
    } catch { return }
  }, [animeTitle, episodeNumber, source?.url])

  // Apply subtitles track mode when subtitles prop changes
  useEffect(() => {
    if (!subtitles || subtitles.length === 0) return
    const v = videoRef.current
    if (!v) return
    const apply = () => {
      for (let i = 0; i < v.textTracks.length; i++) {
        const tt = v.textTracks[i]
        // only show subtitles, not captions/metadata
        if (tt.kind === 'subtitles' || tt.kind === 'captions') tt.mode = 'showing'
      }
    }
    if (v.readyState >= 1) {
      // metadata already loaded — apply immediately
      apply()
    }
    // also listen for future metadata (when switching source)
    v.addEventListener('loadedmetadata', apply, { once: true })
    return () => v.removeEventListener('loadedmetadata', apply)
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
        {error && <p className="absolute left-1/2 top-3 -translate-x-1/2 rounded bg-red-500/90 px-3 py-1 text-xs text-white">{error}</p>}
      </div>
    )
  }

  // Direct video (hls/mp4)
  // crossOrigin only when subtitles require it (CORS VTT) — avoids breaking non-CORS MP4s
  const needsCors = !!(subtitles && subtitles.length > 0)
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
        crossOrigin={needsCors ? "anonymous" : undefined}
        // Lets supporting browsers (Safari, Chrome/Edge) surface their own
        // AirPlay / Cast entry points in the native controls.
        {...({ 'x-webkit-airplay': 'allow' } as any)}
        className="h-full w-full object-contain"
        onLoadedMetadata={() => {
          setIsLoading(false)
          if (videoRef.current && initialTime && initialTime > 5) {
            const dur = videoRef.current.duration
            if (Number.isFinite(dur) && initialTime < dur - 5) videoRef.current.currentTime = initialTime
          }
        }}
        onTimeUpdate={e => {
          const v = e.currentTarget
          onTimeUpdate?.(v.currentTime, v.duration)
        }}
        onEnded={() => onEnded?.()}
        onError={() => {
          setError('Video failed to load. Try another source.')
        }}
        onWaiting={() => setIsLoading(true)}
        onPlaying={() => setIsLoading(false)}
      >
        {subtitles?.map((track, idx) => (
          <track key={`${track.url}-${track.language}-${idx}`} kind="subtitles" src={track.url} srcLang={track.language} label={track.label} default={idx === 0} />
        ))}
        Your browser does not support video playback.
      </video>

      {isLoading && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/30">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />
        </div>
      )}

      {/* Device targets — rendered ONLY while the OS reports one available,
          so there is no extra chrome in the common case. */}
      {(airPlayAvailable || castAvailable) && (
        <div className="absolute right-2 top-2 flex gap-1.5">
          {airPlayAvailable && (
            <button
              type="button"
              aria-label="AirPlay"
              title="AirPlay"
              onClick={() => {
                try { (videoRef.current as any)?.webkitShowPlaybackTargetPicker?.() } catch {}
              }}
              className="rounded-full bg-black/70 px-2.5 py-1.5 text-[11px] font-medium text-white backdrop-blur hover:bg-black/90"
            >
              AirPlay
            </button>
          )}
          {castAvailable && (
            <button
              type="button"
              aria-label="Cast"
              title="Cast"
              onClick={async () => {
                try { await (videoRef.current as any)?.remote?.prompt?.() } catch {}
              }}
              className="rounded-full bg-black/70 px-2.5 py-1.5 text-[11px] font-medium text-white backdrop-blur hover:bg-black/90"
            >
              Cast
            </button>
          )}
        </div>
      )}

      {error && <p className="absolute left-1/2 top-3 -translate-x-1/2 rounded bg-red-500/90 px-3 py-1 text-xs text-white">{error}</p>}
    </div>
  )
}
