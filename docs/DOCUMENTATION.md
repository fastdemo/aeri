# DOCUMENTATION maintenance rule (docs stay with code)

Docs that describe behavior must be updated **in the same change** as the behavior, once verified. "Same change" = the code edit and the doc edit land together (same commit / same working tree), never "eventually".

## Map: change type → docs to update

| Change touches | Update in the same change |
|---|---|
| Architecture, routing, storage, data flow | `docs/ARCHITECTURE.md`, `agents/architecture.md`, `docs/DECISIONS.md` (new number if a trade-off was made) |
| Deployment, hosting, Worker config, secrets, roles | `docs/DEPLOYMENT.md`, `docs/RELEASING.md` (if preflight/verify steps change), `agents/deployment.md`, `docs/DECISIONS.md` |
| Auth (AniList / MAL / OAuth) | `docs/API.md`, `docs/ARCHITECTURE.md`, `agents/mal.md` / `agents/anilist.md`, `docs/DECISIONS.md` |
| Streaming / providers / matching / resolver | `agents/streaming.md`, `src/providers/video/registry.ts` comments, `docs/DECISIONS.md`, dated provider-verification paragraph in `agents/changelog.md` |
| Manga (routes, catalogs, providers, reader) | `agents/changelog.md` + `agents/current-state.md` (no dedicated manga doc — create one when the area grows) |
| Watch/playback UI, player, no-source copy | `agents/ui.md` or `agents/pages.md` (whichever names the component) + the test pinning the copy |
| Settings UI / preferences | `agents/settings.md`, `src/storage/preferences.ts` comments |
| Tests, harness, verification scripts | `agents/testing.md` |
| Any user-visible product behavior | `agents/changelog.md` (dated entry) + `agents/current-state.md` |

## Rules of evidence

1. Document only what was verified: read the source first, then prove with the cheapest evidence (curl probe, `node` one-liner, targeted Playwright assertion, test suite). Anything unverified is labeled as expectation, not behavior.
2. Historical reports stay historical: keep their dates; band them with a dated banner when they would otherwise read as current state. Never silently upgrade an old claim to "current".
3. If something cannot be verified (credentials, owner-only surfaces), say so in the doc: record what is missing and whose hands it needs.
4. The codebase is the source of truth; when a doc and the code disagree, fix the docs in the same session that discovers the drift.
5. Add a `docs/DECISIONS.md` entry (`D0xx`) for any non-obvious choice — include live evidence and the limitation, if any. Check existing references for the next free number (agents docs sometimes reference numbers beyond the ledger's last entry).

## Drift bug-out: finding stale documentation

Search for the stale term (retired hostnames, removed providers, changed copy) across `docs/ agents/ README.md worker/ src/`, then: update the current-claim docs, and band genuinely historical evidence docs with a dated banner instead of rewriting their content.

Excluded from this rule: files whose purpose is history itself (`docs/DECISIONS.md` old entries, dated probe logs, `.playwright-mcp/` snapshots, era-labeled research docs).
