import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/globals.css'
import App from './App.tsx'
import { applyTheme } from './lib/themes'

// Apply persisted theme before first render (no wrong-theme flash).
// Reads the same `aeri:prefs` key the app persists — no new storage.
try {
  const raw = localStorage.getItem('aeri:prefs')
  const saved = raw ? (JSON.parse(raw) as { theme?: string }).theme : undefined
  applyTheme(saved || 'aeri-dark')
} catch {
  try { applyTheme('aeri-dark') } catch {}
}

// Early MAL OAuth callback handling before HashRouter — MAL uses ?code= & state= at the static document
// Must handle at origin + base (e.g. https://aeri.fastdemo.workers.dev/ or legacy https://fastdemo.github.io/aeri/) (no hash) and then hand back to HashRouter #/
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
      // Just keep the code in the URL for handleMalOAuthCallback to pick up, then clean URL to #/
      // Do not clear code/state here — let the context handle the exchange once
    } else if (err) {
      // Clean error from URL and hand back to HashRouter to avoid loop
      url.searchParams.delete('error')
      url.searchParams.delete('error_description')
      url.searchParams.delete('state')
      const base = import.meta.env.BASE_URL as string
      const clean = `${window.location.origin}${base}#/`
      window.history.replaceState(null, '', clean)
    }
    // If code is present, we keep it in the URL so MALContext can handle it after React mounts
    // The context will clean it and redirect to #/ after successful exchange
  }
} catch {}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
