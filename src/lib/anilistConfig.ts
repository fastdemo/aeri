export const ANILIST_CLIENT_ID: string =
  // Set VITE_ANILIST_CLIENT_ID in .env for your AniList app (https://anilist.co/settings/developer)
  // For local dev without a client, leave empty and use manual token paste in UI.
  (import.meta.env.VITE_ANILIST_CLIENT_ID as string | undefined)?.trim() ?? ''

export const ANILIST_AUTH_URL = 'https://anilist.co/api/v2/oauth/authorize'
export const ANILIST_GRAPHQL = 'https://graphql.anilist.co'

export function getAnilistRedirectUri(): string {
  // GitHub Pages base is /aeri/ — keep redirect at root of app so hash token can be parsed before HashRouter consumes it
  // Use location.origin + base (vite base)
  const base = import.meta.env.BASE_URL as string // e.g. /aeri/ or /
  return `${window.location.origin}${base}`
}

export function buildAnilistAuthorizeUrl(): string {
  if (!ANILIST_CLIENT_ID) return ''
  const redirect = getAnilistRedirectUri()
  const url = new URL(ANILIST_AUTH_URL)
  url.searchParams.set('client_id', ANILIST_CLIENT_ID)
  url.searchParams.set('response_type', 'token')
  // AniList implicit flow ignores redirect_uri if not matching registered one — we still pass it for correctness if app registered it
  // Some setups require exact match; we omit to avoid mismatch. Users should configure redirect to same origin base.
  void redirect
  return url.toString()
}
