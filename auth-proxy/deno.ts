// aeri-auth-proxy on Deno Deploy (or any fetch-handler runtime).
//
// Same contract as auth-proxy/server.js (Docker/Node), zero dependencies:
//   GET  /health               → { status, service, secretConfigured }
//   POST /api/anilist/token    → inject ANILIST_CLIENT_SECRET server-side,
//                                proxy https://anilist.co/api/v2/oauth/token
//   POST /anilist/token        → alias
//
// Why a non-Cloudflare host: AniList 403-blocks ALL Cloudflare Worker egress
// IPs ("manually blocked"), so the exchange must run off Cloudflare.
// Deno Deploy free tier needs no credit card and wakes in ~ms, well inside
// the frontend's 8s token-exchange budget.
//
// The secret never leaves this process: it is only ever sent upstream to
// anilist.co, never logged, never returned, never embedded in responses.
//
// Deploy: dash.deno.com → New Project → link the Aeri repo → entrypoint
// `auth-proxy/deno.ts` → env ANILIST_CLIENT_SECRET=<secret> (+ optional
// ANILIST_CLIENT_ID, ALLOWED_ORIGIN). See auth-proxy/README.md.
//
// Local test:
//   ANILIST_CLIENT_SECRET=x ALLOWED_ORIGIN='*' deno serve --allow-env --allow-net --port 8789 auth-proxy/deno.ts

const TOKEN_URL = 'https://anilist.co/api/v2/oauth/token'

interface ProxyConfig {
  secret: string
  clientIdFallback: string
  allowlist: string[]
}

function getConfig(): ProxyConfig {
  // Read per request: safe under every runtime's env timing (Deno Deploy
  // populates Deno.env before fetch; local `deno serve` needs --allow-env).
  return {
    secret: Deno.env.get('ANILIST_CLIENT_SECRET') ?? '',
    clientIdFallback: Deno.env.get('ANILIST_CLIENT_ID') ?? '50024',
    allowlist: (Deno.env.get('ALLOWED_ORIGIN') ?? 'https://aeri.fastdemo.workers.dev')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  }
}

function corsHeaders(origin: string | null, cfg: ProxyConfig): Record<string, string> {
  const allowAll = cfg.allowlist.includes('*')
  let allowOrigin = '*'
  if (!allowAll) {
    if (origin && cfg.allowlist.includes(origin)) allowOrigin = origin
    else allowOrigin = cfg.allowlist[0] || '*'
  }
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Max-Age': '86400',
    ...(allowAll ? {} : { 'Vary': 'Origin' }),
  }
}

function json(data: unknown, status: number, origin: string | null, cfg: ProxyConfig): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...corsHeaders(origin, cfg),
    },
  })
}

async function handle(req: Request): Promise<Response> {
  const cfg = getConfig()
  const origin = req.headers.get('origin')
  let url: URL
  try {
    url = new URL(req.url)
  } catch {
    return json({ error: 'Invalid request' }, 400, origin, cfg)
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin, cfg) })
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    return json({ status: 'healthy', service: 'aeri-auth-proxy', secretConfigured: !!cfg.secret }, 200, origin, cfg)
  }

  if (url.pathname === '/api/anilist/token' || url.pathname === '/anilist/token') {
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, origin, cfg)
    if (!cfg.secret) {
      return json({ error: 'ANILIST_CLIENT_SECRET not configured on auth proxy' }, 500, origin, cfg)
    }
    let bodyText: string
    try {
      bodyText = await req.text()
      if (bodyText.length > 8 * 1024) throw new Error('Body too large')
    } catch (e) {
      return json({ error: String((e as Error)?.message || e) }, 400, origin, cfg)
    }
    try {
      const params = new URLSearchParams(bodyText)
      // Inject secret server-side; never accept it from the browser.
      params.set('client_secret', cfg.secret)
      if (!params.get('grant_type')) params.set('grant_type', 'authorization_code')
      if (!params.get('client_id')) params.set('client_id', cfg.clientIdFallback)
      bodyText = params.toString()
    } catch {
      return json({ error: 'Invalid form body' }, 400, origin, cfg)
    }
    try {
      const upstream = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          'User-Agent': 'AeriAuthProxy/1.0',
        },
        body: bodyText,
        signal: AbortSignal.timeout(8000),
      })
      const text = await upstream.text()
      // Pass through AniList's status/body untouched (it contains no secret),
      // except the known IP-block shape which we translate for the frontend.
      if (upstream.status === 403 && /manually blocked/i.test(text)) {
        return json({ error: 'ANILIST_IP_BLOCKED', message: 'AniList blocked this host IP too.' }, 502, origin, cfg)
      }
      return new Response(text, {
        status: upstream.status,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          ...corsHeaders(origin, cfg),
        },
      })
    } catch (e) {
      return json({ error: String((e as Error)?.message || e) }, 502, origin, cfg)
    }
  }

  return json({ error: 'Not found', available: ['GET /health', 'POST /api/anilist/token'] }, 404, origin, cfg)
}

export default {
  fetch(req: Request): Promise<Response> {
    return handle(req)
  },
}
