# Skill: browser-testing — Aeri

Mandatory after major UI changes.

## Procedure

1. `npm run dev` (port 5173) and `npm run build && npm run preview` (verify base `/aeri/`).
2. Playwright: launch, navigate to `http://localhost:5173/#/` (and preview `/aeri/#/`).
3. Steps:
   - Check no console errors
   - Screenshot at 1440×900, 768×1024, 375×812
   - Click cards → detail modal opens → close
   - Search → type → results appear
   - Visit `#/anime/<id>`, refresh → no 404
   - Check accessibility: axe-like snapshot, focus rings, dialog aria
4. Compare hero height, gradient, card 16:9, row spacing, typography vs reference.
5. Log deviations and fix loop.

## Tools

- Playwright MCP preferred (`browser_navigate`, `browser_take_screenshot`, etc.)
- Fallback: `npx playwright test` if script exists

## Deep links to test

- `#/` `#/browse` `#/anime/cyberpunk-edgerunners` `#/watch/cyberpunk-edgerunners/1` `#/list` `#/search?q=frieren`

## References

- `AGENTS.md §14`
