/**
 * Playback verification — distinguishes HTTP 200 from actual playback.
 * Tier model from docs/PLAYBACK_MATRIX.md §1.
 * - T0 Transport: status + headers (CORS, X-Frame-Options, CSP, content-type)
 * - T1 Source entity: body sniff (HTML error, Cloudflare, Turnstile, JSON error)
 * - T2 Element: readyState, videoWidth, networkState, iframe load
 * - T3 Playback: currentTime advances, timeupdate fires
 * - T4 User-visible: overlay, controls
 *
 * Pure helpers (no Playwright dependency) + Playwright probes are separate.
 */

// ---------- T0 / T1: response classifiers ----------

export type ProbeResult =
  | { tier: 'T0'; ok: false; reason: string; status?: number; contentType?: string }
  | { tier: 'T1'; ok: false; reason: string; snippet: string }
  | { tier: 'T0' | 'T1'; ok: true }

const HTML_ERROR_SNIPPETS = [
  'error - megaplay',
  'just a moment',
  'attention required',
  'cloudflare',
  'turnstile',
  'domain for sale',
  'an error occurred',
  '<!doctype html',
  '<html',
  'bad_user_input',
  'forbidden',
  'access denied',
] as const

const VIDEO_CONTENT_TYPES = [
  'video/mp4',
  'video/webm',
  'video/ogg',
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
  'audio/mpegurl',
] as const

const EMBED_ALLOW_HOSTS = ['youtube-nocookie.com', 'youtube.com', 'youtu.be', 'archive.org']

export function isVideoContentType(ct: string | null | undefined): boolean {
  if (!ct) return false
  const low = ct.toLowerCase()
  return VIDEO_CONTENT_TYPES.some(v => low.includes(v))
}

export function isHtmlContentType(ct: string | null | undefined): boolean {
  if (!ct) return false
  const low = ct.toLowerCase()
  return low.includes('text/html') || low.includes('application/xhtml+xml')
}

export function isJsonContentType(ct: string | null | undefined): boolean {
  if (!ct) return false
  return ct.toLowerCase().includes('application/json')
}

export function sniffHtmlError(bodySnippet: string): string | null {
  const low = bodySnippet.toLowerCase().slice(0, 8000)
  for (const needle of HTML_ERROR_SNIPPETS) {
    if (low.includes(needle)) return `body contains "${needle}" — expected video/hls, got error HTML`
  }
  // JSON error shape
  const trimmed = low.trim()
  if (trimmed.startsWith('{"error') || trimmed.startsWith('{"errors"') || trimmed.includes('"bad_user_input"')) {
    return `body is JSON error: ${trimmed.slice(0, 220)}`
  }
  return null
}

export function isHlsManifest(text: string): boolean {
  const t = text.trim().slice(0, 4000)
  return t.startsWith('#EXTM3U') && (t.includes('#EXTINF') || t.includes('#EXT-X-STREAM-INF'))
}

