# Skill: frontend-design — Aeri

Enforce Aeri's streaming design language on every change.

## Checklist

- [ ] Background is near-black #070708, not white or gradient-heavy
- [ ] Nav is quiet, 56px, translucent, not a sidebar
- [ ] Hero is cinematic: full-bleed backdrop, left gradient 0→70%, bottom fade, text readable
- [ ] Cards are landscape 16:9, no badges, subtle hover scale 1.04, 180ms
- [ ] Rows are horizontal, gap 8px, no boxes/borders, scroll with hidden scrollbar
- [ ] Typography restrained: weights 400/500/600, row title 14px, card title 12px, hero title 28-34px
- [ ] No neon, no glassmorphism, no cyberpunk, no dashboard
- [ ] Detail modal dark, immersive, large backdrop with fade
- [ ] Mobile hero text remains readable, cards touch-scrollable
- [ ] Motion respects prefers-reduced-motion

## Review Steps

1. Inspect hero gradients, card dimensions, row spacing, nav spacing, whitespace in browser.
2. Compare against reference screenshots (GTA/Cyberpunk Netflix browsing + detail).
3. Flag any generic Tailwind template pattern.

## References

- `docs/DESIGN_SYSTEM.md`
- `AGENTS.md §3`
