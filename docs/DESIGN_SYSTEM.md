# DESIGN_SYSTEM — Aeri

## Philosophy

Quiet UI, loud artwork. Aeri borrows Netflix's cinematic browsing contract: hero → rows → detail expansion → watch. No dashboard, no database table, no neon.

## Tokens

### Colors

```css
:root {
  --bg: #070708;
  --bg-soft: #0f0f10;
  --surface: #141416;
  --surface-hover: #1c1c1e;
  --surface-elevated: #1e1e21;
  --border: rgba(255,255,255,0.07);
  --border-strong: rgba(255,255,255,0.12);
  /* 50% of --border-strong — the shared hero/card frame hairline (D127) */
  --border-card: color-mix(in srgb, var(--border-strong) 50%, transparent);
  --text: #f2f2f3;
  --text-muted: #9a9aa0;
  --text-faint: #6b6b70;
  --accent: #e50914;
  --accent-hover: #f40612;
  /* opaque list separator: the old 8% alpha line over --surface (D134) */
  --divider: color-mix(in srgb, var(--text) 8%, var(--surface));
}
```
Page background: near-black (#070708). Surfaces are subtly lighter, not cards with heavy borders.

**Browser chrome follows the theme (D149).** Safari 26 tints the window and
toolbar from the `<body>` background color and ignores `<meta
name="theme-color">` (WebKit bug 301756). `applyTheme()` paints the theme's
`--bg` inline on `<body>`/`<html>` on every switch — Mocha tints the Safari
window purple (`#1e1e2e`), Aeri Light tints it light (`#fafafa`) — rewrites
the `theme-color` meta for engines that still honor it (iOS < 26, Chrome
Android), and sets `color-scheme` from the background's brightness so native
scrollbars/select popups match.

### Frame language (D127/D128, radius D133)

The hero and the media player share one corner radius: **28px**
(`rounded-[28px]`; the player's stock Video.js radius, D131). The hero's
`.frame-glass` overlay inherits it, so the rim follows the same curve.

The hero and every artwork card share one edge: a 1px `--border-card`
hairline (half-strength, computed `rgba(255,255,255,0.08)` on the default
theme — alpha-0.5 white reads as an outline). `.frame-glass` draws the hero
rim as an overlay with a 3px masked `backdrop-filter: blur(8px)`; `.frame-soft`
draws the card line plus a short inward glow and deliberately no per-tile
backdrop filter (30–100 captures re-introduced browser tiling over artwork).
`.frame-crisp` is the hairline alone — the Continue Watching card uses it
because its inward glow read as a blurred edge on a mostly still frame;
every other card, hero slot, and Watch tile stays `.frame-soft`. None is a
CSS `border`: cards avoid layout inflation, and the composited carousel
layer tiled stale snapshots with a real border.

Card hover frost (D137) is the one exception that blurs card pixels: it is
mounted as `.card-frost` on the hover scrim, which is `backdrop-filter: none`
at rest and only gets `blur(8px)` while `.card-art:hover` on a
`@media (hover: hover)` device. Offscreen and touch tiles therefore carry no
blur layer at all (108 → 0 card layers on Home). While any scroller is
moving (D143), `html[data-scrolling="1"]` (set by `lib/scrollQuiet.ts`)
removes the frost, hides the hover glyph/caption and pins the artwork's
hover brighten at 0.96 — a card sliding under a parked cursor must never
toggle a backdrop blur mid-scroll. The flag clears 140ms after the last
scroll event and the normal hover treatment returns.

### Dividers (D134)

Episode and chapter list separators (and their list frames) use
`--divider: color-mix(in srgb, var(--text) 8%, var(--surface))` — **opaque**,
pre-composited over `--surface`. An 8%-alpha line composites with whatever
row background is under it, so re-sorting the list moved the hovered row and
the line under the first row appeared to change colour. Opaque means one
colour in every row, in both sort directions. Section rules
(`border-t`/`border-b` on page furniture) keep the alpha `--border`.

**Reader progress bar (D143, glow removed D148).** On `/read/*` the navbar
hairline becomes a 2px scroll track (15% `--text`) with a **flat** `--text`
fill — no neon glow (the 6px `shadow-[0_0_6px_var(--text)]` is gone; D139 had
removed it, D143 reintroduced it, the owner removed it for good on
2026-10-29). The fill is still hidden at ratio 0 (`opacity` driven by the
same rAF paint as the transform) so a zero-length bar leaves no sliver. The
bar also stays at zero until every page image has resolved
(`aeri:reader-pages`).

### Nav hitboxes

Icon-only controls in the top bar are one group: menu, search, and bell are
each a **32×32** box at `--text-muted` rest color (the bell's own size), with
`gap-1.5` (6px) between cluster items and 12px from the wordmark to the
menu trigger. The menu glyph is Lucide `menu` (three rules). Text controls
(Sign in) keep their own padding.

**Compaction step (D129).** The bar has exactly ONE breakpoint: **640px**
(Tailwind `sm`), the same step at which the hero dot pill leaves the hero's
top-right corner for the bottom-center. Below 640 the bar is compact — menu
trigger + search icon; from 640 up it is inline — Home / Anime / Manga /
My List + the search field. Never two different mobile breakpoints on one
screen. A true-width fit check (hidden measurer built from the same
`SectionLinks` component as the live row, compared against the bar's content
box) acts only as an overflow safety valve.

**No divider.** There is no rule between the bell and the profile (owner
2026-10-25); the right cluster's `gap-1.5 lg:gap-3` separates them. Bell and
profile stay visible at every scaling.

**Inline sizes by band.** Search field 150px at 640–1023 / 200px at `lg`,
growing to 240px on focus only at `lg` (a +60px jump at 640 would overflow
the signed-out bar). Nav link gap and logo→nav gap are 20px below `lg`,
24px at `lg`. Measured: the widest inline case (640px, signed out) needs
558px of the 581px content box.


### Typography

- Family: `Inter`, `Geist Sans`, system fallback. Weights 400/500/600 only.
- Sizes: hero title 28–34px (600), hero meta 12–13px (400), hero desc 14px (400, muted), row title 14px (600), card title 12–13px (500), episode title 13px.
- Line heights: body 1.6, titles 1.1.
- Never bold everything. Hierarchy via size + color, not weight alone.

### Spacing & Radius

- Base unit 4px. Page gutters: 24px mobile, 48px desktop (max-width 1600px).
- Row gap 8px. Section gap 32px.
- Radius: card 6px, modal 12px. Buttons and dropdowns are pills (fully
  rounded) — one geometry, see Pills & dropdowns.

### Pills & dropdowns (D130, 2026-10-26)

One pill geometry for the whole app, imported from
`src/components/ui/buttonStyles.ts`. The reference is the active white
"Popular" category pill on `/anime` / `/manga`:

| property | value |
|---|---|
| height | **30px** (6px padding + 16px line-height + 1px border) |
| horizontal padding | 14px (`px-3.5`) |
| text | 12px / 500 / 16px line-height (`text-xs font-medium leading-4`) |
| shape | fully rounded, 1px hairline |
| solid | `bg: var(--text)`, label `var(--on-text)`, border `--border-strong` |
| soft | 10% text tint, muted label, transparent border |

- `pillSolid` = primary action (Sign in, Play, Connect, Resume, Retry,
  Back/Next, Home) and the active category/status tab. `pillSoft` = secondary
  action and the inactive category/status tab.
- **Never size a pill with `h-7` / `h-8` / `py-1` / `py-2` / `py-3` or a
  13–14px font.** Padding + `leading-4` is the only sizing, so every pill
  computes to 30px. Icon + label pills keep the same metrics (`gap-1.5`,
  14px icon).
- **Segmented toggles stay toggles** (owner correction, 2026-10-26): Sub/Dub
  on Watch and the preferred-audio / reader-fit controls on Settings keep
  their original TRACK + INNER PILL. The size rule applies to the control as
  a whole — 1px border + 4px track padding + a 20px inner pill (16px
  `leading-4` + 2px padding) = **30px** — not to the thumb. Never convert a
  segmented toggle into a row of standalone pills; "same size" is not
  permission to change the component.
- **On/off is the Aeri switch** (`components/ui/Switch.tsx`), never a native
  checkbox (D145). 32×18 hairline track + 12px knob. **Its color scheme is
  the Sub/Dub segmented toggle's** (D147): ON is the active pill — solid
  `--text` track with the `--on-text` knob — and OFF is the inactive pill — a
  bare `--border-strong` track with a 45% text knob. No `--accent` anywhere,
  so Aeri Light inverts exactly like its Sub/Dub control. Knob slide and
  track color run 200ms on the entrance curve; the track contracts slightly
  while pressed; all of it is disabled under `prefers-reduced-motion`.
  `SwitchRow` is the label + description variant; the whole row is the
  `role="switch"` button so the text stays clickable.
- **Provider rows animate their disabled state** (D147): turning a provider
  off fades its grip/dot/text to 50% and the row's background to the dim
  token over 300ms. The switch itself stays at full opacity so it can be
  turned back on without hunting for it.
- **Sortable lists use the grip** (`components/ui/SortableList.tsx`, D145):
  a six-dot `GripVertical` button at the left, 35% text tint, `cursor-grab`.
  Dragging lifts the row (`rounded-md`, `--surface-elevated`, hairline ring)
  and slides the rows between source and target; the order commits on drop.
  The grip is a real button — focus + ↑/↓ reorders — so removing a visible
  arrow pair never removes keyboard access.
- The Watch episode nav (Prev / current / Next) also keeps its original
  component: three solid white pills, `px-4`, **semibold 600**, the middle
  one a non-interactive span. Only its height is unified to 30px (a
  transparent 1px border pins the box without drawing a line).
- List status tabs (My List) are standalone pills — solid active, soft rest.
- **Dropdowns are always `FilterSelect`** (the "All Genres" control): 30px
  shell, 12px medium value, 12px chevron at `right-2`, `--bg-soft` fill,
  `--border` hairline, transparent native `<select>` covering the whole
  pill. Never build a second dropdown style.
- The reader chapter picker and Watch episode picker are the white
  `tone="solid"` exception: `--text` fill, `--on-text` value and chevron, no
  visible border and **no focus ring** (the ring painted a dark outline
  around the white pill on click). The 1px transparent border is geometry
  only. The chevron uses a `2.5` viewBox stroke so it reads at the same
  optical weight as the 12px text arrows on the Prev/Next pills; the default
  dark dropdown keeps `2`.
- Skeleton placeholders for a pill use the same 30px box so the swap does
  not shift layout.

### Shadows & Depth

- Cards: no shadow resting, subtle scale on hover.
- Modal: `0 24px 64px rgba(0,0,0,0.9)` + backdrop 70% black.
- Nav: translucent with blur, fading from top.

### Selection & copying (D132, 2026-10-26)

- The whole page is **non-selectable**: `html, body { user-select: none;
  -webkit-user-select: none; -webkit-touch-callout: none }`, and links/images/
  video are not drag sources (`-webkit-user-drag: none`). Page text and
  artwork cannot be copied or dragged into another app.
- Form controls (`input`, `textarea`, `select`, `[contenteditable='true']`)
  opt back in with `user-select: text` — the search box and every settings
  field must stay usable. Native clipboard buttons keep working:
  `navigator.clipboard` does not depend on a selection.
- This is deliberate and site-wide (owner request). Do not "restore" text
  selection on a page without an explicit owner instruction.

## Components

### Navigation

- Height 56px, sticky, `background: linear-gradient(#070708 0%, rgba(7,7,8,0) 100%)` at top, solid #070708 on scroll.
- Left: "Aeri" wordmark (18px, 600, tracking -0.02em). Center links: Home, Browse, My List (13px, muted, active white). Right: Search, Profile.
- Icon-only controls share a 32×32 box (menu / search / bell; see Nav hitboxes).
- No sidebar. Quiet.

### Hero

- Height 56vh desktop (min 420px, max 680px), 62vh mobile. Width full-bleed within gutter.
- Backdrop image: `object-cover`, centered, cinematic crop.
- Gradients:
  - Left: `linear-gradient(90deg, rgba(7,7,8,0.96) 0%, rgba(7,7,8,0.55) 42%, transparent 72%)`
  - Bottom: `linear-gradient(0deg, var(--bg) 6%, transparent 62%)`
  - Optional top vignette for nav readability.
- Content sits left, max-width 560px, padding 0 48px. Title → meta (Type · Year · Episodes · Rating) → description (2-line clamp, muted) → actions.
- Buttons: Primary Play (white pill, 30px, 12px/500, black text) + secondary More Info (soft pill, same 30px geometry, backdrop-blur).
- Never cover hero with cards.

### Content Row

- Title 14px, 600, white, margin-bottom 10px.
- Cards in horizontal flex, `overflow-x: auto`, `scroll-snap-type: x mandatory`, hidden scrollbar, gap 8px.
- Scroll buttons appear on hover desktop, always visible on focus.
- Rows must not be boxed — transparent background, continuous feel.

### AnimeCard

- Landscape 16:9. Desktop width 236px, tablet 200px, mobile 148px. Aspect via `aspect-[16/9]`.
- **Shape lives in `src/components/cards/cardGeometry.ts`** (D137): art aspect,
  intrinsic `<img>` dims and rail widths are read from that module by
  `AnimeCard` AND by every loading skeleton. A skeleton never hardcodes an
  aspect ratio — that is how `/manga` came to load with anime-shaped boxes.
- **Hover blur is hover-only** (D137): the whole-card scrim keeps its ~50%
  darkening and 200ms fade, but `.card-frost` applies `backdrop-filter:
  blur(8px)` only while `.card-art:hover`, and only under
  `@media (hover: hover)`. An always-mounted blur gave every card its own
  compositing layer and cost ~18% of scroll main-thread time; touch never
  shows the treatment, so it never pays for it.
- **Scroll-quiet** (D143): during any scroll the frost, hover glyph and
  caption are suppressed (`html[data-scrolling="1"]`, 140ms after the last
  scroll event) so a card passing under a parked cursor cannot flash.
- Border: 1px solid transparent → border-white/10 on hover.
- Image: cover, subtle brightness 0.96 → 1 on hover.
- Hover: `scale-[1.04]`, transition 180ms ease-out, `z-index` lift, reveal title overlay.
- Variants:
  - `default`: artwork + title overlay on hover
  - `continue`: artwork + progress bar (2px, white, at bottom) + episode label
  - `compact`: smaller width for dense rows
- Never show score/year/genre badges by default.

### Detail Modal

- Dark overlay `rgba(0,0,0,0.78)` + backdrop blur 2px. Centered panel width 88vw max 980px.
- The veil is a **static, fixed, `pointer-events-none` layer behind the
  scroller** — never paint the tint or the `backdrop-filter` on the scroll
  container itself (D146). A filtered scroller promotes the whole scrollable
  height into one composited layer and becomes a containing block for fixed
  descendants; the scroller stays paint-transparent and owns only scrolling
  and the outside-click target.
- Top artwork 56% height with bottom fade into `var(--surface)`.
- Content: title, progress, Resume/Play, Add to List (icon circle), meta, description, genres (subtle pills), cast, episodes.
- Episodes: list, not grid. Row with number, title, duration, watched check.

### Watch / player (D130, revised D131)

- The page is the **plain background with the video on top**: no wrapper
  fill, no artwork poster behind the picture. (The 2026-10-26 revision keeps
  the corners and adds the hero frame — see below.)
- The Video.js skin keeps its **STOCK 28px corner radius**
  (`--media-border-radius` is not overridden). The wrapper is
  `rounded-[28px]` so every layer shares the same curve.
- The player wears the **hero's frosted frame**: `.frame-glass` (1px
  `--border-card` hairline on a 3px masked blur rim), `z-30`,
  `pointer-events-none`. The skin's own 1px frame line is made transparent
  (`.aeri-player { --media-border-color: transparent }`) so the edge never
  doubles. The skin's control gradient belongs to the player and stays.
- The loading state is the page background + spinner; the no-source state is
  the page background + copy/actions. Never paint a backdrop image under a
  pending player.
- **Synopsis is full width** — the same width as the episode grid (the page
  container), no `max-w-[720px]` reading column.
- Episode tiles: watched = 40% base scrim + `check-lg`; the CURRENT episode
  uses the same overlay with `audio-lines` (no "Now playing" chip). Both
  overlays fade out on hover/focus so the 22px play glyph is never drawn on
  top of them.
- Player chrome (controls, menus, tooltips) is Video.js's; page pills around
  it follow Pills & dropdowns.

### Skeletons

- Use shimmer on `var(--surface)` blocks matching card/hero shape. No spinner.

## Motion

- Durations: 150–200ms for hover, 240ms for modal (ease-out), 320ms for page cross-fade.
- Easing: `cubic-bezier(.2,.8,.2,1)` for entrances.
- The transform-bearing entrance classes (`.anim-pop-in`,
  `.anim-pop-in-center`) use `animation-fill-mode: backwards`, **never
  `both`** (D146). Their keyframes end at the identity transform, so `both`
  would retain `transform: scale(1)` forever and keep the element composited —
  on the detail card that meant a 2344 x 173,954 px GPU layer re-rastered
  during scroll, which flickered. Opacity-only fades may still use `both`.
- Always: `@media (prefers-reduced-motion: reduce) { * { animation: none !important }}`

## Responsive

- Breakpoints: 640 (sm), 768 (md), 1024 (lg), 1280 (xl).
- Hero: stacked on mobile (text below artwork? Actually overlay remains but padding tighter, title 22px).
- Cards: scroll momentum (`-webkit-overflow-scrolling: touch`).
- Navigation: collapse to hamburger or keep wordmark + Search only on <640 (keep minimal).

## Anti-Patterns

Prohibited: neon borders, glowing buttons, glassmorphism panels, giant modals, dense metadata tables, rainbow UI, 3+ font weights, heavy drop shadows.

## Copy Voice (hard rules)

- **Never all-caps text.** No `uppercase` class, no letter-spaced shouty labels
  (`TRACKING`, `SIGN IN`, …) — not for headers, badges, or buttons. Sentence
  case everywhere. Selection state is shown with border + radio dot, never
  with a caps badge.
- Quiet, plain words: "Sign in", "Connect", "Disconnect", "Continue".
