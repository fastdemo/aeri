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

Props: anime, variant `default|continue|compact`, onSelect, fullWidth.
Desktop hover overlay (name/year/format/genre) + play chip; touch caption;
continue adds S:E + 2px glowing bar + ⋮ menu (Mark watched / Remove).
Hover prewarms `getSeriesGroup`. Widths 168/200/236 (compact 148/180).
No caption block on default rows (clean thumbnails by design).

## DetailModal (`components/detail/DetailModal.tsx`)

Props: anime, onClose. Single dark panel; per-season progress truth
(displayed season's entry only); season selector swaps in place; tracking
actions; episode list; hashchange/popstate/`aeri:navigate` auto-close.

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

Props: query, onClose, onPreview. 250ms debounce, `deduplicateBySeries`,
top 6, frosted `isolation: isolate` panel, keyboard nav, picks open modal
(or sign-in gate when signed out).

## EpisodeList (`components/episodes/EpisodeList.tsx`)

Props: anime, seasonNumber?, group?. Real titles/thumbs or fallbacks;
`getEpisodes()` helper; provider enrichment with 1.8s cap; movie → null;
manga → Chapters labels; themed rows (no hardcoded fills).

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
