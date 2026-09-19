# Pages — Aeri

## `/` Home (`src/pages/Home.tsx`)

Purpose: discovery feed. Data: 4 parallel Page queries (24 each) + derived
rows + signed-in personalization. State: selected modal, mount-stable order
(`mountSalt`). Interactions: hero arrows/dots/More Info, card→modal,
rows scroll. Responsive: hero 16/9→21/9, rows snap. Loading: hero pulse +
row skeletons. Errors: hero error card, rows keep working. Nav: logo returns
here. Known: Because row needs signed-in list; signed-out sees no
personalized rows.

## `/browse` Anime (`src/pages/Browse.tsx`)

Purpose: filterable anime grid. Data: `useBrowse` (PAGE_SIZE 30, Load-more +
sentinel). State: category/genre/year/season/format + selected modal.
Shuffle keyed per filter-set (category id included — Airing≠Popular).
Responsive: shared scroll strip + grid 2→6 cols. Loading: `cols×5`
skeletons. Errors: retry card. Known: none open.

## `/manga` Manga (`src/pages/Manga.tsx`)

Purpose: manga discovery + entry to reading. Data: `useMangaBrowse`
(`type: MANGA`). State: same shape as Browse minus season. Labels: Publishing
/ chapters / MANGA-NOVEL-ONE_SHOT. Cards open `DetailModal` directly even
when signed out (manga is open content; anime cards still gate). Cards pass
`mediaKind="manga"` (portrait art).

## `/read/:id/:chapter` Read (`src/pages/Read.tsx`)

Purpose: manga reader (Watch's architectural sibling). Data: `useMangaDetail`
+ WeebCentral chapters + chapter pages. Chapter param: `first` (oldest),
`latest` (newest), `ch-N` (chapter number), or raw provider chapter id.
Vertical continuous scroll (default; `readerMode` pref reserves
single/double). Lazy page `<img>` (first 3 eager), per-image retry, 400px
min-height placeholders (no layout shift). Chapter selector + prev/next +
`[`/`]` keys + end-of-chapter nav. Progress: chapter+page → IDB `readPos`
(`read:<id>` namespace, 5s throttle, IntersectionObserver, no global
per-scroll state) + tracker chapter at last page. Images via signed
same-origin `/api/manga/img` (byte-sniffed content-type — upstream lies).
Open to signed-out users. Known: localhost preview falls back to production
Worker for `/api/manga/*` (no local Worker).

## `/search` Search (`src/pages/Search.tsx`)

Purpose: URL-driven results (`?q=`). Data: `useAnimeSearch` (debounced,
stale-ignore). Interactions: navbar input owns typing; suggestion picks open
modal. Loading: skeletons. Errors: retry. Known: none open.

## `/anime/:id` AnimeDetail (`src/pages/AnimeDetail.tsx`)

Purpose: one AniList entry, exactly as routed. Data: `useAnimeDetail` only
(no group walk, no season selection). Tracking/progress/episodes/provider
hints all use this entry's own id. Below the main content: Related Entries
(`useRelatedEntries` → ranked relation row → direct `/anime/anilist-<id>`
links). Gated: signed-out → home. Loading: hero skeleton → complete model →
reveal. Errors: not-found / friendly. Known: none open.

## `/watch/:id/:episode` Watch (`src/pages/Watch.tsx`)

Purpose: playback of this entry's episode N (URL = local 1..N, no offsets).
Data: metadata + provider episodes/sources for this entry only. State:
sources/selected/tried, resume, watchPos (per-entry id). Interactions:
source/audio selects, prev/next (N±1), episode grid, Retry. Below: Related
Entries, then description. Prefs read per render/resolve
(volume/autoplay/subtitles/audio/provider live; toggles/order/URL on next
resolve). Loading: Finding/No-source/Retry states. Errors: unavailable vs
transient. Known: local preview has no video (trailer embeds only) —
production uses Worker.

## `/list` MyList (`src/pages/MyList.tsx`)

Purpose: active tracker's list, recent-first. Gated (signed-out → home).
Empty CTA when no entries. Tabs by status. Known: none open.

## `/settings` Settings (`src/pages/Settings.tsx`)

Purpose: accounts/playback/sources/appearance/data/about. Gated. See
`settings.md`. Known: volume/autoplay/subtitles apply per render; toggles/
order/URL apply on next resolve; Reduced-motion row is display-only.

## `/profile` ProfilePlaceholder (`src/pages/NotFound.tsx`)

Placeholder, gated. No profile feature yet.

## `*` NotFound

Real in-app 404 with Go home. Replaced the old `*`→home redirect.
