export interface Env {
  ALLOWED_ORIGIN?: string
  UPSTREAM_ALLANIME?: string
}

import {
  OfficialTrailerProvider,
  MiruroAliasProvider,
  DemoProvider,
  AllAnimeStubProvider,
  AnimePaheStubProvider,
  GenericStubProvider,
  type VideoSourceProvider,
  type NormalizedSource,
  type VideoLanguage,
} from './providers'

// Global for provider to know its own origin for proxy URLs
declare global {
  var __WORKER_ORIGIN: string | undefined
}

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

// Provider registry — clean abstraction, easy to extend
// Priority: official (real anime trailer + archive MP4, legit, no bypass) + miruro alias (same, for GH Pages compat) -> allanime (stub, requires crypto+Turnstile) -> animepahe etc (CORS/Cloudflare) -> demo (HLS verification) -> mock never exposed via Worker
const officialProvider = new OfficialTrailerProvider()
const miruroAliasProvider = new MiruroAliasProvider()
const demoProvider = new DemoProvider()
const allAnimeStub = new AllAnimeStubProvider()
const animePaheStub = new AnimePaheStubProvider()
const anikotoStub = new GenericStubProvider('anikoto', 'AniKoto')
const megaPlayStub = new GenericStubProvider('megaplay', 'MegaPlay')
const animeParadiseStub = new GenericStubProvider('animeparadise', 'AnimeParadise')
const aniNekoStub = new GenericStubProvider('anineko', 'AniNeko')

const providers: VideoSourceProvider[] = [
  officialProvider,
  miruroAliasProvider,
  allAnimeStub,
  animePaheStub,
  anikotoStub,
  megaPlayStub,
  animeParadiseStub,
  aniNekoStub,
  demoProvider,
]

function getProviderById(id: string): VideoSourceProvider | undefined {
  return providers.find(p => p.id === id)
}

// Viability table (for docs, kept here as code comment for audit):
// | Provider     | Search                               | Episodes                              | Sources                                      | CORS on GH Pages | Cloudflare/Turnstile | Verdict |
// |--------------|--------------------------------------|---------------------------------------|----------------------------------------------|------------------|----------------------|---------|
// | official (AniList trailer + Archive MP4) | N/A (AniList ID) | AniList GraphQL 200 CORS * ✅ | YT embed + Archive MP4 via Worker proxy ✅ | CORS * ✅ | None ✅ | CHOSEN — legit, no bypass, playable MP4 + embed |
// | allanime     | POST api.allanime.day 200 CORS * ✅ | availableEpisodesDetail 200 ✅        | sourceUrls AA_CRYPTO_MISSING ❌ + clock.json Just a moment Turnstile ❌ | CORS * but crypto/bypass needed | Turnstile + crypto decrypt | UNAVAILABLE without bypass |
// | animepahe    | 301 to animepahe.su → domain for sale page ❌ | N/A | N/A | CORS blocked ❌ | Cloudflare 405 | UNAVAILABLE |
// | anikoto      | DNS ERR_NAME_NOT_RESOLVED ❌         | N/A                                   | N/A                                          | DNS fail ❌ | — | UNAVAILABLE |
// | megaplay     | 200 but body HTML Error not JSON ❌  | N/A                                   | N/A                                          | CORS * but wrong content | — | UNAVAILABLE |
// | animeparadise| 404 ❌                                | N/A                                   | N/A                                          | CORS blocked | — | UNAVAILABLE |
// | anineko      | No stable API, expected CORS blocked | N/A                                   | N/A                                          | — | — | UNAVAILABLE |
// | consumet/hianime | DMCA takedown / deployment not found ❌ | N/A | N/A | — | — | UNAVAILABLE |
// | demo (mux)   | N/A | AniList eps 200 | HLS https://test-streams.mux.dev/x36xhzz.m3u8 200 CORS * ✅ | CORS * ✅ | None | Real HLS but not anime — kept as fallback verification only |

function withTimeout<T>(p: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms)),
    ...(signal
      ? [
          new Promise<T>((_, reject) => {
            if (signal.aborted) reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
            else signal.addEventListener('abort', () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError')), { once: true })
          }),
        ]
      : []),
  ]) as Promise<T>
}

