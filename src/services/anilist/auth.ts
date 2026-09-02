import { ANILIST_CLIENT_ID, buildAnilistAuthorizeUrl, getAnilistRedirectUri } from '../../lib/anilistConfig'
import { clearAnilistToken, getAnilistToken, setAnilistToken } from '../../storage/anilist'

export function isAnilistAuthenticated(): boolean {
  return !!getAnilistToken()
}

export function beginAnilistOAuth(): void {
  if (ANILIST_CLIENT_ID) {
    const url = buildAnilistAuthorizeUrl()
    window.location.href = url
  } else {
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
 * Due to HashRouter, our app lives at /#/ so the hash is double-used.
 * We must parse hash, extract token, clean URL to #/.
 * This is PURE implicit flow - no token exchange via /api/anilist/token.
 */
export function handleAnilistOAuthCallback(): string | null {
  // Check for error in hash or search first (e.g. ?error=unsupported_grant_type from AniList)
  try {
    const searchErr = new URLSearchParams(window.location.search).get('error')
    const hashErr = new URLSearchParams((window.location.hash || '').slice(1)).get('error')
    const err = searchErr || hashErr
    if (err) {
      const desc = new URLSearchParams(window.location.search).get('error_description') || new URLSearchParams((window.location.hash || '').slice(1)).get('error_description') || ''
      const hint = new URLSearchParams(window.location.search).get('hint') || new URLSearchParams((window.location.hash || '').slice(1)).get('hint') || ''
      try {
        const url = new URL(window.location.href)
        url.searchParams.delete('error')
        url.searchParams.delete('error_description')
        url.searchParams.delete('hint')
        const base = (import.meta as any).env?.BASE_URL as string || '/'
        const clean = `${window.location.origin}${base}#/`
        window.history.replaceState(null, '', clean)
      } catch {}
      const msg = `AniList: ${err}${desc ? ` — ${desc}` : ''}${hint ? ` — ${hint}` : ''}`
      if (/unsupported_grant_type/i.test(err) || /unsupported_grant_type/i.test(desc) || /unsupported_grant_type/i.test(hint)) {
        throw new Error(
          `${msg} — Check that your AniList app ${ANILIST_CLIENT_ID} uses Implicit Grant (response_type=token) and its Redirect URL is exactly ${getAnilistRedirectUri()}. Aeri does NOT use authorization_code exchange for AniList.`
        )
      }
      throw new Error(msg)
    }
  } catch (e) {
    if (e instanceof Error && /AniList:/.test(e.message)) throw e
  }

  const rawHash = window.location.hash || ''
  const hashParams = new URLSearchParams(rawHash.slice(1))
  const token = hashParams.get('access_token')

  if (token) {
    const expiresIn = hashParams.get('expires_in')
    const sec = expiresIn ? Number(expiresIn) : undefined
    setAnilistToken(token, sec)
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
  if (trimmed.length > 20) return trimmed
  return null
}
