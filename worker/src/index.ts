export interface Env {
  ALLOWED_ORIGIN?: string
  PROXY_ALLOWLIST?: string
  ANILIST_CLIENT_ID?: string
  ANILIST_CLIENT_SECRET?: string
  ASSETS?: Fetcher
}

import {
  OfficialTrailerProvider,
  MiruroAliasProvider,
  DemoProvider,
  AllAnimeStubProvider,
  AnimePaheProvider,
  AnikotoProvider,
  GenericStubProvider,
  type VideoSourceProvider,
  type NormalizedSource,
  type VideoLanguage,
} from './providers'

function corsHeaders(origin: string | null, env: Env) {
  const raw = env.ALLOWED_ORIGIN || '*'
  const list = raw.split(',').map(s => s.trim()).filter(Boolean)
  const allowAll = list.includes('*')
  let allowOrigin = '*'
  if (!allowAll) {
    if (origin && list.includes(origin)) allowOrigin = origin
    else allowOrigin = list[0] || '*'
  }
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With, Range, Accept, X-MAL-CLIENT-ID',
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges',
    'Access-Control-Max-Age': '86400',
    'Vary': allowAll ? undefined : 'Origin',
  } as Record<string, string>
}

function json(data: any, status = 200, env: Env, origin: string | null, extraHeaders: Record<string,string> = {}) {
  const cors = corsHeaders(origin, env)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...cors,
    ...extraHeaders,
  }
  // Remove undefined Vary when allowAll
  if (!headers['Vary']) delete headers['Vary']
  return new Response(JSON.stringify(data), { status, headers })
}

const officialProvider = new OfficialTrailerProvider()
const miruroAliasProvider = new MiruroAliasProvider()
const demoProvider = new DemoProvider()
const allAnimeStub = new AllAnimeStubProvider()
const animePaheProvider = new AnimePaheProvider()
const anikotoProvider = new AnikotoProvider()
const megaPlayStub = new GenericStubProvider('megaplay', 'MegaPlay')
const animeParadiseStub = new GenericStubProvider('animeparadise', 'AnimeParadise')
const aniNekoStub = new GenericStubProvider('anineko', 'AniNeko')

const providers: VideoSourceProvider[] = [
  officialProvider,
  anikotoProvider,
  animePaheProvider,
  miruroAliasProvider,
  allAnimeStub,
  megaPlayStub,
  animeParadiseStub,
  aniNekoStub,
  demoProvider,
]
const priorityProviders = [officialProvider, miruroAliasProvider, demoProvider]

function getProviderById(id: string): VideoSourceProvider | undefined {
  return providers.find(p => p.id === id)
}

function withTimeout<T>(p: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms)),
    ...(signal ? [new Promise<T>((_, reject) => {
      if (signal.aborted) reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
      else signal.addEventListener('abort', () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError')), { once: true })
    })] : []),
  ]) as Promise<T>
}

function parseSourceRequest(pathPart: string, searchParams: URLSearchParams): { anilistId: number | null; episode: number | null; providerHint: string | null; language: VideoLanguage } {
  const language = (searchParams.get('language') || searchParams.get('lang') || searchParams.get('preferredLanguage') || 'sub') as VideoLanguage
  let providerHint: string | null = searchParams.get('provider') || searchParams.get('preferredProvider') || searchParams.get('preferred_provider')
  const watchMatch = pathPart.match(/^(?:watch\/)?([^\/]+)\/(\d+)\/(sub|dub)\/(\d+)$/)
  if (watchMatch) {
    return {
      providerHint: providerHint ?? watchMatch[1],
      anilistId: Number(watchMatch[2]),
      episode: Number(watchMatch[4]),
      language: (watchMatch[3] as VideoLanguage) ?? language,
    }
  }
  const dashMatch = pathPart.match(/^(?:(official|miruro|demo|allanime|animepahe|anikoto|megaplay|animeparadise|anineko)-)?(?:anilist-)?(\d+)-(\d+)$/)
  if (dashMatch) {
    return {
      providerHint: providerHint ?? dashMatch[1] ?? null,
      anilistId: Number(dashMatch[2]),
      episode: Number(dashMatch[3]),
      language,
    }
  }
  if (/^\d+$/.test(pathPart)) {
    return { anilistId: Number(pathPart), episode: 1, providerHint, language }
  }
  const nums = pathPart.match(/(\d+).*?(\d+)\s*$/)
  if (nums) {
    return { anilistId: Number(nums[1]), episode: Number(nums[2]), providerHint, language }
  }
  return { anilistId: null, episode: null, providerHint, language }
}

