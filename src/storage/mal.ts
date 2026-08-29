const TOKEN_KEY = 'aeri:mal:access_token'
const REFRESH_KEY = 'aeri:mal:refresh_token'
const EXPIRY_KEY = 'aeri:mal:token_expiry'
const STATE_KEY = 'aeri:mal:oauth_state'
const VERIFIER_KEY = 'aeri:mal:code_verifier'

export function getMalToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}
export function getMalRefreshToken(): string | null {
  try { return localStorage.getItem(REFRESH_KEY) } catch { return null }
}
export function getMalTokenExpiry(): number | null {
  try { const v = localStorage.getItem(EXPIRY_KEY); return v ? Number(v) : null } catch { return null }
}
export function isMalTokenExpired(): boolean {
  const e = getMalTokenExpiry()
  if (!e) return false
  return Date.now() > e - 60_000 // 1min buffer
}
export function setMalTokens(accessToken: string, refreshToken?: string | null, expiresInSec?: number) {
  try {
    localStorage.setItem(TOKEN_KEY, accessToken)
    if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken)
    if (expiresInSec) localStorage.setItem(EXPIRY_KEY, String(Date.now() + expiresInSec * 1000))
    else localStorage.removeItem(EXPIRY_KEY)
  } catch {}
}
export function clearMalTokens() {
  try {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(REFRESH_KEY)
    localStorage.removeItem(EXPIRY_KEY)
    localStorage.removeItem(STATE_KEY)
    localStorage.removeItem(VERIFIER_KEY)
  } catch {}
}
export function setMalOAuthState(state: string) {
  try { localStorage.setItem(STATE_KEY, state) } catch {}
}
export function getMalOAuthState(): string | null {
  try { return localStorage.getItem(STATE_KEY) } catch { return null }
}
export function clearMalOAuthState() {
  try { localStorage.removeItem(STATE_KEY) } catch {}
}
export function setMalCodeVerifier(v: string) {
  try { localStorage.setItem(VERIFIER_KEY, v) } catch {}
}
export function getMalCodeVerifier(): string | null {
  try { return localStorage.getItem(VERIFIER_KEY) } catch { return null }
}
export function clearMalCodeVerifier() {
  try { localStorage.removeItem(VERIFIER_KEY) } catch {}
}
