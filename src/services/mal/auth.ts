import { MAL_CLIENT_ID, MAL_AUTH_URL, MAL_TOKEN_URL, getMalRedirectUri } from '../../lib/malConfig'
import {
  setMalOAuthState,
  getMalOAuthState,
  clearMalOAuthState,
  setMalCodeVerifier,
  getMalCodeVerifier,
  clearMalCodeVerifier,
  setMalTokens,
  clearMalTokens,
} from '../../storage/mal'
import { getEffectiveVideoApiUrl } from '../../storage/preferences'

function getMalWorkerBase(): string | null {
  try {
    const base = getEffectiveVideoApiUrl()
    return base ? base.replace(/\/$/, '') : null
  } catch { return null }
}

async function fetchMalTokenWithFallback(body: URLSearchParams): Promise<Response> {
  const workerBase = getMalWorkerBase()
  const urls: string[] = []
  if (workerBase) urls.push(`${workerBase}/mal/token`)
  urls.push(MAL_TOKEN_URL)
  let lastError: any = null
  for (const url of urls) {
    try {
      const ctrl = new AbortController()
      const tid = setTimeout(() => ctrl.abort(), 8000)
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
          body: body.toString(),
          signal: ctrl.signal,
        })
        return res
      } finally { clearTimeout(tid) }
    } catch (e) {
      lastError = e
      const msg = e instanceof Error ? e.message : String(e)
      const isCors = /Failed to fetch|NetworkError|Load failed|CORS/i.test(msg)
      const isAbort = (e as any)?.name === 'AbortError'
      // If CORS and we have a fallback URL, try next
      if (isCors && !isAbort) continue
      if (isAbort) throw new Error('MyAnimeList request timed out after 8s')
      throw e
    }
  }
  throw lastError ?? new Error('MAL token request failed')
}

function base64UrlEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sha256(text: string): Promise<ArrayBuffer> {
  const data = new TextEncoder().encode(text)
  return crypto.subtle.digest('SHA-256', data)
}

function randomString(length: number): string {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  let result = ''
  for (let i = 0; i < length; i++) result += charset[bytes[i] % charset.length]
  return result
}

export async function buildMalAuthorizeUrl(): Promise<string> {
  if (!MAL_CLIENT_ID) throw new Error('MAL client ID not configured. Set VITE_MAL_CLIENT_ID.')
  const verifier = randomString(96) // 43-128, use 96
  const state = randomString(32)
  const challengeBuffer = await sha256(verifier)
  const challenge = base64UrlEncode(challengeBuffer)
  setMalCodeVerifier(verifier)
  setMalOAuthState(state)
  const url = new URL(MAL_AUTH_URL)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', MAL_CLIENT_ID)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', state)
  // MAL requires exact redirect_uri match with the value registered in the MAL app settings.
  // For Aeri on GitHub Pages the registered value is exactly https://fastdemo.github.io/aeri/
  url.searchParams.set('redirect_uri', getMalRedirectUri())
  return url.toString()
}

export async function beginMalOAuth(): Promise<void> {
  const url = await buildMalAuthorizeUrl()
  window.location.href = url
}

export function getMalRedirectUriForDisplay(): string {
  try { return getMalRedirectUri() } catch { return window.location.origin + '/' }
}

export async function exchangeMalCodeForToken(code: string, verifier: string): Promise<{ access_token: string; refresh_token?: string; expires_in?: number }> {
  const body = new URLSearchParams()
  body.set('client_id', MAL_CLIENT_ID)
  body.set('grant_type', 'authorization_code')
  body.set('code', code)
  body.set('code_verifier', verifier)
  // Must match the redirect_uri sent to /authorize (exact string registered in MAL app)
  try {
    body.set('redirect_uri', getMalRedirectUri())
  } catch {}

  let res: Response
  try {
    res = await fetchMalTokenWithFallback(body)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/Failed to fetch|NetworkError|Load failed|CORS/i.test(msg)) {
      throw new Error(
        'MyAnimeList blocked the token request (CORS). Configure a worker via Settings → Playback Sources → Custom video endpoint (same worker proxies MAL), or use a browser with disabled CORS for testing. This is a MAL API limitation for static GH Pages.'
      )
    }
    throw e
  }

  const json = await res.json().catch(() => null)
  if (!res.ok || json?.error) {
    const msg = json?.error_description || json?.error || json?.message || res.statusText
    // If S256 is rejected, the error often mentions plain — surface clearly
    if (/code_challenge|plain/i.test(String(msg))) {
      throw new Error(`MAL token exchange failed: ${msg} — check that your MAL app allows PKCE S256 (or use worker proxy).`)
    }
    throw new Error(msg || `MAL token exchange failed (${res.status})`)
  }
  return json
}

