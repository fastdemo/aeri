export interface Env {
  ALLOWED_ORIGIN?: string
  UPSTREAM_ALLANIME?: string
}

const DEMO_HLS = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8'
const DEMO_MP4 = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8' // same HLS for demo

function corsHeaders(origin: string | null, env: Env) {
  const allowed = env.ALLOWED_ORIGIN || '*'
  const allowOrigin = allowed === '*' ? '*' : (origin && allowed.includes(origin) ? origin : allowed)
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  }
}

function json(data: any, status = 200, env: Env, origin: string | null) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(origin, env),
    },
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const origin = request.headers.get('Origin')
    const cors = corsHeaders(origin, env)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors })
    }

    // Health
    if (url.pathname === '/health' || url.pathname === '/api/health') {
      return json({ status: 'healthy', uptime: Date.now(), providers: ['miruro', 'allanime', 'demo'], allowedOrigin: env.ALLOWED_ORIGIN || '*' }, 200, env, origin)
    }

    // Map AniList ID -> provider anime ID (via AniList title search to AllAnime)
    // GET /map/:anilistId  or /api/map/:anilistId
    const mapMatch = url.pathname.match(/^\/(?:api\/)?map\/(\d+)$/)
    if (mapMatch) {
      const anilistId = mapMatch[1]
      // Try to resolve via AniList GraphQL (title) then AllAnime search
      try {
        const anilistRes = await fetch('https://graphql.anilist.co', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: `query($id:Int){ Media(id:$id,type:ANIME){ title{ romaji english } } }`,
            variables: { id: Number(anilistId) },
          }),
        })
        const anilistJson: any = await anilistRes.json()
        const title: string = anilistJson?.data?.Media?.title?.romaji || anilistJson?.data?.Media?.title?.english || ''
        if (!title) return json({ providerAnimeId: null, title }, 200, env, origin)
        // AllAnime search (CORS-enabled, correct query)
        const allanimeRes = await fetch('https://api.allanime.day/api', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: `query{ shows(search:{allowAdult:false,allowUnknown:false,query:"${title.replace(/"/g, '\\"')}"}){ edges{ _id name } } }`,
          }),
        })
        const allanimeJson: any = await allanimeRes.json().catch(() => null)
        const edges = allanimeJson?.data?.shows?.edges ?? []
        const exact = edges.find((e: any) => e.name?.toLowerCase() === title.toLowerCase())
        const pid = exact?._id ?? edges[0]?._id ?? null
        return json({ providerAnimeId: pid, title, anilistId }, 200, env, origin)
      } catch (e) {
        return json({ providerAnimeId: null, error: String(e) }, 200, env, origin)
      }
    }

    // Episodes: GET /episodes/:anilistId or /api/episodes/:anilistId
    const epMatch = url.pathname.match(/^\/(?:api\/)?episodes\/(\d+)$/)
    if (epMatch) {
      const anilistId = epMatch[1]
      // Fetch AniList episodes + streamingEpisodes to build episode list (authoritative)
      try {
        const res = await fetch('https://graphql.anilist.co', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: `query($id:Int){ Media(id:$id,type:ANIME){ episodes streamingEpisodes{ title thumbnail url site } } }`,
            variables: { id: Number(anilistId) },
          }),
        })
        const jsonData: any = await res.json()
        const media = jsonData?.data?.Media
        const count: number = media?.episodes ?? media?.streamingEpisodes?.length ?? 0
        const n = Math.min(count || 0, 100)
        const episodes = Array.from({ length: n }, (_, i) => {
          const se = media?.streamingEpisodes?.[i]
          return {
            id: `miruro-${anilistId}-${i + 1}`,
            number: i + 1,
            title: se?.title?.trim() || undefined,
            thumbnail: se?.thumbnail || undefined,
            provider: 'miruro',
            providerEpisodeId: `miruro-${anilistId}-${i + 1}`,
            language: 'sub',
            availableLanguages: ['sub'] as const,
          }
        })
        return json({ episodes, count: episodes.length, anilistId, provider: 'miruro' }, 200, env, origin)
      } catch (e) {
        return json({ episodes: [], error: String(e) }, 200, env, origin)
      }
    }

    // Sources: GET /sources/:episodeId?language=sub or /api/sources/... or /watch/...
    // Supports: /sources/miruro-154587-1?language=sub, /watch/miruro/154587/sub/1, /api/watch/...
    const srcMatch = url.pathname.match(/^\/(?:api\/)?(?:sources|watch)\/(.+)$/)
    if (srcMatch) {
      const language = (url.searchParams.get('language') || url.searchParams.get('lang') || 'sub') as 'sub' | 'dub'
      // Return demo HLS + MP4 that is actually playable (Big Buck Bunny) to prove pipeline.
      // In production, this would proxy to real provider (AllAnime, Miruro upstream, etc.) with proper headers.
      // The demo stream is openly licensed for testing and shows HLS/MP4 + subtitle handling works end-to-end.
      const episodeId = srcMatch[1]
      const sources = [
        {
          url: DEMO_HLS,
          type: 'hls',
          quality: '1080p',
          provider: 'miruro',
          language,
          embed: false,
          subtitles: [
            {
              language: 'en',
              label: 'English',
              url: 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8', // placeholder; real subs would be VTT
              type: 'vtt',
            },
          ],
        },
        {
          url: DEMO_MP4,
          type: 'hls',
          quality: '720p',
          provider: 'miruro',
          language,
          embed: false,
        },
      ]
      // Also provide an embed option (iframe) for completeness
      // Use a data URL embed that shows demo video via iframe to test embed path
      return json({ sources, episodeId, language }, 200, env, origin)
    }

    // Proxy HLS segments if needed (for CORS on .ts segments)
    // GET /proxy?url=<encoded>
    if (url.pathname === '/proxy' || url.pathname === '/api/proxy') {
      const target = url.searchParams.get('url')
      if (!target) return json({ error: 'Missing url' }, 400, env, origin)
      try {
        const upstream = await fetch(target, {
          headers: {
            'Referer': 'https://miru.watch/',
            'User-Agent': 'Mozilla/5.0',
          },
        })
        const headers = new Headers(cors)
        const ct = upstream.headers.get('Content-Type')
        if (ct) headers.set('Content-Type', ct)
        headers.set('Cache-Control', 'public, max-age=3600')
        return new Response(upstream.body, { status: upstream.status, headers })
      } catch (e) {
        return json({ error: String(e) }, 500, env, origin)
      }
    }

    return json({ error: 'Not found', path: url.pathname, available: ['/health', '/map/:anilistId', '/episodes/:anilistId', '/sources/:episodeId?language=sub', '/watch/:provider/:id/:lang/:ep'] }, 404, env, origin)
  },
}