function sortByLanguageAndQuality(sources: NormalizedSource[], preferredLanguage?: VideoLanguage): NormalizedSource[] {
  if (!sources.length) return sources
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
    if (a.embed !== b.embed) return a.embed ? -1 : 1
    return 0
  })
}

const CACHE_CONTROL_EPISODES = 'public, max-age=3600, stale-while-revalidate=600'
const CACHE_CONTROL_SOURCES = 'public, max-age=60, stale-while-revalidate=60'
const CACHE_CONTROL_HEALTH = 'no-store'

function isAllowedHost(hostname: string, allowlist: string[]): boolean {
  const h = hostname.toLowerCase()
  return allowlist.some(a => {
    const al = a.toLowerCase().trim()
    if (!al) return false
    if (al.startsWith('*.')) return h === al.slice(2) || h.endsWith('.' + al.slice(2))
    return h === al || h.endsWith('.' + al)
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const origin = request.headers.get('Origin')
    const cors = corsHeaders(origin, env)
    const workerOrigin = `${url.protocol}//${url.host}`

    if (request.method === 'OPTIONS') {
      const h: Record<string,string> = { ...cors }
      if (!h['Vary']) delete h['Vary']
      return new Response(null, { status: 204, headers: h })
    }

    if (url.pathname === '/health' || url.pathname === '/api/health' || url.pathname === '/api/video/health') {
      return json({
        status: 'healthy',
        version: '1.0.0',
        allowedOrigin: env.ALLOWED_ORIGIN || '*',
        providers: providers.map(p => ({ id: p.id, displayName: p.capabilities.displayName, capabilities: p.capabilities })),
        note: 'official is the ONE real provider (AniList YouTube trailer + Archive MP4 via /proxy), others are stubs documenting viability.',
      }, 200, env, origin, { 'Cache-Control': CACHE_CONTROL_HEALTH })
    }

    const mapMatch = url.pathname.match(/^\/(?:api\/)?(?:video\/)?map\/(\d+)$/)
    if (mapMatch) {
      const anilistId = Number(mapMatch[1])
      if (!Number.isFinite(anilistId) || anilistId <= 0) return json({ error: 'Invalid anilistId' }, 400, env, origin)
      // For Cloudflare Workers, AniList GraphQL is often 403 due to IP block ("manually blocked").
      // Avoid fetching AniList from the worker for the basic map — the frontend already has the title via direct browser fetch.
      // Return a simple mapping where providerAnimeId == anilistId; the frontend will use its own AniList data for titles.
      // We still try to fetch AllAnime for convenience, but do not fail the whole request if AniList is blocked.
      let title = ''
      let allanimeId: string | null = null
      try {
        const sig = request.signal
        const mediaRes = await withTimeout(fetch('https://graphql.anilist.co', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'User-Agent': 'Aeri/1.0 (https://aeri.fastdemo.workers.dev)', 'Accept': 'application/json' },
          body: JSON.stringify({ query: `query($id:Int){ Media(id:$id,type:ANIME){ title{ romaji english native } } }`, variables: { id: anilistId } }),
          signal: sig,
        }), 4000, sig)
        if (mediaRes.ok) {
          const j: any = await mediaRes.json().catch(() => null)
          if (!j?.errors && j?.data?.Media) {
            title = j.data.Media.title?.romaji || j.data.Media.title?.english || j.data.Media.title?.native || ''
          }
        }
      } catch {}
      // Try AllAnime mapping if we have a title, but don't fail if blocked
      if (title) {
        try {
          const sig = request.signal
          const aaRes = await withTimeout(fetch('https://api.allanime.day/api', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: `query{ shows(search:{allowAdult:false,allowUnknown:false,query:"${title.replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\n/g,' ')}"}){ edges{ _id name } } }` }),
            signal: sig,
          }), 3000, sig)
          const aaJson: any = await aaRes.json().catch(() => null)
          const edges = aaJson?.data?.shows?.edges ?? []
          const exact = edges.find((e: any) => e.name?.toLowerCase() === title.toLowerCase())
          allanimeId = exact?._id ?? edges[0]?._id ?? null
        } catch {}
      }
      return json({ providerAnimeId: String(anilistId), title, anilistId: String(anilistId), allanimeId, provider: 'official' }, 200, env, origin, { 'Cache-Control': 'public, max-age=3600' })
    }

    const epMatch = url.pathname.match(/^\/(?:api\/)?(?:video\/)?episodes\/(\d+)$/)
    if (epMatch) {
      const anilistId = Number(epMatch[1])
      if (!Number.isFinite(anilistId) || anilistId <= 0) return json({ error: 'Invalid anilistId' }, 400, env, origin)
      const signal = request.signal
      const providerParam = url.searchParams.get('provider')
      // If provider param specified, delegate to that provider directly
      if (providerParam) {
        const p = getProviderById(providerParam)
        if (p) {
          try {
            const eps = await withTimeout(p.getEpisodes(anilistId, signal), 5000, signal)
            const episodes = eps.map(e => ({
              id: `${p.id}-${anilistId}-${e.number}`,
              number: e.number,
              title: e.title,
              thumbnail: e.thumbnail,
              provider: p.id,
              providerEpisodeId: `${p.id}-${anilistId}-${e.number}`,
              language: 'sub' as const,
              availableLanguages: p.capabilities.languages as any,
            }))
            return json({ episodes, count: episodes.length, anilistId: String(anilistId), provider: p.id }, 200, env, origin, { 'Cache-Control': CACHE_CONTROL_EPISODES })
          } catch (e) {
            if ((e as any)?.name === 'AbortError') return json({ error: 'Aborted' }, 499, env, origin)
            return json({ episodes: [], error: String(e), anilistId: String(anilistId) }, 502, env, origin)
          }
        }
      }
      try {
        const eps = await withTimeout(officialProvider.getEpisodes(anilistId, signal), 5000, signal)
        const episodes = eps.map(e => ({
          id: `official-${anilistId}-${e.number}`,
          number: e.number,
          title: e.title,
          thumbnail: e.thumbnail,
          provider: 'official',
          providerEpisodeId: `official-${anilistId}-${e.number}`,
          language: 'sub' as const,
          availableLanguages: ['sub', 'dub'] as const,
        }))
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
            if (mapped.length) return json({ episodes: mapped, count: mapped.length, anilistId: String(anilistId), provider: 'demo' }, 200, env, origin, { 'Cache-Control': CACHE_CONTROL_EPISODES })
          } catch {}
        }
        return json({ episodes, count: episodes.length, anilistId: String(anilistId), provider: 'official' }, 200, env, origin, { 'Cache-Control': CACHE_CONTROL_EPISODES })
      } catch (e) {
        if ((e as any)?.name === 'AbortError') return json({ error: 'Aborted' }, 499, env, origin)
        return json({ episodes: [], error: String(e), anilistId: String(anilistId) }, 502, env, origin)
      }
    }

    const srcMatch = url.pathname.match(/^\/(?:api\/)?(?:video\/)?(?:sources|watch)\/(.+)$/)
    if (srcMatch) {
      try {
        const rawPart = srcMatch[1].replace(/^\/+/, '')
        const preferredLanguage = (url.searchParams.get('language') || url.searchParams.get('lang') || url.searchParams.get('preferredLanguage') || 'sub') as VideoLanguage
        const preferredProviderParam = url.searchParams.get('provider') || url.searchParams.get('preferredProvider') || url.searchParams.get('preferred_provider')
        const parsed = parseSourceRequest(decodeURIComponent(rawPart), url.searchParams)
        const anilistId = parsed.anilistId
        const episodeNum = parsed.episode ?? 1
        const language = (parsed.language as VideoLanguage) ?? preferredLanguage
        const episodeId = rawPart
        if (!anilistId || Number.isNaN(anilistId) || anilistId <= 0) {
          return json({ error: 'Invalid anilistId in request', episodeId, language }, 400, env, origin)
        }
        if (!['sub','dub'].includes(language)) return json({ error: 'Invalid language, use sub or dub' }, 400, env, origin)
        const signal = request.signal
        const tried: string[] = []
        const ordered: VideoSourceProvider[] = []
        const pushIfValid = (id: string | null) => {
          if (!id) return
          const p = getProviderById(id)
          if (p && !ordered.some(o => o.id === p.id)) ordered.push(p)
        }
        pushIfValid(preferredProviderParam)
        pushIfValid(parsed.providerHint)
        for (const p of providers) if (!ordered.some(o => o.id === p.id)) ordered.push(p)
        const tryOrdered = ordered
        for (const provider of tryOrdered) {
          if (signal.aborted) break
          tried.push(provider.id)
          try {
            const srcs = await withTimeout(provider.getSources(anilistId, episodeNum, language, workerOrigin, signal), 5000, signal)
            if (srcs && srcs.length > 0) {
              const sorted = sortByLanguageAndQuality(srcs, language)
              const filtered = sorted.filter(s => s.language === language)
              const toReturn = filtered.length ? filtered : sorted
              return json({ sources: toReturn, episodeId, language, tried, provider: provider.id, anilistId: String(anilistId), episode: episodeNum }, 200, env, origin, { 'Cache-Control': CACHE_CONTROL_SOURCES })
            }
          } catch (e) {
            if ((e as any)?.name === 'AbortError') break
            continue
          }
          // If we've tried the 3 priority providers and all empty, don't waste 25s on 6 stubs that always empty — return early
          if (tried.length === priorityProviders.length && tried.every(id => ['official','miruro','demo'].includes(id))) {
            // If priority all tried and empty (unlikely for official), continue to stubs but they will also be empty — we still try for completeness but with shorter timeout inside getSources (they return [] instantly)
          }
        }
        return json({ sources: [], episodeId, language, tried, anilistId: String(anilistId), episode: episodeNum }, 200, env, origin, { 'Cache-Control': CACHE_CONTROL_SOURCES })
      } catch (e) {
        if ((e as any)?.name === 'AbortError') return json({ error: 'Aborted' }, 499, env, origin)
        return json({ error: String(e), sources: [], tried: [] }, 502, env, origin)
      }
    }

    // --- AniList token proxy (for Authorization Code flow when Implicit is not available) ---
    // POST /anilist/token -> https://anilist.co/api/v2/oauth/token
    if (url.pathname === '/anilist/token' || url.pathname === '/api/anilist/token') {
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, env, origin)
      try {
        let body = await request.text()
        // If body lacks client_secret but worker has it in env, inject it (allows static frontend to use Code flow without secret)
        try {
          const params = new URLSearchParams(body)
          if (!params.get('client_secret') && env.ANILIST_CLIENT_SECRET) {
            params.set('client_secret', env.ANILIST_CLIENT_SECRET)
            body = params.toString()
          }
          // Ensure grant_type present
          if (!params.get('grant_type')) {
            params.set('grant_type', 'authorization_code')
            body = params.toString()
          }
        } catch {}
        const upstream = await withTimeout(fetch('https://anilist.co/api/v2/oauth/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0',
          },
          body,
          signal: request.signal,
        }), 8000, request.signal)
        const text = await upstream.text()
        const h = new Headers(cors)
        if (!h.get('Vary')) h.delete('Vary')
        const ct = upstream.headers.get('Content-Type') || 'application/json'
        h.set('Content-Type', ct.includes('json') ? 'application/json' : ct)
        h.set('Cache-Control', 'no-store')
        return new Response(text, { status: upstream.status, headers: h })
      } catch (e) {
        if ((e as any)?.name === 'AbortError') return json({ error: 'Aborted' }, 499, env, origin)
        return json({ error: String(e) }, 502, env, origin)
      }
    }

    // --- MAL proxy (to bypass GH Pages CORS) ---
    // POST /mal/token  ->  https://myanimelist.net/v1/oauth2/token
    if (url.pathname === '/mal/token' || url.pathname === '/api/mal/token') {
      if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405, env, origin)
      try {
        const body = await request.text()
        const upstream = await withTimeout(fetch('https://myanimelist.net/v1/oauth2/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0',
          },
          body,
          signal: request.signal,
        }), 8000, request.signal)
        const text = await upstream.text()
        const h = new Headers(cors)
        if (!h.get('Vary')) h.delete('Vary')
        const ct = upstream.headers.get('Content-Type') || 'application/json'
        h.set('Content-Type', ct.includes('json') ? 'application/json' : ct)
        h.set('Cache-Control', 'no-store')
        return new Response(text, { status: upstream.status, headers: h })
      } catch (e) {
        if ((e as any)?.name === 'AbortError') return json({ error: 'Aborted' }, 499, env, origin)
        return json({ error: String(e) }, 502, env, origin)
      }
    }

    // GET/PUT /mal/api/*  ->  https://api.myanimelist.net/v2/*
    // also /api/mal/* for compatibility
    const malApiMatch = url.pathname.match(/^\/(?:mal\/api|api\/mal)\/(.*)$/)
    if (malApiMatch) {
      const malPath = malApiMatch[1]
      const target = `https://api.myanimelist.net/v2/${malPath}${url.search}`
      // Forward method, auth, and body
      const method = request.method
      if (!['GET','PUT','PATCH','POST','DELETE','OPTIONS'].includes(method)) return json({ error: 'Method not allowed' }, 405, env, origin)
      try {
        const headers: Record<string,string> = {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0',
        }
        const auth = request.headers.get('Authorization')
        if (auth) headers['Authorization'] = auth
        const xMal = request.headers.get('X-MAL-CLIENT-ID')
        if (xMal) headers['X-MAL-CLIENT-ID'] = xMal
        // For PUT/POST with form body, forward content-type and body
        let body: string | undefined
        if (method === 'PUT' || method === 'POST' || method === 'PATCH') {
          const ct = request.headers.get('Content-Type') || ''
          if (ct) headers['Content-Type'] = ct
          body = await request.text()
        }
        const upstream = await withTimeout(fetch(target, {
          method,
          headers,
          body,
          signal: request.signal,
        }), 8000, request.signal)
        const text = await upstream.text()
        const h = new Headers(cors)
        if (!h.get('Vary')) h.delete('Vary')
        const ct = upstream.headers.get('Content-Type') || 'application/json'
        h.set('Content-Type', ct.includes('json') ? 'application/json' : ct)
        // Pass through rate limit / auth headers for debugging if needed
        h.set('Cache-Control', upstream.headers.get('Cache-Control') || 'no-store')
        return new Response(text, { status: upstream.status, headers: h })
      } catch (e) {
        if ((e as any)?.name === 'AbortError') return json({ error: 'Aborted' }, 499, env, origin)
        return json({ error: String(e) }, 502, env, origin)
      }
    }

    if (url.pathname === '/proxy' || url.pathname === '/api/proxy') {
      const target = url.searchParams.get('url')
      if (!target) return json({ error: 'Missing url' }, 400, env, origin)
      let t: URL
      try {
        t = new URL(target)
        if (!/^https?:$/.test(t.protocol)) return json({ error: 'Invalid protocol' }, 400, env, origin)
        // Block private IPs and userinfo
        if (t.username || t.password) return json({ error: 'Invalid url' }, 400, env, origin)
        const host = t.hostname.toLowerCase()
        if (/^(127\.|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|0\.0\.0\.0|169\.254\.)/.test(host) || host === 'localhost' || host === '::1') {
          return json({ error: 'Host not allowed' }, 400, env, origin)
        }
        const allowRaw = env.PROXY_ALLOWLIST || 'archive.org,ia600200.us.archive.org,test-streams.mux.dev'
        const allowList = allowRaw.split(',').map(s=>s.trim()).filter(Boolean)
        if (!isAllowedHost(host, allowList)) return json({ error: 'Host not allowed', host }, 400, env, origin)
      } catch {
        return json({ error: 'Invalid url' }, 400, env, origin)
      }
      try {
        const upstream = await withTimeout(fetch(target, {
          headers: {
            'User-Agent': 'Mozilla/5.0',
            ...(request.headers.get('Range') ? { Range: request.headers.get('Range')! } : {}),
            ...(request.headers.get('Accept') ? { Accept: request.headers.get('Accept')! } : {}),
          },
          signal: request.signal,
        }), 8000, request.signal)
        const headers = new Headers(cors)
        if (!headers['Vary']) delete headers['Vary']
        const ct = upstream.headers.get('Content-Type')
        if (ct) headers.set('Content-Type', ct)
        const cl = upstream.headers.get('Content-Length')
        if (cl) headers.set('Content-Length', cl)
        const cr = upstream.headers.get('Content-Range')
        if (cr) headers.set('Content-Range', cr)
        const ar = upstream.headers.get('Accept-Ranges')
        if (ar) headers.set('Accept-Ranges', ar)
        headers.set('Cache-Control', 'public, max-age=3600')
        headers.set('X-Content-Type-Options', 'nosniff')
        headers.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges')
        return new Response(upstream.body, { status: upstream.status, headers })
      } catch (e) {
        if ((e as any)?.name === 'AbortError') return json({ error: 'Aborted' }, 499, env, origin)
        return json({ error: String(e) }, 502, env, origin)
      }
    }

    // Debug: test provider reachability from Worker
    if (url.pathname === '/api/debug/provider-test') {
      const target = url.searchParams.get('url') || 'https://hianime.to/ajax/search.html?keyword=Cowboy%20Bebop'
      try {
        const res = await fetch(target, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://hianime.to/' }, signal: request.signal })
        const text = await res.text()
        return json({ status: res.status, headers: Object.fromEntries(res.headers.entries()), bodySnippet: text.slice(0, 2000), url: target }, 200, env, origin)
      } catch (e) {
        return json({ error: String(e), url: target }, 502, env, origin)
      }
    }

    // Serve static frontend assets (Vite dist) for all non-API routes
    // Cloudflare Workers with `assets` will have env.ASSETS available
    if (env.ASSETS) {
      try {
        // Let Cloudflare handle the asset; for SPA, fallback to index.html
        const assetRes = await env.ASSETS.fetch(request)
        if (assetRes.status !== 404) return assetRes
        // SPA fallback: for routes without file extension and not /api, serve index.html
        if (!url.pathname.includes('.') && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/health') && !url.pathname.startsWith('/proxy')) {
          const indexReq = new Request(new URL('/', request.url), request)
          const indexRes = await env.ASSETS.fetch(indexReq)
          if (indexRes.status !== 404) return indexRes
        }
        return assetRes
      } catch {}
    }

    return json({ error: 'Not found', path: url.pathname, available: ['/', '/health', '/api/health', '/api/anilist/token', '/api/mal/token', '/api/mal/*', '/api/map/:anilistId', '/api/episodes/:anilistId', '/api/sources/:episodeId?language=sub', '/api/video/*', '/proxy?url='] }, 404, env, origin)
  },
}
