const TOKEN_KEY = 'aeri:anilist:token'
const TOKEN_EXPIRY_KEY = 'aeri:anilist:token_expiry'
const TOKEN_TYPE_KEY = 'aeri:anilist:token_type'

export function getAnilistToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function getAnilistTokenExpiry(): number | null {
  try {
    const v = localStorage.getItem(TOKEN_EXPIRY_KEY)
    return v ? Number(v) : null
  } catch {
    return null
  }
}

export function isAnilistTokenExpired(): boolean {
  const expiry = getAnilistTokenExpiry()
  if (!expiry) return false
  return Date.now() > expiry
}

export function setAnilistToken(token: string, expiresInSec?: number) {
  try {
    localStorage.setItem(TOKEN_KEY, token)
    if (expiresInSec) {
      localStorage.setItem(TOKEN_EXPIRY_KEY, String(Date.now() + expiresInSec * 1000))
    } else {
      localStorage.removeItem(TOKEN_EXPIRY_KEY)
    }
    localStorage.setItem(TOKEN_TYPE_KEY, 'Bearer')
  } catch {}
}

export function clearAnilistToken() {
  try {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(TOKEN_EXPIRY_KEY)
    localStorage.removeItem(TOKEN_TYPE_KEY)
  } catch {}
}
