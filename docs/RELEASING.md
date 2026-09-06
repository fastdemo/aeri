# RELEASING — Aeri (how to ship without breaking login)

Read this before every production deploy. Two login outages (D049, 2026-09-06)
had the same root cause: **a build that didn't bake the required `VITE_*` env
vars**. The app cannot recover from that at runtime — it must be rebuilt.

## 0. Agent preflight — can this session ship? (30 seconds)

Run these three checks first. If all pass, the session can do the full loop
(code → push incl. workflows → deploy → live-verify) with no owner help:

```bash
git push --dry-run origin main 2>&1 | tail -1
# want: "Everything up-to-date" or a clean dry-run.
# "refusing ... without `workflow` scope" → PAT lacks scope; owner must
# re-issue with `repo` + `workflow` (classic) or add Workflows:write
# (fine-grained), then `echo TOKEN | gh auth login --with-token -h github.com`.

env -u XDG_CONFIG_HOME npx wrangler whoami 2>&1 | tail -2
# want: account/scopes output, NOT "You are not authenticated".
# WHY the env prefix: agent shells run with XDG_CONFIG_HOME pointed at the
# sandbox, but `wrangler login` stores credentials in the DEFAULT location —
# without the prefix wrangler looks in the wrong place and reports logged-out.
# If truly logged out anywhere: owner runs `npx wrangler login` once in a
# normal terminal (persists machine-wide).

set -a; source .env; set +a; npm run verify:build 2>&1 | tail -3
# want: all three "baked OK". Anything else → fix `.env` (step 1) and rebuild.
```

If any check fails and the owner is unavailable: land code + docs on `main`,
verify `tsc`/`build`/browser locally, and say exactly which check failed and
whose hands it needs. Never claim "live" from a push alone.

## Who can deploy

| Path | Requires | Status |
|------|----------|--------|
| Push to `main` (auto) | Nothing extra — CI builds, runs `verify:build`, deploys | **Live since 2026-09-06** (owner added repo secrets; proven by dispatched run 34016758269, all steps green) |
| Local `wrangler deploy` | Cloudflare login on that machine + correct `.env` | Fallback / emergency path |
| `gh workflow run deploy-worker.yml --ref main` | `gh` auth (no Cloudflare login needed — CI uses secrets) | Manual re-deploy without new code |

Agents: pushes now ship by themselves — but still close the loop with
`npm run verify:live` (bundle evidence, never the badge). The preflight below
matters mostly for local emergency deploys.

## 1. Preflight — the `.env` check (non-negotiable)

The production build MUST bake all three (see `.env.example`). CI sets them
via workflow env; **local deploys read your shell `.env`** — that mismatch
caused both outages.

```bash
grep -E '^VITE_(ANILIST_CLIENT_ID|MAL_CLIENT_ID|AUTH_API_URL)=' .env
# expect:
# VITE_ANILIST_CLIENT_ID=50024
# VITE_MAL_CLIENT_ID=ce55a1d587f549b33c1fa36ec10fe8d2
# VITE_AUTH_API_URL=https://graceful-dream-569.fly.dev
```

Missing vars and their symptoms:

| Missing | Symptom on live |
|---------|-----------------|
| `VITE_AUTH_API_URL` | AniList login always fails: app falls back to same-origin Worker → `ANILIST_IP_BLOCKED` (502). App now says "not configured for this hosting". Browsing unaffected. |
| `VITE_MAL_CLIENT_ID` | MAL login says "Client ID not configured". |
| `VITE_ANILIST_CLIENT_ID` | AniList login misconfigured (defaults may mask it — don't rely on defaults). |

## 2. Build

```bash
npm ci && npm run build
```

## 3. Deploy

```bash
npx wrangler deploy --env production   # env.production is pinned to Worker `aeri`; never `aeri-production`
```

(First time on a machine: `npx wrangler login`. Sandboxed shells may need
`env -u XDG_CONFIG_HOME` so wrangler finds the login.)

## 4. Verify live — bundle grep, not the badge

The workflow badge has reported failure while publishing and vice versa. Trust
only the bundle content. Automatic version (also wired into CI after every
build, so a bad bake fails before it can ship):

```bash
npm run verify:live
```

Manual equivalent (what the script does):

```bash
ASSET=$(curl -s https://aeri.fastdemo.workers.dev/ | grep -o 'assets/index-[^"]*\.js' | head -1)
echo "live: $ASSET"
curl -s https://aeri.fastdemo.workers.dev/$ASSET -o /tmp/aeri-live.js
grep -c 'graceful-dream' /tmp/aeri-live.js        # MUST be >= 1 (auth-proxy baked)
grep -o 'CLIENT_SECRET[^"]*' /tmp/aeri-live.js | sort -u
# MUST show only *names* inside error-message strings, never secret *values*
# (values live only in Worker secrets / auth-proxy env / owner's keychain)
curl -s -o /dev/null -w 'root:%{http_code}\n' https://aeri.fastdemo.workers.dev/
curl -s -o /dev/null -w 'health:%{http_code}\n' https://aeri.fastdemo.workers.dev/api/health
```

Optional deeper checks:

```bash
# auth-proxy alive + secret present (expect secretConfigured:true)
curl -s https://graceful-dream-569.fly.dev/health
# Worker MAL proxy reaches MAL (fake code → MAL's own 401, NOT a network error)
curl -s -X POST https://aeri.fastdemo.workers.dev/api/mal/token \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'grant_type=authorization_code&client_id=ce55a1d587f549b33c1fa36ec10fe8d2&code=fake&code_verifier=fake'
```

## 5. Secrets inventory (values never in code, bundles, logs, or chat)

| Secret | Lives in | Set via |
|--------|----------|---------|
| `ANILIST_CLIENT_SECRET` | Worker prod env + auth-proxy host env | `npx wrangler secret put ANILIST_CLIENT_SECRET --env production` / fly secrets |
| `MAL_CLIENT_SECRET` (if MAL app is confidential) | Worker prod env | `npx wrangler secret put MAL_CLIENT_SECRET --env production` |
| `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` | GitHub repo secrets (Actions) | Repo Settings → Secrets → Actions (owner only) |

## 6. Failure catalog

- Live bundle lacks `graceful-dream` → rebuild with `VITE_AUTH_API_URL` (this doc, step 1), redeploy.
- `ANILIST_IP_BLOCKED` on a correctly-built client → the request went to the Worker, meaning the auth-proxy fetch failed browser-side (ad-blocker / Brave Shields blocking the fly host) — client now says so explicitly.
- CI red at `npx ... wrangler --version` / `CLOUDFLARE_API_TOKEN` error → repo secrets missing (owner action, step 5). Code is still validated by the build step.
- Blank page after deploy → `base` mismatch (view source: script src must be `/assets/...` for Worker hosting).

Related: `docs/DEPLOYMENT.md` (hosting detail), `docs/RELEASING.md` (pre-deploy checklist — read before every release), `docs/DECISIONS.md` D041/D049/D051 (why things are shaped this way).
