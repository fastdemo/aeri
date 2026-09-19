# Frontend — Aeri

## Entry

- `src/main.tsx`: theme pre-apply → MAL `?code=` triage → `<App/>` in
  `StrictMode`.
- `src/App.tsx`: `HashRouter` + `FaviconGuard` + `Navbar` + `Routes` + footer
  (`aeri by @fastdemo`, GitHub/Docs/Legal). Route-change scroll-to-top
  (pathname-only, so search typing doesn't jump).

## Pages (`src/pages/`)

| Route | Component | Data |
|---|---|---|
| `/` | `Home` | 4 parallel Page queries (trending/popular/airing/new) + derived rows + Because/TopPicks (signed-in) |
| `/browse` | `Browse` | `useBrowse` (5 categories + genre/year/season/format + pagination, perPage 30, local row slicing) |
| `/manga` | `Manga` | `useMangaBrowse` (`type: MANGA`, formats MANGA/NOVEL/ONE_SHOT, no season filter) |
| `/search` | `Search` | URL-driven `useAnimeSearch` (300ms debounce, stale-ignore) |
| `/anime/:id` | `AnimeDetail` | `useAnimeDetail` + `useSeriesGroup`; selector navigates to canonical season |
| `/watch/:id/:episode` | `Watch` | metadata + series group + provider episodes/sources + player |
| `/read/:id/:chapter` | `Read` | `useMangaDetail` (type: MANGA) + WeebCentral chapters/pages + vertical continuous reader |
| `/list` | `MyList` | active tracker's list (empty CTA when signed out) |
| `/settings` | `Settings` | gated: redirects `/` when signed out |
| `/profile` | `ProfilePlaceholder` | placeholder; gated like Settings |
| `*` | `NotFound` | real in-app 404 (replaced history `*`→home redirect) |

Signed-out gates: anime card/hero/search picks open `SignInModal` instead of
the preview; `/watch`, `/anime`, `/list`, `/settings`, `/profile` redirect
home. **Manga is open**: `/manga` cards open `DetailModal` directly and
`/read/:id/:chapter` renders without sign-in (tracking actions still gate).

## Components (`src/components/`)

- `navigation/Navbar`: fixed topbar, fit-based collapse (hidden measurer +
  `navFits`; inline nav+search vs hamburger+icon at ~790px), desktop/mobile
  search with `SearchSuggestions` (frosted, `isolation: isolate`), profile
  dropdown (Profile/Settings), sign-in modal incl. OAuth-return reopen.
- `hero/Hero`: `Hero` + auto-cycling `HeroCarousel` (5.5s, pauses on
  hover/focus/hidden tab), crossfade + ken-burns, arrows/dots.
- `cards/AnimeCard`: single card, variants `default|continue|compact` +
  `mediaKind` (`anime|manga`, auto-detected from format): manga uses portrait
  `aspect-[3/4]` cover art vs anime 16/9 backdrop, book-glyph hover vs play
  triangle, `Ch N` continue captions vs `E<number>`. One component, both kinds —
  shared fixes apply to both. Card hover warms the shared media cache
  (no season walk).
- `rows/ContentRow`: horizontal snap scroll, scroll-aware arrows (one card
  per click), right-aligned subtitle.
- `detail/DetailModal`: single-entry dark modal (exactly the opened entry —
  no group, no selector). Manga: always-present Read/Continue
  (`/read/:id/first` or `ch-N` resume), `Chapters` via `manga/ChapterList`.
  Anime bottom: Related Entries row (ranked, direct links).
- `related/RelatedEntries`: shared row reusing AnimeCard; caption
  `Relation • Format • N Episodes`; title via card hover overlay; plain
  `<a href="#/anime/anilist-<id>">` (NOT react-router Link — the modal
  closes on any hashchange, which would kill it before the new modal opens).
- `manga/ChapterList`: provider chapters (never episodes) with per-row Read
  state, newest-first, `N chapters • V volumes • provider` header. Volumes
  are AniList metadata only — rows are the provider's readable chapters.
- `episodes/EpisodeList`: header `Episodes` + right-side `N episodes`
  (ContentRow convention); transparent wrapper, each row its own
  `bg-[var(--surface)]` card (visible borders in all themes); numbers `01`
  (no `E` prefix, no `S1:`); sub-line duration only. Anime only (manga uses
  `ChapterList`, same pattern: `Chapters` + `N chapters • V volumes`).
- `player/VideoPlayer`: see `streaming.md`.
- `search/SearchSuggestions`: debounced `anilistMetadataProvider.search`,
  frosted panel, keyboard nav, opens `DetailModal` (never navigates).
- `ui/Skeleton`: layout-mirroring skeletons (row/grid/episode variants).

## Hooks (`src/hooks/`)

- `useAnimeMetadata`: `useTrending/usePopular/useAiring/useNewReleases/
  useUpcoming/useFinished`, `useBrowse`/`useMangaBrowse` (pagination +
  `loadMore`), `useAnimeSearch` (no collapsing — distinct ids stay
  distinct), `useAnimeDetail`, `useMangaDetail`
  (type: MANGA query — the ANIME query returns null for manga ids).
  All stale-while-revalidate; THROTTLED keeps cached data silently.
- `useRelatedEntries(anilistId, relations?) → {entries, loading}`: ranks the
  entry's own edges in memory (zero requests); else one cached
  relations-only query (mem 30m/100 + IDB 24h + inflight). Current entry
  excluded, deduped by id, ranked strongest → weakest.

## State management

React Context only, no Redux:

- `AniListContext`: token/user/list/loading/error/authExpired + login/logout/
  refresh + optimistic `updateProgress/Status/Rating` (each refetches list).
- `MALContext`: same shape for MAL (PKCE, `mal-*` ids).
- `TrackingContext`: **single active tracker** (explicit pick or AniList-first);
  `combinedList` (MAL entries AniList-enriched, paced), `isAuthenticated`,
  fan-out-free mutations gated by per-field sync toggles.

## Data fetching

All AniList through `anilistGraphQL` (`src/services/anilist/client.ts`);
all MAL through `malFetch`; all video through provider registry. No direct
`fetch` in UI components (except health-check `Test` button in Settings).

## Loading / error states

Skeletons mirror layout; Watch shows Finding/No-source states distinctly;
THROTTLED never shows countdowns when cached data exists; auth failures show
friendly copy, never raw errors.

## Responsive / browser behavior

Fit-based navbar collapse; grids 2→6 cols; touch rows; 44px mobile targets;
`backdrop-blur` only on small pills/panels (never fullscreen); native HLS
path preserved for Safari; `prefers-reduced-motion` kill-switch.
