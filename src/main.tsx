import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/globals.css'
import App from './App.tsx'

// Early AniList OAuth callback handling before HashRouter consumes the hash
// AniList implicit grant returns #access_token=... which would be misinterpreted as a route
try {
  const hash = window.location.hash || ''
  if (hash.includes('access_token=')) {
    const params = new URLSearchParams(hash.slice(1))
    const token = params.get('access_token')
    if (token) {
      const expiresIn = params.get('expires_in')
      const sec = expiresIn ? Number(expiresIn) : undefined
      try {
        localStorage.setItem('aeri:anilist:token', token)
        if (sec) localStorage.setItem('aeri:anilist:token_expiry', String(Date.now() + sec * 1000))
        localStorage.setItem('aeri:anilist:token_type', 'Bearer')
      } catch {}
      const base = import.meta.env.BASE_URL as string
      const clean = `${window.location.origin}${base}#/`
      // Use replace to avoid history pollution
      window.history.replaceState(null, '', clean)
    }
  }
} catch {}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
