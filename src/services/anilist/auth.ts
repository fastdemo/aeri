import { ANILIST_CLIENT_ID, buildAnilistAuthorizeUrl, getAnilistRedirectUri } from '../../lib/anilistConfig'
import { clearAnilistToken, getAnilistToken, setAnilistToken, setAnilistOAuthState, getAnilistOAuthState, clearAnilistOAuthState } from '../../storage/anilist'
import { getEffectiveVideoApiUrl } from '../../storage/preferences'

export function isAnilistAuthenticated(): boolean {
  return !!getAnilistToken()
}

function getAnilistWorkerBase(): string | null {
  try {
    const base = getEffectiveVideoApiUrl()
    return base ? base.replace(/\/$/, '') : null
  } catch { return null }
}

function randomString(length: number): string {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  let result = ''
  for (let i = 0; i < length; i++) result += charset[bytes[i] % charset.length]
  return result
}

async function fetchAnilistTokenWithFallback(body: URLSearchParams): Promise<Response> {
  const workerBase = getAnilistWorkerBase()
  const urls: string[] = []
  if (workerBase) {
    urls.push(`${workerBase}/api/anilist/token`)
    urls.push(`${workerBase}/anilist/token`)
  }
  // Also try same-origin Worker (Cloudflare serves frontend + API at same origin)
  // This handles the case where customVideoApiUrl is not set but we are on https://aeri.fastdemo.workers.dev/
  urls.push(`/api/anilist/token`)
  urls.push(`/anilist/token`)
  // Do NOT fallback to direct https://anilist.co/api/v2/oauth/token — that would require client_secret in browser
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
      if (isCors && !isAbort) continue
      if (isAbort) throw new Error('AniList token request timed out after 8s')
      throw e
    }
  }
  throw lastError ?? new Error('AniList token request failed - Worker not reachable. Ensure Cloudflare Worker is deployed with ANILIST_CLIENT_SECRET.')
}

export async function beginAnilistOAuth(): Promise<void> {
  if (!ANILIST_CLIENT_ID) throw new Error('AniList client ID not configured. Set VITE_ANILIST_CLIENT_ID or paste a personal token.')
  const state = randomString(32)
  setAnilistOAuthState(state)
  const url = buildAnilistAuthorizeUrl(state)
  window.location.href = url
}

export function getRedirectUriForDisplay(): string {
  try {
    return getAnilistRedirectUri()
  } catch {
    return window.location.origin + '/'
  }
}

export async function exchangeAnilistCodeForToken(code: string, state: string | null): Promise<{ access_token: string; token_type?: string; expires_in?: number }> {
  const expectedState = getAnilistOAuthState()
  if (state && expectedState && state !== expectedState) {
    clearAnilistOAuthState()
    throw new Error('AniList state mismatch — possible CSRF. Try again.')
  }
  const redirectUri = getAnilistRedirectUri()
  const body = new URLSearchParams()
  body.set('grant_type', 'authorization_code')
  body.set('client_id', ANILIST_CLIENT_ID)
  body.set('code', code)
  body.set('redirect_uri', redirectUri)
  // client_secret will be injected by the Worker from env.ANILIST_CLIENT_SECRET
  // Do not set it in the browser.

  let res: Response
  try {
    res = await fetchAnilistTokenWithFallback(body)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/Failed to fetch|NetworkError|Load failed|CORS/i.test(msg)) {
      throw new Error('AniList blocked the token request. Ensure the Cloudflare Worker at ' + (getAnilistWorkerBase() || window.location.origin) + ' is deployed with ANILIST_CLIENT_SECRET (Cloudflare secret). This is required for Authorization Code flow.')
    }
    throw e
  }

  const json = await res.json().catch(() => null)
  if (!res.ok || json?.error) {
    const msg = json?.error_description || json?.error || json?.message || res.statusText
    if (/invalid_grant|invalid_code|code.*expired/i.test(String(msg))) {
      throw new Error(`AniList token exchange failed: ${msg} — the code may have expired. Try logging in again.`)
    }
    if (/client_secret|secret/i.test(String(msg))) {
      throw new Error(`AniList token exchange failed: ${msg} — Worker secret ANILIST_CLIENT_SECRET may be missing or incorrect. Configure it in Cloudflare dashboard > Workers > aeri > Settings > Variables > Secrets.`)
    }
    throw new Error(msg || `AniList token exchange failed (${res.status})`)
  }
  return json
}

