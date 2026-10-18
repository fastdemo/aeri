import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/globals.css'
import App from './App.tsx'
import { applyTheme } from './lib/themes'

// Legacy in-app hash URLs (pre-BrowserRouter era; any link/bookmark copied
// before the routing swap, e.g. `/#/anime/16498` or `/#/search?q=x`) are
// translated to their clean path form — once at boot, and again on any
// later hashchange (a fragment-only address-bar edit while the app is
// already open is a same-document navigation, so the app must catch it).
// BrowserRouter observes history only via popstate, so a post-mount
// translation re-dispatches it for an instant route sync. Path-style URLs
// are the canonical form from here on.
// (The 2026-10-18 ⟳ reload-after-card diagnostic that lived here — a
// sessionStorage `aeri-detail-open` mark + 20s tab-title prefix — was
// removed on the owner's request; every app-side reload path is gone.)

function translateLegacyHash() {
  try {
    const h = window.location.hash
    if (h.startsWith('#/') && h.length > 2) {
      const route = h.slice(1)
      const qIndex = route.indexOf('?')
      const pathPart = qIndex === -1 ? route : route.slice(0, qIndex)
      const sp = new URLSearchParams(window.location.search)
      if (qIndex !== -1) {
        for (const [k, v] of new URLSearchParams(route.slice(qIndex + 1))) {
          if (!sp.has(k)) sp.append(k, v)
        }
      }
      const qs = sp.toString()
      window.history.replaceState(null, '', pathPart + (qs ? `?${qs}` : ''))
      window.dispatchEvent(new PopStateEvent('popstate'))
    }
  } catch {}
}
translateLegacyHash()
window.addEventListener('hashchange', translateLegacyHash)

// Apply persisted theme before first render (no wrong-theme flash).
// Reads the same `aeri:prefs` key the app persists — no new storage.
try {
  const raw = localStorage.getItem('aeri:prefs')
  const saved = raw ? (JSON.parse(raw) as { theme?: string }).theme : undefined
  applyTheme(saved || 'aeri-dark')
} catch {
  try { applyTheme('aeri-dark') } catch {}
}

// Early MAL OAuth callback handling before the router mounts — MAL uses ?code= & state= at the static document
// (origin + base, e.g. https://aeri.fastdemo.workers.dev/). The code stays in
// the query for MALContext; after exchange the context cleans the URL itself.
try {
  const url = new URL(window.location.href)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const err = url.searchParams.get('error')
  if (code || err) {
    const expectedState = (() => { try { return localStorage.getItem('aeri:mal:oauth_state') } catch { return null } })()
    const verifier = (() => { try { return localStorage.getItem('aeri:mal:code_verifier') } catch { return null } })()
    // Validate state if present
    const stateOk = !state || !expectedState || state === expectedState
    if (code && verifier && stateOk) {
      // Defer token exchange to the React context (which has proper error handling and worker fallback)
      // Just keep the code in the URL for handleMalOAuthCallback to pick up, then clean URL to /
      // Do not clear code/state here — let the context handle the exchange once
    } else if (err) {
      // Clean error from URL and hand back to HashRouter to avoid loop
      url.searchParams.delete('error')
      url.searchParams.delete('error_description')
      url.searchParams.delete('state')
      const base = import.meta.env.BASE_URL as string
      const clean = `${window.location.origin}${base}${url.search || ''}`
      window.history.replaceState(null, '', clean)
    }
    // If code is present, we keep it in the URL so MALContext can handle it after React mounts
    // The context will clean it and redirect to / after successful exchange
  }
} catch {}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