export function classifyFetchResponse(opts: {
  status: number
  headers: Record<string, string>
  bodySnippet: string
  url: string
}): ProbeResult {
  const status = opts.status
  const ct = opts.headers['content-type'] ?? opts.headers['Content-Type'] ?? ''
  const xfo = opts.headers['x-frame-options'] ?? opts.headers['X-Frame-Options'] ?? ''
  const url = opts.url

  // T0: status
  if (status < 200 || status >= 300) {
    // 206 is valid for range, 200 is normal
    if (status !== 206) return { tier: 'T0', ok: false, reason: `status ${status} is not 2xx`, status, contentType: ct }
  }

  // For direct video/hls, content-type must be video/* or hls, not html
  const isEmbed = url.includes('/embed') || url.includes('youtube-nocookie.com') || url.includes('youtube.com/embed')
  if (isEmbed) {
    if (xfo && /deny|sameorigin/i.test(xfo)) {
      return { tier: 'T0', ok: false, reason: `X-Frame-Options ${xfo} blocks embed`, status, contentType: ct }
    }
    // embed HTML content-type is expected, but body must not be error
    const err = sniffHtmlError(opts.bodySnippet)
    // For YouTube embed, body is HTML player — not an error — so only fail on known error snippets
    if (err && (err.includes('domain for sale') || err.includes('error - megaplay') || err.includes('just a moment'))) {
      return { tier: 'T1', ok: false, reason: err, snippet: opts.bodySnippet.slice(0, 400) }
    }
    return { tier: 'T0', ok: true }
  }

  // Non-embed (hls/mp4)
  if (isHtmlContentType(ct)) {
    // Video endpoint returning HTML is a failure even with 200
    const err = sniffHtmlError(opts.bodySnippet)
    return {
      tier: 'T1',
      ok: false,
      reason: `content-type ${ct} is HTML but expected video/hls; ${err ?? 'body is HTML'}`,
      snippet: opts.bodySnippet.slice(0, 500),
    }
  }
  // If status 200 but content-type is json with error
  if (isJsonContentType(ct)) {
    const err = sniffHtmlError(opts.bodySnippet)
    if (err) return { tier: 'T1', ok: false, reason: err, snippet: opts.bodySnippet.slice(0, 500) }
    // JSON with {sources: []} is not an error — it's a valid empty source list
    // caller should check array length, not body sniff
    return { tier: 'T0', ok: true }
  }
  // HLS: if url is .m3u8, check manifest
  if (url.includes('.m3u8')) {
    if (!isVideoContentType(ct) && !ct.includes('mpegurl') && !ct.includes('application/octet-stream')) {
      // some origins serve m3u8 as text/plain — allow but still sniff body
    }
    if (!isHlsManifest(opts.bodySnippet) && opts.bodySnippet.length > 0) {
      const err = sniffHtmlError(opts.bodySnippet)
      return {
        tier: 'T1',
        ok: false,
        reason: err ?? 'm3u8 body is not a valid HLS manifest (#EXTM3U/#EXTINF missing)',
        snippet: opts.bodySnippet.slice(0, 600),
      }
    }
  }
  // MP4: content-type should be video/*
  if (url.includes('.mp4') && ct && !isVideoContentType(ct) && !ct.includes('video/')) {
    // Some proxies use octet-stream — allow with length check
    if (!ct.includes('octet-stream')) {
      return { tier: 'T1', ok: false, reason: `mp4 url has content-type ${ct}, expected video/*`, snippet: opts.bodySnippet.slice(0, 300) }
    }
  }
  if (opts.bodySnippet.length === 0) {
    // HEAD or empty — allow but caller may check content-length
  }
  const err = sniffHtmlError(opts.bodySnippet)
  if (err && opts.bodySnippet.toLowerCase().includes('<html')) {
    return { tier: 'T1', ok: false, reason: err, snippet: opts.bodySnippet.slice(0, 400) }
  }
  return { tier: 'T1', ok: true }
}

// ---------- T2 / T3: element probes (browser) ----------

export interface VideoElementProbe {
  exists: boolean
  src: string | null
  currentSrc: string | null
  networkState: number | null // 0 empty, 1 idle, 2 loading, 3 no_source
  readyState: number | null // 0 HAVE_NOTHING … 4 HAVE_ENOUGH_DATA
  error: { code: number | null; message: string | null } | null
  videoWidth: number | null
  videoHeight: number | null
  duration: number | null
  paused: boolean | null
  playedLength: number | null
  bufferedLength: number | null
  tagName: string | null
}

export interface EmbedProbe {
  exists: boolean
  src: string | null
  boundingBox: { width: number; height: number } | null
  loaded: boolean
  allow: string | null
  referrerPolicy: string | null
}

// Browser-side evaluators — to be used with page.evaluate

export function probeVideoElementEval(): VideoElementProbe {
  const v = document.querySelector('video') as HTMLVideoElement | null
  if (!v) return {
    exists: false, src: null, currentSrc: null, networkState: null, readyState: null,
    error: null, videoWidth: null, videoHeight: null, duration: null, paused: null,
    playedLength: null, bufferedLength: null, tagName: null,
  }
  const err = v.error ? { code: v.error.code, message: v.error.message } : null
  let playedLength: number | null = null
  let bufferedLength: number | null = null
  try { playedLength = v.played?.length ?? null } catch { playedLength = null }
  try { bufferedLength = v.buffered?.length ?? null } catch { bufferedLength = null }
  return {
    exists: true,
    src: v.getAttribute('src') || (v as any).src || null,
    currentSrc: (v as any).currentSrc || null,
    networkState: (v as any).networkState ?? null,
    readyState: v.readyState,
    error: err,
    videoWidth: v.videoWidth,
    videoHeight: v.videoHeight,
    duration: Number.isFinite(v.duration) ? v.duration : null,
    paused: v.paused,
    playedLength,
    bufferedLength,
    tagName: v.tagName,
  }
}

