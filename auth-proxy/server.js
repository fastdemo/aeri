// Minimal AniList OAuth token-exchange proxy for Aeri.
//
// Why this exists: AniList 403-blocks ALL requests from Cloudflare Worker IPs
// ("manually blocked"), so the Cloudflare Worker's /api/anilist/token proxy can
// never complete the Authorization Code exchange. This tiny server does exactly
// one thing — POST /api/anilist/token -> https://anilist.co/api/v2/oauth/token
// with ANILIST_CLIENT_SECRET injected server-side — and is meant to run on any
// NON-Cloudflare host (Fly.io, Render, Railway, a VPS, ...).
//
// The secret never leaves this process: it is only ever sent upstream to
// anilist.co, never logged, never returned, never embedded in responses.
//
// Env:
//   PORT                  (default 8788)
//   ANILIST_CLIENT_SECRET (required)
//   ANILIST_CLIENT_ID     (default 50024, used only if the request omits client_id)
//   ALLOWED_ORIGIN        (default https://aeri.fastdemo.workers.dev; comma-separated or "*" for dev)

const PORT = Number(process.env.PORT || 8788)
const CLIENT_SECRET = process.env.ANILIST_CLIENT_SECRET || ''
const CLIENT_ID_FALLBACK = process.env.ANILIST_CLIENT_ID || '50024'
const ALLOWLIST = (process.env.ALLOWED_ORIGIN || 'https://aeri.fastdemo.workers.dev')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean)

const TOKEN_URL = 'https://anilist.co/api/v2/oauth/token'

function corsHeaders(origin) {
  const allowAll = ALLOWLIST.includes('*')
  let allowOrigin = '*'
  if (!allowAll) {
    if (origin && ALLOWLIST.includes(origin)) allowOrigin = origin
    else allowOrigin = ALLOWLIST[0] || '*'
  }
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Accept',
    'Access-Control-Max-Age': '86400',
    ...(allowAll ? {} : { Vary: 'Origin' }),
  }
}

function sendJson(res, status, data, origin) {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...corsHeaders(origin),
  })
  res.end(body)
}

function readBody(req, limit = 8 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', c => {
      size += c.length
      if (size > limit) {
        reject(new Error('Body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

const server = (await import('node:http')).createServer(async (req, res) => {
  const origin = req.headers.origin || null
  let url
  try {
    url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
  } catch {
    return sendJson(res, 400, { error: 'Invalid request' }, origin)
  }

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(origin))
    res.end()
    return
  }

  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, { status: 'healthy', service: 'aeri-auth-proxy', secretConfigured: !!CLIENT_SECRET }, origin)
  }

  if (url.pathname === '/api/anilist/token' || url.pathname === '/anilist/token') {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' }, origin)
    if (!CLIENT_SECRET) {
      return sendJson(res, 500, { error: 'ANILIST_CLIENT_SECRET not configured on auth proxy' }, origin)
    }
    let bodyText
    try {
      bodyText = await readBody(req)
    } catch (e) {
      return sendJson(res, 400, { error: String(e?.message || e) }, origin)
    }
    try {
      const params = new URLSearchParams(bodyText)
      // Inject secret server-side; never accept it from the browser.
      params.set('client_secret', CLIENT_SECRET)
      if (!params.get('grant_type')) params.set('grant_type', 'authorization_code')
      if (!params.get('client_id')) params.set('client_id', CLIENT_ID_FALLBACK)
      bodyText = params.toString()
    } catch {
      return sendJson(res, 400, { error: 'Invalid form body' }, origin)
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
        return sendJson(res, 502, { error: 'ANILIST_IP_BLOCKED', message: 'AniList blocked this host IP too.' }, origin)
      }
      res.writeHead(upstream.status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        ...corsHeaders(origin),
      })
      res.end(text)
    } catch (e) {
      return sendJson(res, 502, { error: String(e?.message || e) }, origin)
    }
    return
  }

  return sendJson(res, 404, { error: 'Not found', available: ['GET /health', 'POST /api/anilist/token'] }, origin)
})

server.listen(PORT, () => {
  console.log(`aeri-auth-proxy listening on :${PORT} (secret configured: ${!!CLIENT_SECRET})`)
})
