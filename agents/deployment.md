# Deployment — Aeri (Cloudflare is the target)

## Production

- **URL**: `https://aeri.fastdemo.workers.dev/` (Worker `aeri` serves `dist/`
  + `/api/*`, same origin).
- **NEVER deploy production to `aeri-production`.**
- **GitHub is not a deployment target** and must not be modified unless the
  user explicitly asks (no push/PR/Actions/`gh-pages` changes).

## Build

```bash
npm run build   # prebuild: scripts/verify-env.mjs (refuses without VITE_* IDs)
```

- `tsc -b && vite build`; base `/` (Pages `/aeri/` only when
  `AERI_DEPLOY_TARGET=gh-pages` — never derive from `GITHUB_REPOSITORY`).
- Baked env (CI secrets or shell `.env`): `VITE_ANILIST_CLIENT_ID=50024`,
  `VITE_MAL_CLIENT_ID`, `VITE_AUTH_API_URL=https://aeri.fastdemo.deno.net`.
  A build missing `VITE_AUTH_API_URL` silently degrades login to the blocked
  Worker — always verify the bake.

## Deploy (existing workflow)

```bash
env -u XDG_CONFIG_HOME npx wrangler deploy --env production
```

(`env -u` because sandboxed shells mispoint wrangler's config dir; login is
machine-wide via `npx wrangler login`.) **Race rule: last-writer-wins** —
never manual-deploy within 5 min of a CI push/dispatch.

Config: `worker/wrangler.toml` (`name = "aeri-video"` — historical name, the
production binding is the `aeri` worker). Secrets (owner/keychain only):
`ANILIST_CLIENT_SECRET`, `MAL_CLIENT_SECRET`, `RESOLVER_SECRET`.

## Verify live (mandatory — never trust badges)

```bash
npm run verify:live   # root serves bundle + IDs baked + 4 title-match probes
```

Manual: `curl` root → `assets/index-*.js` hash → grep bundle for
`aeri.fastdemo.deno.net` (present) and secret values (absent) → probe
`/api/sources/aniwave-<id>-1` matching → Playwright playback
(`currentTime` advances) on the live URL.

## Preview / local

- `wrangler` preview env (`ALLOWED_ORIGIN *`) exists but is not the release
  path. Local `vite preview` has no Worker — point `customVideoApiUrl` at
  production for provider paths (localhost→worker CORS is by design).
