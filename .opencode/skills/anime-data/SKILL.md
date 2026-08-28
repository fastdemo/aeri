# Skill: anime-data — Aeri

Enforce clean anime data boundaries.

## Rules

- UI components never call AniList/MAL directly → use `services/anilist.ts` / `services/mal.ts` via `TrackingProvider` interface.
- Normalized identity: `AnimeIdentity { internalId, anilistId?, malId? }` — never equate IDs.
- Mapping in `src/lib/identity.ts`, not scattered.
- Cache: in-memory 5min + IndexedDB 24h; deduplicate concurrent fetches.
- Mock data `src/data/mockAnime.ts` satisfies same types; Phase 2 must not depend on live API.
- Error → `ProviderError { code }` → UI friendly copy, never raw dump.
- Storage abstraction only — no raw `localStorage.getItem` in components.

## Types

- `src/types/anime.ts` is canonical. Keep `coverImage`/`backdropImage` distinction.
- `services/recommendations` uses genres/tags/history/popularity deterministically, no ML.

## Review

- Grep for `fetch(` inside `components/` or `pages/` → should be zero.
- Check all anime renders guard for missing `year`, `episodes`, `studios`.

## References

- `docs/API.md`
- `AGENTS.md §6-11`
