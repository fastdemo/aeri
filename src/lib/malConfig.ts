export const MAL_CLIENT_ID: string =
  (import.meta.env.VITE_MAL_CLIENT_ID as string | undefined)?.trim() || ''

export const MAL_AUTH_URL = 'https://myanimelist.net/v1/oauth2/authorize'
export const MAL_TOKEN_URL = 'https://myanimelist.net/v1/oauth2/token'
export const MAL_API_BASE = 'https://api.myanimelist.net/v2'

export function getMalRedirectUri(): string {
  const base = import.meta.env.BASE_URL as string
  return `${window.location.origin}${base}`
}

export function isMalConfigured(): boolean {
  return !!MAL_CLIENT_ID
}
