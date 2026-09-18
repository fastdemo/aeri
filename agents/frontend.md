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
| `/list` | `MyList` | active tracker's list (empty CTA when signed out) |
| `/settings` | `Settings` | gated: redirects `/` when signed out |
| `/profile` | `ProfilePlaceholder` | placeholder; gated like Settings |
| `*` | `NotFound` | real in-app 404 (replaced history `*`→home redirect) |

Signed-out gates: card/hero/search picks open `SignInModal` instead of the
preview; `/watch`, `/anime`, `/list`, `/settings`, `/profile` redirect home.

## Components (`src/components/`)

- `navigation/Navbar`: fixed topbar, fit-based collapse (hidden measurer +
  `navFits`; inline nav+search vs hamburger+icon at ~790px), desktop/mobile
  search with `SearchSuggestions` (frosted, `isolation: isolate`), profile
  dropdown (Profile/Settings), sign-in modal incl. OAuth-return reopen.
- `hero/Hero`: `Hero` + auto-cycling `HeroCarousel` (5.5s, pauses on
  hover/focus/hidden tab), crossfade + ken-burns, arrows/dots.
- `cards/AnimeCard`: single card, variants `default|continue|compact`;
  hover overlay (desktop) / always-visible caption (touch); continue shows
  S:E + progress bar + ⋮ menu; hover prewarms series group.
- `rows/ContentRow`: horizontal snap scroll, scroll-aware arrows (one card
  per click), right-aligned subtitle.
- `detail/DetailModal`: single-panel dark modal, per-season progress truth,
  season selector (in-place swap), episode list, tracking actions.
- `episodes/EpisodeList`: real titles/thumbnails or `Episode N` + EP fallback;
  manga renders Chapters.
- `player/VideoPlayer`: see `streaming.md`.
- `search/SearchSuggestions`: debounced `anilistMetadataProvider.search`,
  frosted panel, keyboard nav, opens `DetailModal` (never navigates).
- `ui/Skeleton`: layout-mirroring skeletons (row/grid/episode variants).

## Hooks (`src/hooks/`)

- `useAnimeMetadata`: `useTrending/usePopular/useAiring/useNewReleases/
  useUpcoming/useFinished`, `useBrowse`/`useMangaBrowse` (pagination +
  `loadMore`), `useAnimeSearch`, `useAnimeDetail`. All stale-while-revalidate;
  THROTTLED keeps cached data silently.
- `useSeriesGroup(anilistId) → {group, ready}`: starts walk at mount from
  route id, shared cache, 8s bounded fallback, UI gates season UI on `ready`.

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
