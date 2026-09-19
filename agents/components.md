# Components — Aeri

## VideoPlayer (`components/player/VideoPlayer.tsx`)

Props: sources, selectedSource, subtitles, onTimeUpdate/onEnded,
initialTime, animeTitle, episodeNumber, volume, autoplay. Picks
`selectedSource ?? sources[0]`; HLS iff `.m3u8`/type; resets error/loading +
seek on URL change; lazy hls.js w/ native-first + fatal→error; resume seek in
5s margins; volume effect (reactive); AirPlay/Cast/MediaSession/subtitle
effects with cleanup. Embed path = iframe. **No per-tick setState** —
`onTimeUpdate` forwards; parent throttles (verified 0 DOM mutations/10s
playback). Perf: small pills only for blur; spinner overlays transient.

## AnimeCard (`components/cards/AnimeCard.tsx`)

Props: anime, variant `default|continue|compact`, onSelect, fullWidth,
mediaKind `anime|manga` (auto from format). Manga = portrait 3/4 cover +
book glyph; anime = 16/9 backdrop + play triangle. Desktop hover overlay
(name/year/format/genre) + caption; continue adds `E<number>` (anime) /
`Ch N` (manga) + 2px glowing bar + ⋮ menu (Mark watched / Remove). Hover
warms the shared media cache. Widths 168/200/236 (compact 148/180).
No caption block on default rows (clean thumbnails by design).

## DetailModal (`components/detail/DetailModal.tsx`)

Props: anime, onClose. Single dark panel showing EXACTLY the opened entry
(no group, no selector). This entry's progress truth only (related entries
never share). Tracking actions; episode list (anime) / chapter list (manga);
Related Entries row at the bottom (anime only); hashchange/popstate/
`aeri:navigate` auto-close; opens scrolled to top.

## ContentRow (`components/rows/ContentRow.tsx`)

Props: title, subtitle?, children. Snap-x scroll, scroll-aware one-card
arrows, right subtitle, 4px side padding (prevents edge crop), tail spacer.

## Navbar (`components/navigation/Navbar.tsx`)

Fit-based collapse via hidden measurer (`navFits`, outside `<header>`,
`data-navbar-bar` target); SearchSuggestions (desktop+mobile, single
listbox); profile dropdown (Profile/Settings) + SignInModal (OAuth-return
reopen, scroll-lock); route-change transient reset. Gaps fixed `gap-6`
(no breathing during scaling).

## SearchSuggestions (`components/search/SearchSuggestions.tsx`)

Props: query, onClose, onPreview. 250ms debounce, top 6 (no collapsing —
distinct ids stay distinct), frosted `isolation: isolate` panel, keyboard
nav, picks open modal (or sign-in gate when signed out).

## EpisodeList (`components/episodes/EpisodeList.tsx`)

Props: anime (only — no seasonNumber/group). Header `Episodes` + right-side
`N episodes`; transparent wrapper, per-row `bg-[var(--surface)]` cards
(visible borders in every theme); numbers `01` (no E prefix, no S:);
sub-line duration only. `getEpisodes()` helper; provider enrichment with
1.8s cap; movie → null.

## RelatedEntries (`components/related/RelatedEntries.tsx`)

Ranked relation row reusing AnimeCard; caption `Relation • Format •
N Episodes`; plain `<a href="#/anime/anilist-<id>">` links (NOT router Link
— the modal closes on any hashchange). Manga excluded (no relation system).

## Hero (`components/hero/Hero.tsx`)

`Hero` + `HeroCarousel` (5.5s auto, pause on hover/focus/hidden, arrows/
dots/keyboard, crossfade+ken-burns, theme scrims).

## Settings controls (`pages/Settings.tsx`)

All real except Reduced-motion readout; theme grid; provider rows with
health/reorder/enable; custom server + Test; clears + diagnostics. See
`settings.md`.

## Auth (`components/auth/`)

`SignInModal` (dual provider rows, tracker radio, scroll-lock, bare white
brand marks via `ProviderIcon bare`), `ProviderIcon` (inline SVG, theme
text color), `AniListConnect`/`MALConnect` (compact variants for MyList).
