import { ANILIST_CLIENT_ID, buildAnilistAuthorizeUrl, getAnilistRedirectUri } from '../../lib/anilistConfig'
import { clearAnilistToken, getAnilistToken, setAnilistToken } from '../../storage/anilist'

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

/**
 * Handle OAuth callback. AniList implicit grant returns #access_token=...&token_type=Bearer&expires_in=...
 * Due to HashRouter, our app lives at /aeri/#/ so the hash is double-used.
 * Examples after redirect:
 *   https://fastdemo.github.io/aeri/#access_token=xyz&...
 *   https://fastdemo.github.io/aeri/#access_token=xyz (when HashRouter path is /)
 * We must parse hash, extract token, clean URL to #/ (or preserve intended route).
 */
export function handleAnilistOAuthCallback(): string | null {
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

  return null
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
