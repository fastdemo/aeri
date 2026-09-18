# agents/ — Aeri Project Knowledge Base

Detailed technical documentation for AI agents and human developers working on Aeri.

> **Source-of-truth rule:** this directory describes the **actual implementation**.
> If documentation conflicts with code, **inspect the code** and update the
> documentation — never blindly trust stale docs, and never change working code
> to match a doc.

## What to read, by task

| Task | Read first |
|---|---|
| Any task (orientation) | `../context.md`, then this README |
| Architecture overview | `architecture.md` |
| UI work (pages, rows, cards, modals) | `frontend.md`, `ui.md`, `pages.md`, `components.md` |
| Visual style, tokens, themes | `design-system.md` |
| Streaming / Watch / providers / HLS | `streaming.md`, then `backend.md` |
| AniList (metadata, seasons, rate limits) | `anilist.md`, `data.md` |
| MAL (auth, tracking, enrichment) | `mal.md` |
| Settings / prefs behavior | `settings.md` |
| Deploying to production | `deployment.md` |
| Tests / verification | `testing.md` |
| Security boundaries | `security.md` |
| How to make changes safely | `conventions.md` |
| What's working / broken right now | `current-state.md` |
| Past architectural changes | `changelog.md` |

## Maintenance rules

1. **Update docs in the same change as the behavior change**, once proven
   correct — never document a guess.
2. Small CSS/copy tweaks: no doc update needed.
3. Architecture, API, data-flow, routing, UI-structure, design-system,
   settings, theme, streaming, auth, caching, performance, security,
   deployment, or testing changes → update the relevant file(s) here.
4. Change that affects overall understanding → also update `../context.md`.
5. Significant architectural change → add a `changelog.md` entry.
6. Behavior fix or regression → update `current-state.md`.
7. Never record secrets (client secrets, tokens, keys). Config **names** and
   where they are expected are fine; values are not.

## Permanent operating rules (also in `AGENTS.md`)

- **GitHub is off-limits** unless the user explicitly asks: no push, no PRs,
  no Actions changes, no `gh-pages` changes.
- **Cloudflare is the deployment target**: develop → test → build → deploy via
  the existing Cloudflare workflow → verify live at
  `https://aeri.fastdemo.workers.dev/`.
- Correctness beats availability (fail closed on matching). No demo streams as
  proof. Verify playback with `currentTime` advancement, not HTTP 200.
