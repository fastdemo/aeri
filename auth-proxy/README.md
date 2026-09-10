# aeri-auth-proxy — AniList OAuth token exchange outside Cloudflare

AniList 403-blocks **all** requests from Cloudflare Worker IPs (`"manually
blocked"`), so the Worker's `/api/anilist/token` proxy can never complete the
Authorization Code exchange. This tiny zero-dependency Node server does exactly
one thing — `POST /api/anilist/token` → `https://anilist.co/api/v2/oauth/token`
with `ANILIST_CLIENT_SECRET` injected server-side — and runs on any
**non-Cloudflare** host (Fly.io, Render, Railway, a VPS…).

The secret never leaves this process: it is only sent upstream to `anilist.co`,
never logged, never returned, never embedded in any response.

## Run locally

```bash
cd auth-proxy
ANILIST_CLIENT_SECRET=xxx ALLOWED_ORIGIN='*' node server.js
# GET http://localhost:8788/health
```

## Deploy (Fly.io example)

```bash
cd auth-proxy
fly launch --no-deploy   # accept defaults; set internal port 8788
fly secrets set ANILIST_CLIENT_SECRET=xxx
fly deploy
fly open  # note the https://<app>.fly.dev URL
```

Set `ALLOWED_ORIGIN=https://aeri.fastdemo.workers.dev` (default) or your own
domain. Any Docker host works the same way (`Dockerfile` included): provide
`PORT`, `ANILIST_CLIENT_SECRET`, optionally `ANILIST_CLIENT_ID`
(default `50024`) and `ALLOWED_ORIGIN`.

## Wire Aeri to it

Aeri → Settings → Account → **AniList auth endpoint (optional)**: paste the
public base URL (e.g. `https://<app>.fly.dev`) and press Test. New logins then
exchange codes through it instead of the blocked Worker. Stored in
`localStorage` (`aeri:prefs.customAuthApiUrl`); the secret is never in the
browser. You can also bake it in at build time with `VITE_AUTH_API_URL`.

## Verify without real credentials

```bash
curl -X POST https://<app>.fly.dev/api/anilist/token \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'grant_type=authorization_code&client_id=50024&code=INVALID&redirect_uri=https://aeri.fastdemo.workers.dev/'
# Expect: {"error":"invalid_grant",...} or 401 invalid_client —
# anything EXCEPT 403 "manually blocked" proves this host is not blocked.
```

## Deploy (Deno Deploy — current path, no credit card)

`deno.ts` implements the same contract as `server.js` (zero dependencies,
fetch-handler form). Deno Deploy free tier needs no card, runs non-Cloudflare
egress (required — AniList 403-blocks all Cloudflare IPs), and wakes in
milliseconds (inside the frontend's 8s token-exchange budget).

Owner steps (dashboard only, no CLI, ~5 minutes):

1. Sign up at dash.deno.com (GitHub OAuth is fine).
2. New Project → link the Aeri repo → entrypoint `auth-proxy/deno.ts`.
3. Environment variables: `ANILIST_CLIENT_SECRET` (from your keychain),
   optionally `ANILIST_CLIENT_ID` (default `50024`) and `ALLOWED_ORIGIN`
   (default `https://aeri.fastdemo.workers.dev`).
4. Deploy → copy the project URL (`https://<name>.deno.net`) back to the
   agent, who bakes it as `VITE_AUTH_API_URL` and verifies login.

Verify without real credentials (same contract as the Docker version):

```bash
curl https://<name>.deno.net/health
# {"status":"healthy","service":"aeri-auth-proxy","secretConfigured":true}
curl -X POST https://<name>.deno.net/api/anilist/token \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'grant_type=authorization_code&client_id=50024&code=INVALID&redirect_uri=https://aeri.fastdemo.workers.dev/'
# Expect: {"error":"invalid_grant",...} or 401 invalid_client —
# anything EXCEPT 403 "manually blocked" proves this host is not blocked.
```

Local test (needs Deno CLI):

```bash
ANILIST_CLIENT_SECRET=x ALLOWED_ORIGIN='*' deno serve --allow-env --allow-net --port 8789 auth-proxy/deno.ts
```

## Deploy (Docker/Fly — retired)

The Docker/Fly path below is kept as a fallback for any Docker host. Fly
itself is retired (trial ended, D064); prefer Deno Deploy above.
