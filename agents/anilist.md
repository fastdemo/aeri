# AniList — Aeri

Metadata backbone. All calls browser-side (`https://graphql.anilist.co`,
CORS-open). Worker-side GraphQL is expected to 403 ("manually blocked") —
browser holds all metadata; worker takes caller-supplied hints.

## Client (`src/services/anilist/client.ts`)

`anilistGraphQL(query, vars, {token, useCache=true, cacheKey, force, signal})`:

1. memory hit (5min TTL, max 400, oldest-evict) → return
2. shared inflight (keyed query+vars+token; per-caller abort races only
   their own view, never kills the shared fetch) → join
3. IDB check inside shared promise (promotes to memory)
4. network (own 8s controller) → memory + IDB write (if cacheKey)

- **429**: single shared `rateLimitedUntil`; `Retry-After` wins, else
  `X-RateLimit-Reset` (epoch or delta), else 60s (clamped 1s–120s). **No
  retry.** While cooling: serve stale (expired memory/IDB) or throw
  `ProviderError('THROTTLED')`.
- Errors: 401/403 → `AUTH` (clears token); 404 → `NOT_FOUND`; 500 →
  `NETWORK` retryable; timeout/offline → stale-or-`NETWORK`.
- Diagnostics: `getAnilistStats()` (requests, memoryHits, idbHits,
  dedupHits, status429, cooldownSkips, staleServed, lastRemaining) —
  surfaced in Settings → Data & Cache. No tokens/user data.

## Queries (`src/providers/metadata/anilistMetadata.ts`)

Shared `MEDIA_FIELDS` (+`trailer{id site}` on single queries). Page rails
(`TRENDING/POPULARITY_DESC`, airing, new, upcoming, finished), `browse()`
(sort/status/genre/year/season/format/page, `anilist:browse:…` keys),
`browseManga()` (`type: MANGA`), `getAnime`/`getAnimeByMalId` (shared
`anilist:media:<id>` record — detail costs ~1 request cold, 0 warm),
`getManga` (type: MANGA), `search()` (no collapsing — distinct ids stay
distinct; + parallel genre-browse when the query names a genre, ranked by
`lib/searchRank`). Detail `MEDIA_FIELDS` include `relations { edges {
relationType, node { ...lightweight } } }` — Related Entries rank in memory
with zero extra requests in the common case.

## Auth (`src/services/anilist/auth.ts`, `storage/anilist.ts`)

Authorization Code + 32ch `state`; secret never in browser (Worker/Deno
inject it). Exchange fallback chain: custom `customAuthApiUrl` →
`VITE_AUTH_API_URL` (`https://aeri.fastdemo.deno.net`, Deno Deploy — required
because AniList blocks all CF egress) → same-origin. Structured
`ANILIST_IP_BLOCKED` handling with actionable copy (ad-blocker vs missing
build var vs outage). Tokens in `aeri:anilist:*`; `last_code` dedupes
double-exchange; **any exchange failure cleans URL + state** (stuck `?code=`
black-page incident).

## Rate-limit posture (30/min + burst limiter, live)

- Enrichment (`services/mal/enrichment.ts`): priority ≤12 at concurrency 2,
  tail drip 2.5s (~24/min).
- Hooks (`useAnimeMetadata`): stale-while-revalidate; THROTTLED keeps cached
  pages silently, generic error only with no data.
- Measured: home 4 → browse 7 → home 7 (cached); 5-anime burst 21 reqs, max
  3 parallel, 0× 429.

## Relations → Related Entries (season system REMOVED 2026-09-19)

`services/anilist/series.ts` is a stub; `hooks/useSeriesGroup.ts` deleted.
No spine walk, no group model, no selector, no dedup-by-stem, no franchise
merging anywhere (discovery, Continue Watching, search, cards).

`useRelatedEntries(anilistId, relations?)` (`src/hooks/useRelatedEntries.ts`)
+ `RelatedEntries` row (`src/components/related/RelatedEntries.tsx`):
detail `relations` edges ranked in memory (zero requests); else one cached
relations-only query. Deterministic strongest → weakest: SEQUEL 0, PREQUEL 1,
PARENT 2, CHARACTER 3, SUMMARY 4, ALTERNATIVE 5, SPIN_OFF 6, SIDE_STORY 7,
ADAPTATION 8, OVA/ONA 9, SPECIAL 10, MOVIE 11, OTHER 12, unknown 99 —
×10 + TV(0)/ONA/OVA(1)/SPECIAL(2)/MOVIE(3) format boost, ties by media id.
Current entry excluded, deduped by id. Mem 30m/100 + IDB 24h + per-id
inflight (`anilist:related:<id>`).

## Mapping (`services/anilist/mapper.ts`)

`averageScore`/10 (integer → 1 real decimal), studios filtered to
`isAnimationStudio` (prefer `isMain`), `isAdult` boolean (never fake ratings),
`streamingEpisodes` preserved in order (no title filtering — index stability),
trailer, airing schedule, `idMal`. Per-tracker `ratings{anilist,mal}`;
`displayRating` picks by active tracker, `formatRating` → 2 decimals.

## Known limitations

Worker cannot read AniList (all worker paths degrade or take hints);
`anilist:search` keys differ between metadata provider and tracking provider
(minor); enrichment tail converges slowly on huge MAL lists by design.
