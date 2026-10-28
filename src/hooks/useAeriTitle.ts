import { useEffect, useRef } from 'react'
import { aeriTitle } from '../lib/pageTitle'
import { isIncognitoEnabled } from '../storage/preferences'

/**
 * Tab-title system: EVERY page's tab reads
 * "<NAME> - Aeri". One coordinator, two slots:
 *
 * - 'base' (shell-only in App): the ROUTE fallback mapped from the
 *   pathname — "Home - Aeri", "Manga - Aeri", "Docs - Aeri" — including
 *   the search page's quoted live term (`"romance" - Aeri`). NO page
 *   component has to remember to wire a static title; the shell does it
 *   from the URL. Unknown routes fall back to plain "Aeri".
 *
 * - 'override' (a stack for live-data names): show/manga titles on the
 *   preview-card overlay, Watch and Read pages, NotFound. A STACK — not a
 *   single slot — because pages stay MOUNTED under floating cards (D100):
 *   the top writer wins, and every unmount removes exactly its OWN entry,
 *   so closing a card restores the page beneath it cleanly even after
 *   related-entry swaps inside the card (no stale-name restoration).
 */

/** Name-slot state (module-level: titles outlive component identity). */
let baseName: string | null = null

interface StackEntry { key: symbol; name: string | null }
const overrideStack: StackEntry[] = []

function apply(): void {
  const top = overrideStack.length ? overrideStack[overrideStack.length - 1].name : null
  try {
    // Incognito: EVERY page's tab reads exactly
    // "Incognito - Aeri" while the mode is on — the incognito signal is
    // the whole title, no route/show names leak into it.
    document.title = isIncognitoEnabled() ? 'Incognito - Aeri' : aeriTitle(top ?? baseName)
  } catch { /* no document (SSR/tests) — ignore */ }
}

/** Re-apply the current tab title (used by the Incognito toggle: the mode
 *  changes the title without any route or data change). */
export function refreshAeriTitle(): void {
  apply()
}

export function useAeriTitle(name: string | null | undefined, level: 'base' | 'override' = 'override'): void {
  if (level === 'base') {
    // The shell owns this slot exclusively; no cleanup (App outlives pages).
    useEffect(() => {
      baseName = (name ?? '').trim() || null
      apply()
    }, [name])
    return
  }
  const key = useRef(Symbol('aeri-title')).current
  useEffect(() => {
    const entry: StackEntry = { key, name: (name ?? '').trim() || null }
    overrideStack.push(entry)
    apply()
    return () => {
      const i = overrideStack.findIndex(e => e.key === key)
      if (i >= 0) overrideStack.splice(i, 1)
      apply()
    }
  }, [name, key])
}
