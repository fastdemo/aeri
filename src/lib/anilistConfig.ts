export const ANILIST_CLIENT_ID: string =
  // Set VITE_ANILIST_CLIENT_ID in .env for your AniList app (https://anilist.co/settings/developer)
  // For local dev without a client, leave empty and use manual token paste in UI.
  // Do not hardcode — production value is supplied via Cloudflare build variable VITE_ANILIST_CLIENT_ID=50024
  (import.meta.env.VITE_ANILIST_CLIENT_ID as string | undefined)?.trim() || ''

export const ANILIST_AUTH_URL = 'https://anilist.co/api/v2/oauth/authorize'
export const ANILIST_TOKEN_URL = 'https://anilist.co/api/v2/oauth/token'
export const ANILIST_GRAPHQL = 'https://graphql.anilist.co'

export function getAnilistRedirectUri(): string {
  // Cloudflare production is https://aeri.fastdemo.workers.dev/ with base '/', GH Pages legacy was /aeri/
  // Keep redirect at origin + base so ?code can be parsed before HashRouter
  const base = import.meta.env.BASE_URL as string // e.g. / or /aeri/ (legacy)
  return `${window.location.origin}${base}`
}

export function buildAnilistAuthorizeUrl(state: string): string {
  if (!ANILIST_CLIENT_ID) return ''
  const redirect = getAnilistRedirectUri()
  const url = new URL(ANILIST_AUTH_URL)
  url.searchParams.set('client_id', ANILIST_CLIENT_ID)
  url.searchParams.set('response_type', 'code')
  // Include redirect_uri so AniList knows to return to the Cloudflare origin (https://aeri.fastdemo.workers.dev/)
  // Must exactly match the Redirect URL configured in https://anilist.co/settings/developer for this client
  url.searchParams.set('redirect_uri', redirect)
  url.searchParams.set('state', state)
  return url.toString()
}
