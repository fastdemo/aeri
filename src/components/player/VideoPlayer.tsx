import { useEffect, useRef } from 'react'
import { VideoPlayer as VideoJsPlayer, VideoSkin } from '@videojs/react/video'
import { HlsJsVideo } from '@videojs/react/media/hlsjs-video'
import '@videojs/react/video/skin.css'
import type { VideoSourceEnhanced, SubtitleTrack } from '../../providers/video/types'

type Props = {
  sources: VideoSourceEnhanced[]
  selectedSource?: VideoSourceEnhanced | null
  subtitles?: SubtitleTrack[]
  onTimeUpdate?: (currentTime: number, duration: number) => void
  onEnded?: () => void
  initialTime?: number
  /** Imperative seek (nonce'd): resume/restart clicks seek the live element
      even when it is already playing or had no mount-time position. */
  seekRequest?: { time: number; nonce: number } | null
  animeTitle?: string
  episodeNumber: number
  volume?: number
  autoplay?: boolean
}

// Safari needs this attribute on the media element for the default skin's
// AirPlay button to reach the system picker.
const airPlayAttrs = { 'x-webkit-airplay': 'allow' }

export function VideoPlayer({
  sources,
  selectedSource,
  subtitles,
  onTimeUpdate,
  onEnded,
  initialTime,
  seekRequest,
  animeTitle,
  episodeNumber,
  volume = 1,
  autoplay = false,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)

  const source = selectedSource ?? sources[0] ?? null
  const isPlayable = !!source?.url && !source.embed && source.type !== 'embed'
  const sourceType = source?.type?.toLowerCase() ?? ''
  const isHlsSource = !!(
    source
    && (sourceType === 'hls'
      || sourceType.includes('mpegurl')
      || /\.m3u8(?:$|[?#])/i.test(source.url))
  )

  // Resume from initialTime — seek only after metadata is available. The
  // adapter fires loadedmetadata/durationchange; canplay covers manifests
  // whose duration becomes finite slightly after metadata.
  useEffect(() => {
    const v = videoRef.current
    if (!v || !initialTime || initialTime <= 5) return

    let cancelled = false
    const cleanup = () => {
      v.removeEventListener('loadedmetadata', trySeek)
      v.removeEventListener('durationchange', trySeek)
      v.removeEventListener('canplay', trySeek)
    }
    const trySeek = () => {
      if (cancelled) return
      try {
        const dur = v.duration
        if (!Number.isFinite(dur) || dur <= 0 || initialTime >= dur - 5) return
        v.currentTime = initialTime
        cancelled = true
        cleanup()
      } catch {}
    }

    if (v.readyState >= 1) trySeek()
    if (!cancelled) {
      v.addEventListener('loadedmetadata', trySeek)
      v.addEventListener('durationchange', trySeek)
      v.addEventListener('canplay', trySeek)
    }

    return () => {
      cancelled = true
      cleanup()
    }
  }, [initialTime, source?.url])

  // Imperative seek (resume / restart). Runs on every nonce, including while
  // the element is already playing; waits for metadata when it is not ready
  // yet. Seeking to 0 is a real request (restart), not "no value".
  useEffect(() => {
    const v = videoRef.current
    if (!v || !seekRequest) return
    const target = Math.max(0, seekRequest.time)
    const apply = () => {
      try {
        const dur = v.duration
        if (Number.isFinite(dur) && dur > 0) v.currentTime = Math.min(target, Math.max(0, dur - 0.25))
        else v.currentTime = target
      } catch {}
    }
    if (v.readyState >= 1) { apply(); return }
    const onReady = () => apply()
    v.addEventListener('loadedmetadata', onReady)
    v.addEventListener('canplay', onReady)
    return () => {
      v.removeEventListener('loadedmetadata', onReady)
      v.removeEventListener('canplay', onReady)
    }
  }, [seekRequest?.nonce, seekRequest?.time, source?.url])

  // Volume preference is a media-element property, not an attribute.
  useEffect(() => {
    const v = videoRef.current
    if (v) v.volume = Math.max(0, Math.min(1, volume))
  }, [volume, source?.url])

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

  // Apply the subtitles preference once track metadata exists. HLS text
  // tracks can arrive after loadedmetadata, so addtrack is covered too.
  useEffect(() => {
    if (!subtitles || subtitles.length === 0) return
    const v = videoRef.current
    if (!v) return
    const apply = () => {
      for (let i = 0; i < v.textTracks.length; i++) {
        const tt = v.textTracks[i]
        if (tt.kind === 'subtitles' || tt.kind === 'captions') tt.mode = 'showing'
      }
    }
    apply()
    v.textTracks.addEventListener('addtrack', apply)
    v.addEventListener('loadedmetadata', apply)
    return () => {
      v.textTracks.removeEventListener('addtrack', apply)
      v.removeEventListener('loadedmetadata', apply)
    }
  }, [subtitles, source?.url])

  // No direct source — Watch filters embed sources before rendering, so this
  // is an honest guard rather than a second (iframe) player path.
  if (!source || !source.url) return null
  if (!isPlayable) {
    return (
      <div className="grid h-full w-full place-items-center bg-[var(--bg)] px-6 text-center">
        <p className="text-sm text-[var(--text-muted)]">This source can’t be played in Aeri’s player.</p>
      </div>
    )
  }

  // One media element for every direct source: HlsJsVideo uses hls.js for
  // HLS (MSE) and falls back to the browser's native player for MP4/HLS
  // where MSE is unavailable. Video.js owns all chrome via the default skin.
  const needsCors = !!(subtitles && subtitles.length > 0)
  return (
    <div className="aeri-player h-full w-full">
      {/* No poster: the Watch surface is the plain page background with the
          video on top. An artwork poster behind the
          picture is exactly the "background wrapping around" that was
          reported, so the skin starts on black. renderPoster returns null so
          the skin does not emit an empty <img class="media-poster-image">
          (an empty src also logs a browser warning). */}
      <VideoJsPlayer>
        <VideoSkin className="h-full w-full" renderPoster={() => null}>
          <HlsJsVideo
            ref={videoRef}
            source={{
              src: source.url,
              type: isHlsSource ? 'application/vnd.apple.mpegurl' : 'video/mp4',
            }}
            autoPlay={!!autoplay}
            playsInline
            crossOrigin={needsCors ? 'anonymous' : undefined}
            {...airPlayAttrs}
            onTimeUpdate={(e) => {
              const v = e.currentTarget
              onTimeUpdate?.(v.currentTime, v.duration)
            }}
            onEnded={() => onEnded?.()}
          >
            {subtitles?.map((track, idx) => (
              <track
                key={`${track.url}-${track.language}-${idx}`}
                kind="subtitles"
                src={track.url}
                srcLang={track.language}
                label={track.label}
                default={idx === 0}
              />
            ))}
          </HlsJsVideo>
        </VideoSkin>
      </VideoJsPlayer>
    </div>
  )
}
