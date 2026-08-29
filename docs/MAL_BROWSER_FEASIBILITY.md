# MAL Browser/SPA Feasibility — Static GitHub Pages (Aeri)

**Date:** 2026-08-29  
**Target origin:** `https://fastdemo.github.io/aeri/` (GH Pages, `vite base: '/aeri/'`, `getMalRedirectUri() => origin + BASE_URL` → `https://fastdemo.github.io/aeri/`)  
**Sources:** Official MAL docs fetched 2026-08-29:
- `https://myanimelist.net/apiconfig/references/authorization` (OAuth 2.0 + PKCE)
- `https://myanimelist.net/apiconfig/references/api/v2` (API reference, ReDoc)
- Empirical browser tests via Playwright `https://fastdemo.github.io` origin (fetch + preflight)

> Do not add backend/proxy. Feasibility only.

## 1. OAuth authorization for public/browser apps

**Docs excerpt (authorization):**
> "MyAnimeList supports PKCE to prevent authorization code interception attacks, **mainly native apps**. In accordance with procedures in Section 4.1 and Section 4.2, generate `code_verifier` and `code_challenge`. **NOTE: Currently, only the plain method is supported.**"

Authorize request (docs):
```
GET https://myanimelist.net/v1/oauth2/authorize?response_type=code&client_id=YOUR_CLIENT_ID&state=YOUR_STATE&redirect_uri=YOUR_REDIRECT_URI&code_challenge=YOUR_PKCE_CODE_CHALLENGE&code_challenge_method=plain
```
- `redirect_uri` OPTIONAL if only one registered, must exactly match if sent.
- Token exchange: `POST https://myanimelist.net/v1/oauth2/token` with `client_id`, `grant_type=authorization_code`, `code`, `code_verifier`, `redirect_uri` (optional but must match if sent), via Basic (`client_id` as username) or body. Docs show `curl` examples, no browser `fetch` example, no CORS mention.

- No docs section for “browser / SPA / public client / GitHub Pages / static SPA” — only “native apps” noted for PKCE.
- Current Aeri implements `code_challenge_method=S256` (SHA256 base64url), while **official docs state only `plain` is supported**. `S256` may work undocumented but is not officially supported.

## 2. PKCE for browser?

- **Officially:** PKCE described as for native apps, `plain` only. No explicit statement that browser SPAs are supported. No mention of `S256`.
- **Empirically:** `S256` challenge is accepted by the authorize endpoint (does not error on method), but docs do not guarantee it.

## 3. CORS-enabled API endpoint for browser?

**Empirical Playwright (origin `https://fastdemo.github.io` and `http://127.0.0.1:4173`):**

```
fetch("https://api.myanimelist.net/v2/anime?q=naruto&limit=1", { headers: { "X-MAL-CLIENT-ID": "ce55…" } })
→ Console: Access to fetch at 'https://api...' from origin 'https://fastdemo.github.io' has been blocked by CORS policy: Response to preflight request doesn't pass access control check: No 'Access-Control-Allow-Origin' header is present on the requested resource.
→ REQUESTFAILED net::ERR_FAILED
→ TypeError: Failed to fetch

fetch("https://api.myanimelist.net/v2/users/@me", { headers: { "Authorization": "Bearer dummy" } })
→ Same: No 'Access-Control-Allow-Origin', ERR_FAILED, Failed to fetch

fetch("https://myanimelist.net/v1/oauth2/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "client_id=ce55…&grant_type=authorization_code&code=dummy&code_verifier=..." })
→ Console: Access to fetch at 'https://myanimelist.net/v1/oauth2/token' from origin 'https://fastdemo.github.io' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present...
→ ERR_FAILED, Failed to fetch
```

`curl -v -H "Origin: https://fastdemo.github.io"` shows responses **never** include `Access-Control-Allow-Origin` (tested: `GET /v2/anime?`, `GET /v2/users/@me`, `POST /v1/oauth2/token`, `OPTIONS` preflight → `405` without CORS headers). `curl` without Origin succeeds server-side (`200` for anime search, `401 invalid_token` for users/@me, `401 invalid_client` for token), proving server works but browser is blocked.

**Docs:** API reference lists `Security Scheme: OAuth2 (Authorization: Bearer)` and `API Key: X-MAL-CLIENT-ID`, all examples are `curl` with `Authorization: Bearer` or `X-MAL-CLIENT-ID`. **Zero mentions of `CORS`, `Access-Control`, `browser`, `SPA`, `fetch`, `GitHub Pages`.** No alternative domain for browser clients found.