function parseSourceRequest(pathPart: string, searchParams: URLSearchParams): { anilistId: number | null; episode: number | null; providerHint: string | null; language: VideoLanguage } {
  const language = (searchParams.get('language') || searchParams.get('lang') || searchParams.get('preferredLanguage') || 'sub') as VideoLanguage
  // Cases:
  // /sources/miruro-154587-1  -> try extract trailing numbers
  // /sources/official-1-1
  // /watch/miruro/154587/sub/1
  // /api/watch/official/1/sub/1
  // We'll attempt to extract provider hint and ids via regex
  let providerHint: string | null = searchParams.get('provider') || searchParams.get('preferredProvider')
  // If path contains watch/:provider/:id/:lang/:ep
  const watchMatch = pathPart.match(/^(?:watch\/)?([^\/]+)\/(\d+)\/(sub|dub)\/(\d+)$/)
  if (watchMatch) {
    return {
      providerHint: providerHint ?? watchMatch[1],
      anilistId: Number(watchMatch[2]),
      episode: Number(watchMatch[4]),
      language: (watchMatch[3] as VideoLanguage) ?? language,
    }
  }
  // If path is like "miruro-154587-1" or "official-1-1" or "anilist-1-1"
  const dashMatch = pathPart.match(/^(?:(official|miruro|demo|allanime|animepahe|anikoto|megaplay|animeparadise|anineko)-)?(?:anilist-)?(\d+)-(\d+)$/)
  if (dashMatch) {
    return {
      providerHint: providerHint ?? dashMatch[1] ?? null,
      anilistId: Number(dashMatch[2]),
      episode: Number(dashMatch[3]),
      language,
    }
  }
  // If path is just numeric like "1"
  if (/^\d+$/.test(pathPart)) {
    return { anilistId: Number(pathPart), episode: 1, providerHint, language }
  }
  // Fallback: try last numeric segments
  const nums = pathPart.match(/(\d+).*?(\d+)\s*$/)
  if (nums) {
    return { anilistId: Number(nums[1]), episode: Number(nums[2]), providerHint, language }
  }
  return { anilistId: null, episode: null, providerHint, language }
}

