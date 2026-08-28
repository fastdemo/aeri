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
  --text: #f2f2f3;
  --text-muted: #9a9aa0;
  --text-faint: #6b6b70;
  --accent: #e50914;
  --accent-hover: #f40612;
}
```
Page background: near-black (#070708). Surfaces are subtly lighter, not cards with heavy borders.

### Typography

- Family: `Inter`, `Geist Sans`, system fallback. Weights 400/500/600 only.
- Sizes: hero title 28–34px (600), hero meta 12–13px (400), hero desc 14px (400, muted), row title 14px (600), card title 12–13px (500), episode title 13px.
- Line heights: body 1.6, titles 1.1.
- Never bold everything. Hierarchy via size + color, not weight alone.

### Spacing & Radius

- Base unit 4px. Page gutters: 24px mobile, 48px desktop (max-width 1600px).
- Row gap 8px. Section gap 32px.
- Radius: card 6px, button 6px, modal 12px.

### Shadows & Depth

- Cards: no shadow resting, subtle scale on hover.
- Modal: `0 24px 64px rgba(0,0,0,0.9)` + backdrop 70% black.
- Nav: translucent with blur, fading from top.

## Components

### Navigation

- Height 56px, sticky, `background: linear-gradient(#070708 0%, rgba(7,7,8,0) 100%)` at top, solid #070708 on scroll.
- Left: "Aeri" wordmark (18px, 600, tracking -0.02em). Center links: Home, Browse, My List (13px, muted, active white). Right: Search, Profile.
- No sidebar. Quiet.

### Hero

- Height 56vh desktop (min 420px, max 680px), 62vh mobile. Width full-bleed within gutter.
- Backdrop image: `object-cover`, centered, cinematic crop.
- Gradients:
  - Left: `linear-gradient(90deg, rgba(7,7,8,0.96) 0%, rgba(7,7,8,0.55) 42%, transparent 72%)`
  - Bottom: `linear-gradient(0deg, var(--bg) 6%, transparent 62%)`
  - Optional top vignette for nav readability.
- Content sits left, max-width 560px, padding 0 48px. Title → meta (Type · Year · Episodes · Rating) → description (2-line clamp, muted) → actions.
- Buttons: Primary Play (white, black text, pill, 32px height) + secondary More Info (white/14% bg, backdrop-blur, white text).
- Never cover hero with cards.

### Content Row

- Title 14px, 600, white, margin-bottom 10px.
- Cards in horizontal flex, `overflow-x: auto`, `scroll-snap-type: x mandatory`, hidden scrollbar, gap 8px.
- Scroll buttons appear on hover desktop, always visible on focus.
- Rows must not be boxed — transparent background, continuous feel.

### AnimeCard

- Landscape 16:9. Desktop width 236px, tablet 200px, mobile 148px. Aspect via `aspect-[16/9]`.
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
- Top artwork 56% height with bottom fade into `var(--surface)`.
- Content: title, progress, Resume/Play, Add to List (icon circle), meta, description, genres (subtle pills), cast, episodes.
- Episodes: list, not grid. Row with number, title, duration, watched check.

### Skeletons

- Use shimmer on `var(--surface)` blocks matching card/hero shape. No spinner.

## Motion

- Durations: 150–200ms for hover, 240ms for modal (ease-out), 320ms for page cross-fade.
- Easing: `cubic-bezier(.2,.8,.2,1)` for entrances.
- Always: `@media (prefers-reduced-motion: reduce) { * { animation: none !important }}`

## Responsive

- Breakpoints: 640 (sm), 768 (md), 1024 (lg), 1280 (xl).
- Hero: stacked on mobile (text below artwork? Actually overlay remains but padding tighter, title 22px).
- Cards: scroll momentum (`-webkit-overflow-scrolling: touch`).
- Navigation: collapse to hamburger or keep wordmark + Search only on <640 (keep minimal).

## Anti-Patterns

Prohibited: neon borders, glowing buttons, glassmorphism panels, giant modals, dense metadata tables, rainbow UI, 3+ font weights, heavy drop shadows.
