import { ANILIST_CLIENT_ID, ANILIST_TOKEN_URL, buildAnilistAuthorizeUrl, getAnilistRedirectUri } from '../../lib/anilistConfig'
import { clearAnilistToken, getAnilistToken, setAnilistToken } from '../../storage/anilist'
import { getEffectiveVideoApiUrl } from '../../storage/preferences'

export function isAnilistAuthenticated(): boolean {
  return !!getAnilistToken()
}

export function beginAnilistOAuth(): void {
  if (ANILIST_CLIENT_ID) {
    const url = buildAnilistAuthorizeUrl()
    // Validate redirect is registered — AniList checks exact match; we rely on user configuring redirect as getAnilistRedirectUri()
    // If not configured, AniList will still return token to that URI if allowed; otherwise user must paste token manually.
    window.location.href = url
  } else {
    // No client configured — caller should show manual token UI
    throw new Error('AniList client ID not configured. Set VITE_ANILIST_CLIENT_ID or paste a personal token.')
  }
}

export function getRedirectUriForDisplay(): string {
  try {
    return getAnilistRedirectUri()
  } catch {
    return window.location.origin + '/'
  }
}

function getAnilistWorkerBase(): string | null {
  try {
    const base = getEffectiveVideoApiUrl()
    return base ? base.replace(/\/$/, '') : null
  } catch { return null }
}

async function fetchAnilistTokenWithFallback(body: URLSearchParams): Promise<Response> {
  const workerBase = getAnilistWorkerBase()
  const urls: string[] = []
  if (workerBase) {
    urls.push(`${workerBase}/api/anilist/token`)
    urls.push(`${workerBase}/anilist/token`)
  }
  urls.push(ANILIST_TOKEN_URL)
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
      if (isAbort) throw new Error('AniList request timed out after 8s')
      throw e
    }
  }
  throw lastError ?? new Error('AniList token request failed')
}

export async function exchangeAnilistCodeForToken(code: string): Promise<{ access_token: string; expires_in?: number }> {
  const body = new URLSearchParams()
  body.set('grant_type', 'authorization_code')
  body.set('client_id', ANILIST_CLIENT_ID)
  // client_secret is not available in static frontend; worker may inject via env if configured
  // AniList requires client_secret for code flow — without it the exchange will fail with unsupported_grant_type/auth errors,
  // but we try via worker which can hold the secret.
  try { body.set('redirect_uri', getAnilistRedirectUri()) } catch {}
  body.set('code', code)

  let res: Response
  try {
    res = await fetchAnilistTokenWithFallback(body)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/Failed to fetch|NetworkError|Load failed|CORS/i.test(msg)) {
      throw new Error(
        'AniList blocked the token request (CORS). If you use Authorization Code flow, configure a worker (Settings → Custom video endpoint) that can proxy AniList token exchange with your client_secret, or switch your AniList app to Implicit Grant (response_type=token) which needs no exchange. As fallback, paste a personal access token from https://anilist.co/settings/developer.'
      )
    }
    throw e
  }

  const json: any = await res.json().catch(() => null)
  const rawText = json ? JSON.stringify(json) : ''
  if (!res.ok || json?.error) {
    const err = json?.error || json?.message || res.statusText
    const hint = json?.hint || ''
    const msg = `${err}${hint ? ` — ${hint}` : ''}${rawText ? ` — ${rawText.slice(0, 300)}` : ''}`
    // Common misconfiguration: app set to Authorization Code but we use Implicit, or vice versa
    if (/unsupported_grant_type/i.test(String(err)) || /unsupported_grant_type/i.test(rawText)) {
      throw new Error(
        `AniList: ${msg} — Your AniList application may be set to Authorization Code grant but Aeri uses Implicit Grant (response_type=token) which needs no token exchange. Go to https://anilist.co/settings/developer → Edit app ${ANILIST_CLIENT_ID} → set Redirect URL exactly to ${getAnilistRedirectUri()} and use Implicit Grant, or paste a personal access token via "Paste token". If you need Code flow, set client_secret in your worker env and proxy via /api/anilist/token.`
      )
    }
    throw new Error(msg || `AniList token exchange failed (${res.status})`)
  }
  if (!json?.access_token) throw new Error('AniList token response missing access_token')
  return json
}

/**
 * Handle OAuth callback. AniList implicit grant returns #access_token=...&token_type=Bearer&expires_in=...
 * Due to HashRouter, our app lives at /aeri/#/ so the hash is double-used.
 * Examples after redirect:
 *   https://fastdemo.github.io/aeri/#access_token=xyz&...
 *   https://fastdemo.github.io/aeri/#access_token=xyz (when HashRouter path is /)
 * We must parse hash, extract token, clean URL to #/ (or preserve intended route).
 *
 * Also handles Authorization Code flow (?code=) via worker exchange as fallback when implicit is not available.
 */
