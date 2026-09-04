# DEPLOYMENT — Aeri (Cloudflare Worker `aeri`)

## URL

`https://aeri.fastdemo.workers.dev/` — Worker `aeri` serves `dist` assets + same-origin `/api/*`. Do NOT deploy production to `aeri-production`.

## Vite Base

Production base is `/`. GitHub Pages (`/aeri/`) is legacy: `vite.config.ts` uses Pages base only when `AERI_DEPLOY_TARGET=gh-pages` or `GITHUB_PAGES=true` (never derive Pages base from `GITHUB_REPOSITORY` alone — Actions always sets it, including Worker deploys).

## Workflows

- `.github/workflows/deploy-worker.yml` — `npm run build` (with `VITE_ANILIST_CLIENT_ID=50024`, `VITE_MAL_CLIENT_ID`, `VITE_AUTH_API_URL`, `AERI_BASE=/`) then `wrangler deploy --env production` (`env.production.name` pinned to `aeri` in `wrangler.jsonc`). NOTE: this workflow has reported failure while still publishing — verify live bundle hash + endpoint behavior after every push, do not trust the badge alone.
- `.github/workflows/deploy.yml` — legacy GitHub Pages (history only).
- Local deploy also works: `npx wrangler login` once, then `npx wrangler deploy --env production` (note: sandboxed shells may need `env -u XDG_CONFIG_HOME` so wrangler finds the login in the default config dir).

## Auth backend

- `ANILIST_CLIENT_SECRET` must exist as a Cloudflare Worker secret (Production env) AND/OR on the standalone `auth-proxy/` host. AniList 403-blocks all Cloudflare Worker IPs, so Worker token exchange cannot succeed — production login goes through `auth-proxy` (see `auth-proxy/README.md`, D041). Verify with a fake code: expect `invalid_grant`-family errors, never "secret not configured" or 403-blocked passthrough.

## Routing

HashRouter (`#/`). No server rewrite needed. Refresh and deep links work natively.

If BrowserRouter were used, a `404.html` copy of `index.html` and `spa-github-pages` script would be required — we avoid this.

## Workflow

`.github/workflows/deploy.yml`:

```yaml
name: Deploy
on:
  push:
    branches: [main]
  workflow_dispatch:
jobs:
  build:
    runs-on: ubuntu-latest
    permissions: { contents: read, pages: write, id-token: write }
    environment: { name: github-pages, url: ${{ steps.deployment.outputs.page_url }} }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run build
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with: { path: dist }
      - uses: actions/deploy-pages@v4
        id: deployment
```

Enable in repo: Settings → Pages → Source: GitHub Actions.

## Local verification

```bash
npm run build
npm run preview -- --base /aeri/ --port 4173
# open http://localhost:4173/aeri/#/
```

Test: `#/`, `#/browse`, `#/anime/<id>`, `#/watch/<id>/1`, `#/list`.

## Assets

All assets must be imported via Vite (hashed) or under `public/` with `%BASE_URL%`. Never absolute `/image.jpg`.

## PWA

If `vite-plugin-pwa` enabled, manifest `scope` and `start_url` must include base `/aeri/`. Verify `manifest.webmanifest` after build.

## Troubleshooting

- Blank page → check `base` mismatch (view source: script src should be `/aeri/assets/...`).
- 404 on refresh → confirm HashRouter; if history router, add 404.html fallback.
- Styles missing → ensure Tailwind plugin and `globals.css` imported.
