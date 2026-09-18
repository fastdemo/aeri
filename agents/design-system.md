# Design System — Aeri

## Principles

Near-black default, quiet receding nav, restrained Inter type (400/500/600),
cinematic edge-to-edge hero with layered scrims (never solid overlays),
landscape cards in horizontal snap rows, minimal chrome/badges, quiet
150–200ms hovers, dark expansion-style modals. Visual quality > features.

## Tokens (`src/styles/globals.css` + `src/lib/themes.ts`)

All color flows through 17 CSS vars — **no hardcoded whites/blacks/reds in
components** (enforced by audit; gradients use `color-mix(in srgb,
var(--bg)…)` so scrims follow light themes too):

`--bg --bg-soft --surface --surface-hover --surface-elevated --border
--border-strong --text --text-muted --text-faint --on-text --accent
--accent-hover --warn --ok --scrim --shadow`, plus `--radius-sm/md/lg`,
`--nav-height`.

`text` doubles as white (primary buttons/pills sit on `--text` with
`--on-text` ink). Status: `--warn` amber, `--ok` green. Scrim/shadow tokens
drive overlays, dropdowns, spinners, glows.

## Themes (17, `THEMES` registry)

`aeri-dark` (default — pure black `#000`, white text, white accent, **no
red**), catppuccin latte/frappé/macchiato/mocha (official hexes), gruvbox
dark/light, dracula, nord, tokyo-night, one-dark, solarized dark/light,
rosé-pine, everforest-dark, kanagawa, monokai. Each maps the same 17 keys
with contrast-checked text pairs.

## Applying themes

`applyTheme(id)` sets `documentElement.dataset.theme` + all vars (no React
rerender); persisted in `aeri:prefs.theme`; pre-applied in `main.tsx` before
first paint (no flash). Settings grid shows bg/surface/accent swatches.
To add a theme: append one `t(...)` entry — no component changes.

## Type / spacing / shape

Hero 2.2rem/600 tight; row 0.95rem/600; card 0.8rem/500; body 0.875rem/400
lh 1.6 muted. Radius 4/8/12; pills `rounded-full` keep shape via box-shadow
focus (not outline). Thin scrollbars tinted `border-strong`.

## Motion / states

Keyframes: fade/pop/slide (≤200ms, transform+opacity), shimmer skeletons,
card `img.img-fade` onLoad, hero crossfade+ken-burns, carousel 5.5s.
`prefers-reduced-motion` kill-switch. Focus `:focus-visible` on text color;
selection uses border-strong. Loading spinners use border-strong/text.
Progress bars: 2px glowing text-color (cards), modal variant matches.

## Imagery

Card art `aspect-[16/9]`, `loading="lazy"`, `decoding="async"`, explicit
width/height (decode planning), onLoad fade, onError hide + EP fallback.
Hero `eager` + `fetchPriority high`. Backdrop fallback behind player.

## Accessibility

Semantic landmarks, keyboard rows/modals/player, aria on icon buttons and
`role=dialog/menu/radiogroup`, 44px mobile targets, contrast via scrims +
checked token pairs, no hover-only actions.