export async function refreshMalToken(refreshToken: string): Promise<{ access_token: string; refresh_token?: string; expires_in?: number }> {
  const body = new URLSearchParams()
  body.set('client_id', MAL_CLIENT_ID)
  body.set('grant_type', 'refresh_token')
  body.set('refresh_token', refreshToken)

  let res: Response
  try {
    res = await fetchMalTokenWithFallback(body)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/Failed to fetch|NetworkError|Load failed|CORS/i.test(msg)) {
      throw new Error(
        'MyAnimeList blocked the refresh request (CORS). Configure a worker (Settings → customVideoApiUrl) to proxy MAL, or reconnect.'
      )
    }
    throw e
  }
  const json = await res.json().catch(() => null)
  if (!res.ok || json?.error) {
    const msg = json?.error_description || json?.error || res.statusText
    throw new Error(msg || `MAL refresh failed (${res.status})`)
  }
  return json
}

export async function handleMalOAuthCallback(): Promise<string | null> {
  const url = new URL(window.location.href)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')
  const errorDesc = url.searchParams.get('error_description')

  if (error) {
    clearMalOAuthState()
    clearMalCodeVerifier()
    // Clean URL and hand back to HashRouter
    url.searchParams.delete('code')
    url.searchParams.delete('state')
    url.searchParams.delete('error')
    url.searchParams.delete('error_description')
    const base = import.meta.env.BASE_URL as string
    const clean = `${window.location.origin}${base}#/`
    window.history.replaceState(null, '', clean)
    throw new Error(`MAL authorization failed: ${error}${errorDesc ? ` — ${errorDesc}` : ''}`)
  }

  if (!code) return null

  // Prevent double exchange on reload: if code was already exchanged, clean URL and return existing token
  const lastCode = (() => { try { return localStorage.getItem('aeri:mal:last_code') } catch { return null } })()
  if (lastCode === code) {
    const existing = (() => { try { return localStorage.getItem('aeri:mal:access_token') } catch { return null } })()
    url.searchParams.delete('code')
    url.searchParams.delete('state')
    const base = import.meta.env.BASE_URL as string
    const clean = `${window.location.origin}${base}#/`
    window.history.replaceState(null, '', clean)
    return existing
  }

  const expectedState = getMalOAuthState()
  if (state && expectedState && state !== expectedState) {
    clearMalOAuthState()
    clearMalCodeVerifier()
    url.searchParams.delete('code')
    url.searchParams.delete('state')
    const base = import.meta.env.BASE_URL as string
    const clean = `${window.location.origin}${base}#/`
    window.history.replaceState(null, '', clean)
    throw new Error('MAL state mismatch — possible CSRF. Try again.')
  }

  const verifier = getMalCodeVerifier()
  if (!verifier) {
    url.searchParams.delete('code')
    url.searchParams.delete('state')
    const base = import.meta.env.BASE_URL as string
    const clean = `${window.location.origin}${base}#/`
    window.history.replaceState(null, '', clean)
    throw new Error('MAL code verifier missing. Try login again.')
  }

  // Exchange (via worker if configured, else direct)
  const tokenRes = await exchangeMalCodeForToken(code, verifier)
  setMalTokens(tokenRes.access_token, tokenRes.refresh_token ?? null, tokenRes.expires_in)
  try { localStorage.setItem('aeri:mal:last_code', code) } catch {}

  // Clean URL and hand back to HashRouter
  clearMalOAuthState()
  clearMalCodeVerifier()
  url.searchParams.delete('code')
  url.searchParams.delete('state')
  const base = import.meta.env.BASE_URL as string
  const clean = `${window.location.origin}${base}#/`
  window.history.replaceState(null, '', clean)
  return tokenRes.access_token
}

export function parseMalManualToken(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('http')) {
    try {
      const u = new URL(trimmed)
      const c = u.searchParams.get('code') ?? u.hash.match(/access_token=([^&]+)/)?.[1]
      if (c) return c.trim()
    } catch {}
  }
  if (trimmed.length > 20) return trimmed
  return null
}

export function logoutMal() {
  clearMalTokens()
  try { window.dispatchEvent(new CustomEvent('aeri:mal:logout')) } catch {}
}