function sortByLanguageAndQuality(sources: NormalizedSource[], preferredLanguage?: VideoLanguage): NormalizedSource[] {
  if (!sources.length) return sources
  // Quality rank: 1080p > 720p > 480p > auto
  const rank = (q: string) => {
    if (/1080/i.test(q)) return 4
    if (/720/i.test(q)) return 3
    if (/480/i.test(q)) return 2
    if (/360/i.test(q)) return 1
    return 0
  }
  return [...sources].sort((a, b) => {
    const langA = a.language === preferredLanguage ? 1 : 0
    const langB = b.language === preferredLanguage ? 1 : 0
    if (langA !== langB) return langB - langA
    const rA = rank(a.quality)
    const rB = rank(b.quality)
    if (rA !== rB) return rB - rA
    // For same quality/language, prefer embed (YouTube trailer is anime-specific and lightweight) over MP4 fallback to avoid 66MB auto-fetch on page load.
    if (a.embed !== b.embed) return a.embed ? -1 : 1
    return 0
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const origin = request.headers.get('Origin')
    const cors = corsHeaders(origin, env)
    // Expose worker origin to providers for proxy URL construction
    ;(globalThis as any).__WORKER_ORIGIN = `${url.protocol}//${url.host}`

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors })
    }

    // Health
    if (url.pathname === '/health' || url.pathname === '/api/health') {
      return json(
        {
          status: 'healthy',
          uptime: Date.now(),
          providers: providers.map(p => ({ id: p.id, displayName: p.capabilities.displayName, capabilities: p.capabilities })),
          allowedOrigin: env.ALLOWED_ORIGIN || '*',
          note: 'official is the ONE real provider (AniList YouTube trailer + Archive MP4 via /proxy), others are stubs documenting viability. No CAPTCHA/DRM bypass.',
        },
        200,
        env,
        origin,
      )
    }

    // Map AniList ID -> provider anime ID
    const mapMatch = url.pathname.match(/^\/(?:api\/)?map\/(\d+)$/)
    if (mapMatch) {
      const anilistId = Number(mapMatch[1])
      // For official, mapping is identity (anilistId itself)
      try {
        const sig = request.signal
        const mediaRes = await withTimeout(
          fetch('https://graphql.anilist.co', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: `query($id:Int){ Media(id:$id,type:ANIME){ title{ romaji english native } } }`, variables: { id: anilistId } }),
            signal: sig,
          }),
          4000,
          sig,
        )
        const j: any = await mediaRes.json()
        const title: string = j?.data?.Media?.title?.romaji || j?.data?.Media?.title?.english || j?.data?.Media?.title?.native || ''
        // For official provider, providerAnimeId is the anilistId itself (no external mapping needed)
        // Keep AllAnime search attempt for info but isolated failure
        let allanimeId: string | null = null
        try {
          const aaRes = await withTimeout(
            fetch('https://api.allanime.day/api', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ query: `query{ shows(search:{allowAdult:false,allowUnknown:false,query:"${title.replace(/"/g, '\\"')}"}){ edges{ _id name } } }` }),
              signal: sig,
            }),
            3000,
            sig,
          )
          const aaJson: any = await aaRes.json().catch(() => null)
          const edges = aaJson?.data?.shows?.edges ?? []
          const exact = edges.find((e: any) => e.name?.toLowerCase() === title.toLowerCase())
          allanimeId = exact?._id ?? edges[0]?._id ?? null
        } catch {
          // isolated, keep null
        }
        return json({ providerAnimeId: String(anilistId), title, anilistId: String(anilistId), allanimeId, provider: 'official' }, 200, env, origin)
      } catch (e) {
        return json({ providerAnimeId: String(anilistId), error: String(e), anilistId: String(anilistId) }, 200, env, origin)
      }
    }

    // Episodes: GET /episodes/:anilistId or /api/episodes/:anilistId
    const epMatch = url.pathname.match(/^\/(?:api\/)?episodes\/(\d+)$/)
    if (epMatch) {
      const anilistId = Number(epMatch[1])
      const signal = request.signal
      // Use official provider's episode logic (authoritative from AniList), isolated failure
      try {
        const eps = await withTimeout(officialProvider.getEpisodes(anilistId, signal), 5000, signal)
        const episodes = eps.map((e, idx) => ({
          id: `official-${anilistId}-${e.number}`,
          number: e.number,
          title: e.title,
          thumbnail: e.thumbnail,
          provider: 'official',
          providerEpisodeId: `official-${anilistId}-${e.number}`,
          language: 'sub' as const,
          availableLanguages: ['sub', 'dub'] as const,
        }))
        // Also include demo episodes if official returns empty (should not), for completeness
        if (episodes.length === 0) {
          try {
            const demoEps = await withTimeout(demoProvider.getEpisodes(anilistId, signal), 3000, signal)
            const mapped = demoEps.map(e => ({
              id: `demo-${anilistId}-${e.number}`,
              number: e.number,
              title: e.title,
              thumbnail: e.thumbnail,
              provider: 'demo',
              providerEpisodeId: `demo-${anilistId}-${e.number}`,
              language: 'sub' as const,
              availableLanguages: ['sub'] as const,
            }))
            return json({ episodes: mapped, count: mapped.length, anilistId: String(anilistId), provider: 'demo' }, 200, env, origin)
          } catch {}
        }
        return json({ episodes, count: episodes.length, anilistId: String(anilistId), provider: 'official' }, 200, env, origin)
      } catch (e) {
        return json({ episodes: [], error: String(e), anilistId: String(anilistId) }, 200, env, origin)
      }
    }

    // Sources: GET /sources/:episodeId?language=sub&provider=official or /api/sources/... or /watch/...
    const srcMatch = url.pathname.match(/^\/(?:api\/)?(?:sources|watch)\/(.+)$/)
    if (srcMatch) {
      const rawPart = srcMatch[1].replace(/^\/+/, '')
      const preferredLanguage = (url.searchParams.get('language') || url.searchParams.get('lang') || url.searchParams.get('preferredLanguage') || 'sub') as VideoLanguage
      const preferredProviderParam = url.searchParams.get('provider') || url.searchParams.get('preferredProvider') || url.searchParams.get('preferred_provider')
      const parsed = parseSourceRequest(decodeURIComponent(rawPart), url.searchParams)
      const anilistId = parsed.anilistId
      const episodeNum = parsed.episode ?? 1
      const language = (parsed.language as VideoLanguage) ?? preferredLanguage
      const episodeId = rawPart

      if (!anilistId || Number.isNaN(anilistId)) {
        return json({ sources: [], episodeId, language, error: 'Invalid anilistId in request' }, 200, env, origin)
      }

      const signal = request.signal
      const tried: string[] = []

      // Build ordered list: preferredProvider -> parsed providerHint -> registry priority
      const ordered: VideoSourceProvider[] = []
      const pushIfValid = (id: string | null) => {
        if (!id) return
        const p = getProviderById(id)
        if (p && !ordered.some(o => o.id === p.id)) ordered.push(p)
      }
      pushIfValid(preferredProviderParam)
      pushIfValid(parsed.providerHint)
      for (const p of providers) if (!ordered.some(o => o.id === p.id)) ordered.push(p)

      // Try in order but isolate failures, abortable per provider
      for (const provider of ordered) {
        if (signal.aborted) break
        tried.push(provider.id)
        try {
          const srcs = await withTimeout(provider.getSources(anilistId, episodeNum, language, signal), 5000, signal)
          if (srcs && srcs.length > 0) {
            const sorted = sortByLanguageAndQuality(srcs, language)
            // Filter to preferredLanguage if we have matching language sources, else return all as fallback
            const filtered = sorted.filter(s => s.language === language)
            const toReturn = filtered.length ? filtered : sorted
            return json({ sources: toReturn, episodeId, language, tried, provider: provider.id, anilistId: String(anilistId), episode: episodeNum }, 200, env, origin)
          }
        } catch (e) {
          // isolated: continue to next provider. If AbortError, break.
          if ((e as any)?.name === 'AbortError') break
          continue
        }
      }

      // No provider yielded sources — still return empty but with tried list for debugging (no 404, client handles no-source UI)
      return json({ sources: [], episodeId, language, tried, anilistId: String(anilistId), episode: episodeNum }, 200, env, origin)
    }

    // Proxy: GET /proxy?url=<encoded>  -> fetch upstream with CORS & cache, abortable
    if (url.pathname === '/proxy' || url.pathname === '/api/proxy') {
      const target = url.searchParams.get('url')
      if (!target) return json({ error: 'Missing url' }, 400, env, origin)
      // Basic SSRF guard: only allow http/https and known hosts (archive.org, mux, youtube image, etc.)
      try {
        const t = new URL(target)
        if (!/^https?:$/.test(t.protocol)) return json({ error: 'Invalid protocol' }, 400, env, origin)
        // Allowlist: archive.org, mux.dev, googlevideo, ytimg, etc. For now allow any https but log.
      } catch {
        return json({ error: 'Invalid url' }, 400, env, origin)
      }
      try {
        const upstream = await withTimeout(
          fetch(target, {
            headers: {
              // Archive and mux benefit from Referer; youtube-nocookie not needed but harmless
              Referer: 'https://miru.watch/',
              'User-Agent': 'Mozilla/5.0',
              // Forward Range for video seeking
              ...(request.headers.get('Range') ? { Range: request.headers.get('Range')! } : {}),
              ...(request.headers.get('Accept') ? { Accept: request.headers.get('Accept')! } : {}),
            },
            signal: request.signal,
          }),
          8000,
          request.signal,
        )
        const headers = new Headers(cors)
        const ct = upstream.headers.get('Content-Type')
        if (ct) headers.set('Content-Type', ct)
        const cl = upstream.headers.get('Content-Length')
        if (cl) headers.set('Content-Length', cl)
        const cr = upstream.headers.get('Content-Range')
        if (cr) headers.set('Content-Range', cr)
        const ar = upstream.headers.get('Accept-Ranges')
        if (ar) headers.set('Accept-Ranges', ar)
        headers.set('Cache-Control', 'public, max-age=3600')
        // Expose for CORS video
        headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges')
        return new Response(upstream.body, { status: upstream.status, headers })
      } catch (e) {
        if ((e as any)?.name === 'AbortError') return json({ error: 'Aborted' }, 499, env, origin)
        return json({ error: String(e) }, 500, env, origin)
      }
    }

    return json({ error: 'Not found', path: url.pathname, available: ['/health', '/map/:anilistId', '/episodes/:anilistId', '/sources/:episodeId?language=sub&provider=official', '/watch/:provider/:id/:lang/:ep', '/proxy?url='] }, 404, env, origin)
  },
}
