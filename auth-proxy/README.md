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
