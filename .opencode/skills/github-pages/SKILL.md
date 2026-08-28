# Skill: github-pages — Aeri

Enforce static-only, base-path correctness.

## Rules

- Never introduce server: no Express, Next API, DB, secrets, sessions.
- `vite.config.ts` must set `base: '/aeri/'` (or env-derived). Verify script src after build is `/aeri/assets/...`.
- Use `HashRouter` — test `#/anime/<id>` refresh does not 404. If BrowserRouter, must provide `404.html` fallback.
- Deploy workflow at `.github/workflows/deploy.yml` — must `npm ci && npm run build` → upload `dist` → deploy-pages.
- All assets via Vite imports or `public/` with `%BASE_URL%`, never absolute `/`.
- PWA manifest scope/start_url must include `/aeri/` if enabled.
- Document changes in `docs/DEPLOYMENT.md`.

## Verification

```bash
npm run build
# check dist/index.html asset paths
grep -o 'src="[^"]*"' dist/index.html
# preview with base
npm run preview -- --port 4173
# curl/hash routing check
```

## References

- `docs/DEPLOYMENT.md`
- `AGENTS.md §5`
