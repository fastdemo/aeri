# UI — Aeri

Quiet streaming-service chrome; artwork carries personality. Near-black
default theme; all colors via tokens (see `design-system.md`).

## Shell

Fixed topbar (`Navbar`): logo, fit-based inline nav (Home/Anime/Manga/[My
List]) vs hamburger + search icon (hidden measurer, `navFits`, ~790px
crossover, 1.3 margin, hysteresis-free), desktop + mobile search, profile
dropdown (Profile/Settings) or Sign in, `SignInModal` (OAuth-return reopen,
scroll-locked). Footer: sticky-bottom flex layout, `@fastdemo` + GitHub /
Docs / Legal (hover-whiten).

## Home (`/`)

Hero carousel (7, auto 5.5s, pause on hover/focus/hidden, arrows/dots,
crossfade+ken-burns) → Continue Watching (strict `watching`, franchise-merged)
→ mount-stable shuffled sections (Trending first) → Top Picks + Because You
Watched (single mixed row: pool A highest + pool B recent, A,B,A,B…,
first-genre matches, deterministic) → My List bottom. Skeletons mirror rows.

## Anime (`/browse`) / Manga (`/manga`)

One shared strip: categories scroll left, divider, filters dock right, each
lane scrolls internally (zero overlap at 390–1440). Anime: Popular/Trending/
Airing/Upcoming/Finished + genre/year/season/format. Manga: same + Publishing
+ MANGA/NOVEL/ONE_SHOT, no season. Grid 2→6 cols, infinite scroll sentinel,
chapter counts on manga.

## Search

Navbar-owned input + page (`/search?q=`, URL-driven). Frosted suggestion
panel (`isolation: isolate`), keyboard nav, picks open `DetailModal` (never
navigate). Mobile panel keeps exactly one listbox (desktop form hidden on
touch viewports).

## Detail (modal + page)

`DetailModal` (single panel, backdrop blur, per-season progress truth) and
`AnimeDetail` (route = selected season id; selector navigates to canonical
season entry; selection follows route id — idempotent group). Season selector
gated on `group.ready` with same-footprint skeletons; movies show no selector.

## Watch (`/watch/:id/:episode`)

Video-first: backdrop → player → title/meta → source+sub/dub controls →
prev/next → gated episode grid (skeleton until season model settles) →
description → provider chips. Resume pill top-center; no-source vs transient
error states + Retry.

## Settings (signed-in only, else → home)

Account & Connections (both providers, tracker radio, sync toggles) →
Playback (autoplay/subtitles/volume) → Playback Sources (audio, preferred
source, provider enable/reorder/health, custom server + Test) → Appearance
(17-theme grid + reduced-motion readout) → Data & Cache (clears + AniList
diagnostics) → About (live tracker/source/storage + links).

## Cards / rows

`AnimeCard` (default/continue/compact; hover overlay desktop, caption touch;
continue has S:E + glowing 2px bar + ⋮ menu; hover prewarms series group).
`ContentRow` (snap scroll, one-card arrows, right subtitle).

## States

Skeletons mirror layout everywhere; empty states with CTA (My List) or
filters guidance; errors friendly (THROTTLED silent with cache); auth modals
graceful; 404 real page; `/profile` placeholder.