export function probeEmbedElementEval(): EmbedProbe {
  const f = document.querySelector('iframe') as HTMLIFrameElement | null
  if (!f) return { exists: false, src: null, boundingBox: null, loaded: false, allow: null, referrerPolicy: null }
  const rect = f.getBoundingClientRect()
  return {
    exists: true,
    src: f.getAttribute('src') || (f as any).src || null,
    boundingBox: { width: Math.round(rect.width), height: Math.round(rect.height) },
    loaded: (f as any).__aeriLoaded || f.dataset['loaded'] === 'true' || rect.width > 0, // fallback
    allow: f.getAttribute('allow'),
    referrerPolicy: f.getAttribute('referrerpolicy'),
  }
}

// Verdict helpers (pure)

export function verdictFromVideoProbe(p: VideoElementProbe): { ok: boolean; tier: 'T2' | 'T3'; reason?: string } {
  if (!p.exists) return { ok: false, tier: 'T2', reason: 'no <video> element in DOM' }
  if (p.error && p.error.code !== null && p.error.code !== 0) {
    return { ok: false, tier: 'T2', reason: `video.error code=${p.error.code} message=${p.error.message ?? ''}` }
  }
  // NETWORK_NO_SOURCE = 3
  if (p.networkState === 3) return { ok: false, tier: 'T2', reason: 'networkState NETWORK_NO_SOURCE (3) — no compatible source' }
  if (p.readyState === null || p.readyState < 2) return { ok: false, tier: 'T2', reason: `readyState ${p.readyState} < 2 (HAVE_CURRENT_DATA)` }
  if (p.videoWidth === 0 || p.videoHeight === 0) return { ok: false, tier: 'T2', reason: `videoWidth ${p.videoWidth} or videoHeight ${p.videoHeight} is 0 — decoder has no frames (200 HTML?)` }
  if (p.duration === null || !Number.isFinite(p.duration) || p.duration < 1) return { ok: false, tier: 'T2', reason: `duration ${p.duration} invalid (expected >1s finite)` }
  // T3 checks require time; caller does assertCurrentTimeAdvances separately
  return { ok: true, tier: 'T2' }
}

export function verdictFromEmbedProbe(p: EmbedProbe, expectedYtId?: string | null): { ok: boolean; tier: 'T2'; reason?: string } {
  if (!p.exists) return { ok: false, tier: 'T2', reason: 'no <iframe> embed element' }
  if (!p.src) return { ok: false, tier: 'T2', reason: 'iframe src is empty' }
  // AniList trailers occasionally contain whitespace/tabs (e.g. 16498 "LHtdKWJdif4\t"). Trim before URL parse.
  const rawSrc = p.src.trim()
  const src = rawSrc.replace(/\s+/g, '')
  if (p.boundingBox && (p.boundingBox.width < 100 || p.boundingBox.height < 50)) {
    return { ok: false, tier: 'T2', reason: `iframe boundingBox ${p.boundingBox.width}×${p.boundingBox.height} too small` }
  }
  try {
    const u = new URL(src)
    const hostOk = EMBED_ALLOW_HOSTS.some(h => u.hostname.includes(h))
    if (!hostOk && !u.hostname.includes('archive.org') && !u.hostname.includes('mux.dev')) {
      return { ok: false, tier: 'T2', reason: `iframe src host ${u.hostname} not in allowlist (yt/archive/mux)` }
    }
    if (expectedYtId) {
      const expectedTrim = expectedYtId.trim().replace(/\s+/g, '')
      const idInUrl = u.pathname.split('/').pop()?.split('?')[0]?.trim() ?? ''
      if (idInUrl !== expectedTrim && !src.includes(expectedTrim)) {
        return { ok: false, tier: 'T2', reason: `iframe src does not contain expected ytId ${expectedTrim}, got ${idInUrl}` }
      }
    }
  } catch (e) {
    return { ok: false, tier: 'T2', reason: `iframe src ${p.src} is not a valid URL: ${String((e as Error)?.message ?? e).slice(0,120)}` }
  }
  return { ok: true, tier: 'T2' }
}

// Minimal body-sniff used by Playwright route interception
export function extractBodySnippet(body: string | Uint8Array | null | undefined, max = 2000): string {
  if (!body) return ''
  const s = typeof body === 'string' ? body : new TextDecoder().decode(body as Uint8Array)
  return s.slice(0, max)
}