/**
 * Handle OAuth callback. AniList Authorization Code flow returns ?code=...&state=...
 * Must be called from AniListContext useEffect. Validates state, exchanges code via Worker, stores token, cleans URL.
 */
export async function handleAnilistOAuthCallback(): Promise<string | null> {
  const url = new URL(window.location.href)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')
  const errorDesc = url.searchParams.get('error_description')

  if (error) {
    clearAnilistOAuthState()
    url.searchParams.delete('code')
    url.searchParams.delete('state')
    url.searchParams.delete('error')
    url.searchParams.delete('error_description')
    const base = (import.meta as any).env?.BASE_URL as string || '/'
    const clean = `${window.location.origin}${base}#/`
    window.history.replaceState(null, '', clean)
    throw new Error(`AniList authorization failed: ${error}${errorDesc ? ` — ${errorDesc}` : ''}`)
  }

  if (!code) return null

  // Prevent double exchange on reload
  const lastCode = (() => { try { return localStorage.getItem('aeri:anilist:last_code') } catch { return null } })()
  if (lastCode === code) {
    const existing = getAnilistToken()
    url.searchParams.delete('code')
    url.searchParams.delete('state')
    const base = (import.meta as any).env?.BASE_URL as string || '/'
    const clean = `${window.location.origin}${base}#/`
    window.history.replaceState(null, '', clean)
    return existing
  }

  const expectedState = getAnilistOAuthState()
  if (state && expectedState && state !== expectedState) {
    clearAnilistOAuthState()
    url.searchParams.delete('code')
    url.searchParams.delete('state')
    const base = (import.meta as any).env?.BASE_URL as string || '/'
    const clean = `${window.location.origin}${base}#/`
    window.history.replaceState(null, '', clean)
    throw new Error('AniList state mismatch — possible CSRF. Try again.')
  }

  if (!getAnilistOAuthState() && state) {
    // No stored state (e.g., fresh context, storage cleared) — still allow but warn
    // Do not throw, just proceed
  }

  const tokenRes = await exchangeAnilistCodeForToken(code, state)
  const token = tokenRes.access_token
  if (!token) throw new Error('AniList token exchange returned no access_token')
  const expiresIn = tokenRes.expires_in
  setAnilistToken(token, expiresIn)
  try { localStorage.setItem('aeri:anilist:last_code', code) } catch {}
  clearAnilistOAuthState()
  url.searchParams.delete('code')
  url.searchParams.delete('state')
  const base = (import.meta as any).env?.BASE_URL as string || '/'
  const clean = `${window.location.origin}${base}#/`
  window.history.replaceState(null, '', clean)
  return token
}

export function logoutAnilist() {
  clearAnilistToken()
  clearAnilistOAuthState()
  try { localStorage.removeItem('aeri:anilist:last_code') } catch {}
  try {
    window.dispatchEvent(new CustomEvent('aeri:anilist:logout'))
  } catch {}
}

export function parseManualToken(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('http')) {
    try {
      const u = new URL(trimmed)
      // Support pasting a code URL: https://aeri.fastdemo.workers.dev/?code=...&state=...
      const code = u.searchParams.get('code')
      if (code) return code.trim() // Will be exchanged via Worker, not direct token
      const hp = new URLSearchParams(u.hash.slice(1))
      const t = hp.get('access_token') ?? u.searchParams.get('access_token')
      if (t) return t.trim()
    } catch {}
  }
  if (trimmed.includes('code=')) {
    try {
      const u = new URL(trimmed.startsWith('http') ? trimmed : `https://aeri.fastdemo.workers.dev/?${trimmed}`)
      const c = u.searchParams.get('code')
      if (c) return c.trim()
    } catch {}
  }
  if (trimmed.includes('access_token=')) {
    const hp = new URLSearchParams(trimmed.startsWith('#') ? trimmed.slice(1) : trimmed)
    const t = hp.get('access_token')
    if (t) return t.trim()
  }
  if (trimmed.length > 20) return trimmed
  return null
}
