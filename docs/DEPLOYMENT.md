# DEPLOYMENT — Aeri (Cloudflare Worker `aeri`)

> Releasing? Read `RELEASING.md` first — it has the pre-deploy env checklist
> that two login outages taught us. This file is the hosting reference.

> **Incident note (2026-10-17, D095):** production Worker `aeri` was deleted in
> error for ~30 minutes that day ("production" was misread as the live URL
> instead of the worker name `aeri-production`), then FULLY restored:
> version `98daa425-9836-4773-8be1-d464f34b0ea5`, bundle `index-BJgpoBW9.js`,
> `verify:live` 8/8, `/api/diag` rejects a wrong bearer (401 → RESOLVER_SECRET
> enforced). `RESOLVER_SECRET` was restored from local `.dev.vars`;
> `ANILIST_CLIENT_SECRET` intentionally missing worker-side (Deno auth-proxy
> holds the working copy); `MAL_CLIENT_SECRET` still missing — only needed if
> the MAL app is confidential (owner re-add from keychain if MAL login fails).
> `aeri-preview` and `aeri-production` remain deleted (owner's explicit intent).

## URL

`https://aeri.fastdemo.workers.dev/` — Worker `aeri` serves `dist` assets + same-origin `/api/*`. Do NOT deploy production to `aeri-production` (that worker no longer exists — deleted 2026-10-17 together with `aeri-preview`, per the owner).

## Vite Base

Production base is `/` — the only base now. D096 (2026-10-17) removed the GitHub Pages era entirely: the `AERI_DEPLOY_TARGET=gh-pages` / `GITHUB_PAGES` switch was deleted from `vite.config.ts` (the `/aeri/` base it produced is gone; `AERI_BASE` remains as an escape hatch).

## Workflows

- `.github/workflows/deploy-worker.yml` — `npm run build` (with `VITE_ANILIST_CLIENT_ID=50024`, `VITE_MAL_CLIENT_ID`, `VITE_AUTH_API_URL`, `AERI_BASE=/`) then `wrangler deploy --env production` (`env.production.name` pinned to `aeri` in `wrangler.jsonc`). NOTE: this workflow has reported failure while still publishing — verify live bundle hash + endpoint behavior after every push, do not trust the badge alone. This is now the ONLY workflow in the repo (the legacy Pages publisher was removed — D096).
- Local deploy also works: `npx wrangler login` once, then `npx wrangler deploy --env production` (note: sandboxed shells may need `env -u XDG_CONFIG_HOME` so wrangler finds the login in the default config dir).

## Auth backend

- `ANILIST_CLIENT_SECRET` must exist as a Cloudflare Worker secret (Production env) AND/OR on the standalone `auth-proxy/` host. AniList 403-blocks all Cloudflare Worker IPs, so Worker token exchange cannot succeed — production login goes through `auth-proxy` (see `auth-proxy/README.md`, D041). Verify with a fake code: expect `invalid_grant`-family errors, never "secret not configured" or 403-blocked passthrough.
- `MAL_CLIENT_SECRET` must exist as a Cloudflare Worker secret (Production env) if the MAL app is confidential: `npx wrangler secret put MAL_CLIENT_SECRET --env production`. The Worker injects it server-side on `POST /api/mal/token` (and `/mal/token`) for both `authorization_code` and `refresh_token` grants; the browser never holds it. If the MAL app is public (no secret), the Worker proxies as-is. After deploy, grep the live bundle to confirm the secret is absent.
- **Build-time IDs (D049 lesson, repeated 2026-09-06):** every production build MUST bake `VITE_ANILIST_CLIENT_ID=50024`, `VITE_MAL_CLIENT_ID`, and `VITE_AUTH_API_URL=https://aeri.fastdemo.deno.net`. A deploy built without `VITE_AUTH_API_URL` silently degrades AniList login to the same-origin Worker, which AniList IP-blocks — the app now surfaces this as "not configured for this hosting", but the real fix is rebuilding with the var set. After EVERY deploy (CI or local `wrangler deploy`), verify: `curl -s https://aeri.fastdemo.workers.dev/ | grep -o 'assets/[^"]*\.js'` then grep the bundle for `aeri.fastdemo.deno.net` (must be present) and `CLIENT_SECRET` values (must be absent).

## Routing

HashRouter (`#/`). No server rewrite needed. Refresh and deep links work natively.

If BrowserRouter were used, a `404.html` copy of `index.html` and `spa-github-pages` script would be required — we avoid this.

## GitHub Pages — fully removed (D096, 2026-10-17)

Removed at the owner's explicit instruction (`fastdemo.github.io/aeri` must no longer exist; also "clean up all the files that belong to the old gh-pages"). Executed, same day:

1. **Pages site deleted via the GitHub API.** First `gh api -X DELETE /repos/fastdemo/aeri/pages` returned a spurious **422**; retrying **with `-H "X-GitHub-Api-Version: 2022-11-28"`** → **204**. Verified: `GET /repos/fastdemo/aeri/pages` → 404 and the live URL `https://fastdemo.github.io/aeri/` + a `#/anime` deep link → **404**. This API delete (not branch deletion) is what actually kills the URL — D093 had proven the site was served by a GitHub Actions artifact, not the branch.
2. **`gh-pages` branch deleted** — remote (`git push origin --delete gh-pages`) and local (`git branch -D`; the last tip was redirect commit `56133c9`, now only in reflog history).
3. **Files removed from disk:** `OpenCode/gh-pages-redirect/` (index.html, 404.html, .nojekyll, publish-gh-pages-redirect.mjs, README.md) and the legacy Pages publisher `.github/workflows/deploy.yml`. That workflow still declared `branches: [main, gh-pages]` — any push could have re-published a stale artifact, so deleting it removes a real hazard. Its deletion is local-only until the user asks to push `main`; reaching origin/main is intended and safe (only `deploy-worker.yml` remains).
4. **`vite.config.ts` cleaned:** no more `AERI_DEPLOY_TARGET`/`GITHUB_PAGES` base switch; base is `/` (or `AERI_BASE`); `npm run build` re-verified — emits the same `assets/index-BJgpoBW9.js` bundle with `src="/assets/..."`.

Never re-enable Pages in repo Settings or recreate the `gh-pages` branch. Historical provider-file CORS comments that mention `fastdemo.github.io` are dated investigation records, kept intentionally.

## Local verification

```bash
npm run build
npm run preview -- --port 4173
# open http://localhost:4173/#/   (base /, matches production)
```

Test: `#/`, `#/anime`, `#/anime/<id>`, `#/watch/<id>/1`, `#/list`.

Note: `vite preview` has no Worker — video/provider paths need Settings →
Custom video server pointed at `https://aeri.fastdemo.workers.dev`
(localhost is not in the worker's `ALLOWED_ORIGIN`); AniList auth goes
through the baked auth-proxy URL.

## Assets

All assets must be imported via Vite (hashed) or under `public/` with `%BASE_URL%`. Never absolute `/image.jpg`.

## PWA

If `vite-plugin-pwa` enabled, manifest `scope` and `start_url` must match the deploy base (`/` in production). Verify `manifest.webmanifest` after build.

## Troubleshooting

- Blank page → check `base` mismatch (view source: script src should be `/assets/...` on production; `/aeri/assets/...` means a stale GH Pages-era build).
- 404 on refresh → confirm HashRouter; if history router, add 404.html fallback.
- Styles missing → ensure Tailwind plugin and `globals.css` imported.
