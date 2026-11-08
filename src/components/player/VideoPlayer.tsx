import { useEffect, useRef, useState } from 'react'
import { VideoPlayer as VideoJsPlayer, VideoSkin } from '@videojs/react/video'
import { HlsJsVideo, type HlsJsAdapter } from '@videojs/react/media/hlsjs-video'
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

// Decoded-frame counter. Chromium exposes getVideoPlaybackQuality; Safari
// exposes webkitDecodedFrameCount. Used by the recovery watchdog to tell a
// genuinely still picture from a decoder that stopped producing frames.
function decodedFrames(v: HTMLVideoElement): number | null {
  const q = (v as HTMLVideoElement & {
    getVideoPlaybackQuality?: () => { totalVideoFrames?: number }
  }).getVideoPlaybackQuality?.()
  if (q && typeof q.totalVideoFrames === 'number') return q.totalVideoFrames
  const legacy = (v as HTMLVideoElement & { webkitDecodedFrameCount?: number }).webkitDecodedFrameCount
  return typeof legacy === 'number' ? legacy : null
}

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
  // The playback adapter (not the <video>) is what exposes the hls.js
  // engine. `mediaRef` is handed the adapter by <HlsJsVideo>; the watchdog
  // uses its engine for soft recovery.
  const mediaRef = useRef<HlsJsAdapter | null>(null)
  // Bumping the epoch remounts ONLY the player subtree (the VideoPlayer
  // component and its effects survive), which is the targeted refresh that
  // used to require reloading the whole tab.
  const [playerEpoch, setPlayerEpoch] = useState(0)
  const resumeAtRef = useRef<number | null>(null)
  const shouldResumeRef = useRef(false)
  const recoverAttemptsRef = useRef(0)

  const source = selectedSource ?? sources[0] ?? null
  const isPlayable = !!source?.url && !source.embed && source.type !== 'embed'
  const sourceType = source?.type?.toLowerCase() ?? ''
  const isHlsSource = !!(
    source
    && (sourceType === 'hls'
      || sourceType.includes('mpegurl')
      || /\.m3u8(?:$|[?#])/i.test(source.url))
  )

  // Resume from initialTime - seek only after metadata is available. The
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
  }, [volume, source?.url, playerEpoch])

  // A REAL source change (new episode, provider switch) invalidates both
  // the recovery target and the attempt budget captured for the old stream.
  // A recovery remount keeps the same URL, so this effect does not run then.
  useEffect(() => {
    resumeAtRef.current = null
    recoverAttemptsRef.current = 0
  }, [source?.url])

  // ---- Playback recovery (D159) --------------------------------------
  // hls.js reports FATAL errors through the adapter's `error` event but the
  // adapter never recovers: the picture stays black until the tab reloads.
  // This watchdog covers the three ways playback gets stuck:
  //   1. fatal engine error (adapter `error` / media element `error`),
  //   2. buffer stall - "playing" but currentTime has not moved,
  //   3. decode failure - readyState says data is here but the element
  //      produces no picture (videoWidth 0, or frozen decoded frames while
  //      the clock advances).
  // Escalation stays inside the live engine first (startLoad for network,
  // recoverMediaError for media/stall, codec swap on the second attempt),
  // then a targeted remount of the player subtree at the failure position.
  // Attempts are capped per source and refill after 45s of healthy playback.
  useEffect(() => {
    const v = videoRef.current
    if (!v) return

    let disposed = false
    let recovering = false
    let lastTime = v.currentTime
    let lastProgressAt = performance.now()
    let lastFrames = decodedFrames(v)
    let lastFramesAt = lastProgressAt
    let noPictureSince = 0
    let healthySince = 0

    const resetBaselines = () => {
      const now = performance.now()
      lastTime = v.currentTime
      lastProgressAt = now
      lastFrames = decodedFrames(v)
      lastFramesAt = now
      noPictureSince = 0
    }

    const capturePosition = () => {
      const t = v.currentTime
      if (Number.isFinite(t) && t > 0) resumeAtRef.current = t
      else if (initialTime && initialTime > 5) resumeAtRef.current = initialTime
      shouldResumeRef.current = !v.paused && !v.ended
    }

    const recover = (reason: 'error' | 'stall' | 'decode') => {
      if (disposed || recovering) return
      const attempt = recoverAttemptsRef.current
      if (attempt >= 4) return
      recoverAttemptsRef.current = attempt + 1
      recovering = true

      const live = mediaRef.current
      const engine = live?.engine ?? null
      const errType = (live?.error as { data?: { type?: string } } | null)?.data?.type

      // Attempts 0–1: soft recovery in the running hls.js instance.
      if (attempt < 2 && engine) {
        try {
          const network = errType === 'networkError'
          if (attempt === 0) {
            // A frozen clock restarts segment loading; a decode/media
            // failure flushes the buffer instead.
            if (reason === 'error' && !network) engine.recoverMediaError()
            else engine.startLoad()
          } else if (network) {
            engine.startLoad()
          } else {
            // Some media errors are a bad audio codec in the variant;
            // hls.js recommends swapping it before the second flush.
            engine.swapAudioCodec()
            engine.recoverMediaError()
          }
          resetBaselines()
          window.setTimeout(() => { recovering = false }, 2500)
          return
        } catch {
          // Engine refused the soft path - fall through to the remount.
        }
      }

      // Attempts 2–3: remount the player subtree at the failure position.
      capturePosition()
      resetBaselines()
      setPlayerEpoch((n) => n + 1)
    }

    // The native adapter installs a CAPTURE listener on the element that
    // calls stopImmediatePropagation() for every media error, so a listener
    // on the <video> itself never runs. Window capture runs BEFORE that and
    // is filtered to this element (track/source errors have other targets).
    const onElementError = (event: Event) => {
      if (event.target !== v) return
      recover('error')
    }
    window.addEventListener('error', onElementError, true)
    const onAdapterError = () => recover('error')
    const adapter = mediaRef.current
    adapter?.addEventListener?.('error', onAdapterError)

    const tick = () => {
      if (disposed) return
      const now = performance.now()

      // Background tabs throttle timers and the browser may suspend
      // loading; never judge playback health while hidden.
      if (document.hidden) {
        resetBaselines()
        healthySince = 0
        return
      }
      // A media error is fatal whether or not the element is paused, so it
      // is checked BEFORE the paused guard.
      if (v.error) { recover('error'); return }
      if (v.paused || v.ended) {
        resetBaselines()
        healthySince = 0
        return
      }
      if (v.seeking) {
        lastProgressAt = now
        return
      }
      if (recovering) return

      const t = v.currentTime
      const advanced = Math.abs(t - lastTime) > 0.05
      if (advanced) {
        lastTime = t
        lastProgressAt = now
      }

      // 1. Decode failure. `videoWidth === 0` after HAVE_CURRENT_DATA is
      //    the cheapest reliable "no picture" signal; frozen frame counts
      //    catch streams whose metadata still claims a video track.
      let noPicture = v.readyState >= 2 && v.videoWidth === 0
      const frames = decodedFrames(v)
      if (frames != null) {
        if (lastFrames == null || frames > lastFrames) {
          lastFrames = frames
          lastFramesAt = now
        } else if (advanced && now - lastFramesAt > 12_000) {
          noPicture = true
        }
      }
      if (noPicture) {
        if (!noPictureSince) noPictureSince = now
        else if (now - noPictureSince > 5_000) {
          noPictureSince = 0
          recover('decode')
          return
        }
      } else {
        noPictureSince = 0
      }

      // 2. Buffer stall: the clock is frozen while "playing".
      if (now - lastProgressAt > 12_000) { recover('stall'); return }

      // 3. Healthy playback refills the recovery budget.
      if (now - lastProgressAt < 1_000) {
        if (!healthySince) healthySince = now
        else if (now - healthySince > 45_000) {
          healthySince = now
          recoverAttemptsRef.current = 0
        }
      } else {
        healthySince = 0
      }
    }

    const interval = window.setInterval(tick, 2_000)
    const onVisibility = () => resetBaselines()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      disposed = true
      window.clearInterval(interval)
      window.removeEventListener('error', onElementError, true)
      adapter?.removeEventListener?.('error', onAdapterError)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [source?.url, playerEpoch, initialTime])

  // After a targeted remount, restore the interrupted position and resume
  // playback if the failure hit mid-episode. The remount is the only path
  // that loses the element, so this effect is the counterpart to it.
  useEffect(() => {
    if (playerEpoch === 0) return
    const at = resumeAtRef.current
    const v = videoRef.current
    if (at == null || !v) return

    let cancelled = false
    const cleanup = () => {
      v.removeEventListener('loadedmetadata', apply)
      v.removeEventListener('durationchange', apply)
      v.removeEventListener('canplay', apply)
    }
    const apply = () => {
      if (cancelled) return
      try {
        const dur = v.duration
        if (Number.isFinite(dur) && dur > 0 && at >= dur - 1) {
          cancelled = true
          cleanup()
          return
        }
        v.currentTime = at
      } catch {}
      cancelled = true
      cleanup()
      resumeAtRef.current = null
      if (shouldResumeRef.current) void v.play().catch(() => {})
    }

    if (v.readyState >= 1) {
      apply()
      return cleanup
    }
    v.addEventListener('loadedmetadata', apply)
    v.addEventListener('durationchange', apply)
    v.addEventListener('canplay', apply)
    return () => {
      cancelled = true
      cleanup()
    }
  }, [playerEpoch, source?.url])

  // Lock-screen / Bluetooth / PiP metadata (Media Session API).
  useEffect(() => {
    try {
      const md = (navigator as any).mediaSession
      if (!md) return
      const title = animeTitle ? `${animeTitle} - E${episodeNumber}` : `Episode ${episodeNumber}`
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
  }, [animeTitle, episodeNumber, source?.url, playerEpoch])

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
  }, [subtitles, source?.url, playerEpoch])

  // No direct source - Watch filters embed sources before rendering, so this
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
      <VideoJsPlayer key={playerEpoch}>
        <VideoSkin className="h-full w-full" renderPoster={() => null}>
          <HlsJsVideo
            ref={videoRef}
            mediaRef={mediaRef}
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
