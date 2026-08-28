# DEPLOYMENT — Aeri (GitHub Pages)

## URL

`https://<username>.github.io/aeri/` (repo name `aeri`, e.g. `fastdemo/aeri` → `https://fastdemo.github.io/aeri/`).

Do not assume root `/`.

## Vite Base

`vite.config.ts`:

```ts
export default defineConfig({
  base: process.env.GITHUB_REPOSITORY ? `/${process.env.GITHUB_REPOSITORY.split('/')[1]}/` : '/aeri/',
  plugins: [react(), tailwindcss()],
})
```

Alternatively hardcode `/aeri/` — both work for `fastdemo/aeri`. Keep env-aware for forks.

GHA sets `GITHUB_REPOSITORY=fastdemo/aeri` automatically, so split yields `/aeri/`.

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