## 4. Official alternative API/domain for browser?

None documented. MAL has no `cors.api.myanimelist.net` or `browser.` endpoint. No mention in either reference.

## 5. Does MAL explicitly require server-side?

Not explicitly in a “must be server-side” sentence, but all token and API examples are server-side `curl` and the lack of CORS headers **implicitly requires server-side**. OAuth `client_secret` handling (Scheme 1 Basic with `client_id:client_secret`, Scheme 2 body with `client_secret`) is also server-oriented; public PKCE clients can omit secret (empty password) but still use same token endpoint which is CORS-blocked.

## 6. Supported way to do list/progress/rating sync from static SPA?

- **Read** `GET /v2/users/@me/animelist`, `GET /v2/anime/{id}`, `GET /anime?q=` → all CORS-blocked → **No**.
- **Write** `PUT /v2/anime/{id}/my_list_status` (`status`, `score`, `num_watched_episodes`), `DELETE` → same → **No**.
- **Auth token exchange/refresh** `POST /v1/oauth2/token` → CORS-blocked → **No end-to-end auth** (authorize navigation via `window.location.href` *does* work because it is not `fetch`, but the subsequent code→token fetch fails, so auth cannot complete).

**Jikan** (`https://jikan.moe`, `https://docs.api.jikan.moe`) is an **unofficial** MAL scraper, read-only, no OAuth, no `PUT` for list/status/rating — explicitly disallowed by this task as workaround for mutations.

## Feasibility Report

* **Browser authentication: IMPOSSIBLE end-to-end**  
  Authorize navigation (`GET /v1/oauth2/authorize` via `window.location.href`) is possible (not a fetch, no CORS), but the required `POST /v1/oauth2/token` (and refresh) from browser origin is blocked by missing CORS headers (`No 'Access-Control-Allow-Origin'` → `Failed to fetch`). So a static SPA cannot obtain or refresh tokens without a backend proxy.

* **Browser API reads: IMPOSSIBLE**  
  All `api.myanimelist.net/v2/*` `GET` with `Authorization: Bearer` or `X-MAL-CLIENT-ID` from `https://fastdemo.github.io` are blocked by CORS (preflight `OPTIONS 405` without CORS headers).

* **Browser API writes: IMPOSSIBLE**  
  `PUT /anime/{id}/my_list_status` (and other mutating endpoints) same origin block → no progress/status/rating sync from browser.

* **Static GitHub Pages architecture: NOT SUPPORTED** for MAL  
  Aeri is `static-only` (`AGENTS.md: GitHub Pages, no backend, Vite + HashRouter, localStorage/IndexedDB only`). MAL endpoints do not allow browser fetches from `https://fastdemo.github.io/aeri/`. No official CORS allowance.

* **Official workaround, if one exists: NONE**  
  MAL docs provide no CORS-enabled endpoint, no browser SPA guide, no alternative domain, and state PKCE `plain` mainly for native apps. No documented proxy or static-SPA flow.

* **Whether Aeri needs a backend to support MAL: YES**  
  To use MAL for auth + list/progress/rating sync, Aeri would need a server (or serverless proxy) to perform the token exchange and API calls (avoiding browser CORS) and to optionally keep `client_secret` if used. That would violate the current static-only constraint.

* **Recommended decision:**  
  **Leave existing MAL implementation intact but treat MAL as unavailable on static Pages.** Keep PKCE `redirect_uri=https://fastdemo.github.io/aeri/` fix and the explicit CORS error messages added in `src/services/mal/auth.ts` and `src/services/mal/client.ts` (`MyAnimeList blocked the request (CORS). Aeri runs on GitHub Pages with no backend... Your AniList sync still works.`), keep `VITE_MAL_CLIENT_ID` injection (public, embedded) and `hasClientId` logic, but document the limitation (this file) and do **not** attempt further MAL fetch workarounds, backends, proxies, unofficial APIs, or scraping. Keep AniList as the supported tracking provider (AniList `https://graphql.anilist.co` **does** send CORS and works from Pages). If MAL support is desired in future, create a separate Phase requiring a backend/proxy decision.

**Evidence retained:** Playwright logs (`Origin https://fastdemo.github.io`, `REQUESTFAILED net::ERR_FAILED`, `Response to preflight... No 'Access-Control-Allow-Origin'`), `curl -v` showing no `access-control-allow-origin` for all three MAL endpoints, and official docs excerpts above. No tokens or verifiers logged.

**Do not start Phase 6** (local persistence polish) until this is recorded — as instructed.