export function handleAnilistOAuthCallback(): string | null {
  // Check for error in hash or search first (e.g. ?error=unsupported_grant_type from AniList)
  try {
    const searchErr = new URLSearchParams(window.location.search).get('error')
    const hashErr = new URLSearchParams((window.location.hash || '').slice(1)).get('error')
    const err = searchErr || hashErr
    if (err) {
      const desc = new URLSearchParams(window.location.search).get('error_description') || new URLSearchParams((window.location.hash || '').slice(1)).get('error_description') || ''
      // Clean URL
      try {
        const url = new URL(window.location.href)
        url.searchParams.delete('error')
        url.searchParams.delete('error_description')
        url.searchParams.delete('hint')
        const base = (import.meta as any).env?.BASE_URL as string || '/'
        const clean = `${window.location.origin}${base}#/`
        window.history.replaceState(null, '', clean)
      } catch {}
      const msg = `AniList: ${err}${desc ? ` — ${desc}` : ''}`
      if (/unsupported_grant_type/i.test(err) || /unsupported_grant_type/i.test(desc)) {
        throw new Error(
          `${msg} — Check that your AniList app ${ANILIST_CLIENT_ID} uses Implicit Grant and its Redirect URL is exactly ${getAnilistRedirectUri()}. Or paste a personal token.`
        )
      }
      throw new Error(msg)
    }
  } catch (e) {
    if (e instanceof Error && /AniList:/.test(e.message)) throw e
  }

  const rawHash = window.location.hash || ''
  // hash includes leading '#', content is like "#access_token=...&..."
  // For HashRouter, legitimate routes start with "#/" — token fragment starts with "#access_token"
  // If hash is "#access_token=..." we extract directly.
  // If hash is "#/access_token=..." unlikely.
  // Also handle "#/ + &access_token" edge.

  // Strategy: look for access_token in hash
  const hashParams = new URLSearchParams(rawHash.slice(1))
  const token = hashParams.get('access_token')

  if (token) {
    const expiresIn = hashParams.get('expires_in')
    const sec = expiresIn ? Number(expiresIn) : undefined
    setAnilistToken(token, sec)

    // Clean URL: remove token from hash. Use location.hash assignment so HashRouter receives hashchange.
    try {
      window.location.hash = '#/'
    } catch {
      try {
        const url = new URL(window.location.href)
        url.hash = '#/'
        window.history.replaceState(null, '', url.toString())
      } catch {}
    }
    return token
  }

  // Also support ?access_token in search (some flows)
  const searchParams = new URLSearchParams(window.location.search)
  const qToken = searchParams.get('access_token')
  if (qToken) {
    const sec = searchParams.get('expires_in') ? Number(searchParams.get('expires_in')) : undefined
    setAnilistToken(qToken, sec)
    try {
      const url = new URL(window.location.href)
      url.searchParams.delete('access_token')
      url.searchParams.delete('token_type')
      url.searchParams.delete('expires_in')
      window.history.replaceState(null, '', url.toString())
    } catch {}
    return qToken
  }

  // Authorization Code flow fallback — handled async via handleAnilistCodeCallback (see below)
  // Return null synchronously; caller should also await handleAnilistCodeCallback if ?code= present
  return null
}

export async function handleAnilistCodeCallback(): Promise<string | null> {
  const url = new URL(window.location.href)
  const code = url.searchParams.get('code')
  const err = url.searchParams.get('error')
  const errDesc = url.searchParams.get('error_description')
  if (err) {
    url.searchParams.delete('code')
    url.searchParams.delete('state')
    url.searchParams.delete('error')
    url.searchParams.delete('error_description')
    const base = (import.meta as any).env?.BASE_URL as string || '/'
    const clean = `${window.location.origin}${base}#/`
    window.history.replaceState(null, '', clean)
    const msg = `AniList: ${err}${errDesc ? ` — ${errDesc}` : ''}`
    if (/unsupported_grant_type/i.test(String(err)) || /unsupported_grant_type/i.test(String(errDesc))) {
      throw new Error(
        `${msg} — Your AniList app may be configured for a different OAuth flow than Aeri uses (Implicit Grant, response_type=token). Set Redirect URL to ${getAnilistRedirectUri()} and use Implicit Grant, or paste a personal token.`
      )
    }
    throw new Error(msg)
  }
  if (!code) return null
  // Avoid double exchange
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
  const tok = await exchangeAnilistCodeForToken(code)
  setAnilistToken(tok.access_token, tok.expires_in)
  try { localStorage.setItem('aeri:anilist:last_code', code) } catch {}
  url.searchParams.delete('code')
  url.searchParams.delete('state')
  const base = (import.meta as any).env?.BASE_URL as string || '/'
  const clean = `${window.location.origin}${base}#/`
  window.history.replaceState(null, '', clean)
  return tok.access_token
}

export function logoutAnilist() {
  clearAnilistToken()
  // optional: clear memory caches elsewhere via event
  try {
    window.dispatchEvent(new CustomEvent('aeri:anilist:logout'))
  } catch {}
}

export function parseManualToken(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  // Accept raw token or full URL fragment
  if (trimmed.startsWith('http')) {
    try {
      const u = new URL(trimmed)
      const hp = new URLSearchParams(u.hash.slice(1))
      const t = hp.get('access_token') ?? u.searchParams.get('access_token')
      if (t) return t.trim()
    } catch {}
  }
  if (trimmed.includes('access_token=')) {
    const hp = new URLSearchParams(trimmed.startsWith('#') ? trimmed.slice(1) : trimmed)
    const t = hp.get('access_token')
    if (t) return t.trim()
  }
  // Assume raw token (JWT-like, usually starts with ey...)
  if (trimmed.length > 20) return trimmed
  return null
}
