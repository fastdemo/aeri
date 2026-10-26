/**
 * PILL SYSTEM (owner 2026-10-26) — one button size for the whole app.
 *
 * The reference is the white "Popular" category pill on the Anime/Manga
 * tabs: 30px tall (6px vertical padding + 16px line-height + 1px border),
 * 14px horizontal padding, 12px medium text, fully rounded, hairline border.
 * Before this module the same white button was rendered at 24/28/30/32/36/
 * 44px with medium and semibold weights depending on the page — "identical
 * buttons, different size" (owner report). Every standalone pill now imports
 * these strings so a future change lands everywhere at once.
 *
 * Solid  = primary action (white fill, black label)
 * Soft   = secondary action (10% text tint, muted label) — the same shape and
 *          height as the inactive category pill, so a solid and a soft pill
 *          sit flush side by side.
 *
 * `leading-4` pins the line box to 16px; without it Tailwind's text-xs
 * line-height can be overridden by an ancestor and the pill silently grows.
 */
export const pillBase =
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-xs font-medium leading-4 transition disabled:cursor-not-allowed disabled:opacity-40'

export const pillSolid = `${pillBase} border-[var(--border-strong)] bg-[var(--text)] text-[var(--on-text)] hover:bg-[color-mix(in_srgb,var(--text)_90%,transparent)]`

export const pillSoft = `${pillBase} border-transparent bg-[color-mix(in_srgb,var(--text)_10%,transparent)] text-[var(--text-muted)] hover:bg-[color-mix(in_srgb,var(--text)_15%,transparent)] hover:text-[var(--text)]`
