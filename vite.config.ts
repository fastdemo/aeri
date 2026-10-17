import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// Base path: '/' — the site lives at the Cloudflare Worker origin root.
// The GitHub Pages `/aeri/` era was removed entirely on 2026-10-17 (D096):
// no GITHUB_PAGES / AERI_DEPLOY_TARGET switches remain. `AERI_BASE` stays as
// an escape hatch.
const base = process.env.AERI_BASE || '/'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // process.env (CI secret) takes precedence over .env file so production uses the deployed Worker URL
  const videoApiUrl = process.env.VITE_VIDEO_API_URL || env.VITE_VIDEO_API_URL || ''
  const authApiUrl = process.env.VITE_AUTH_API_URL || env.VITE_AUTH_API_URL || ''
  return {
    base,
    plugins: [react(), tailwindcss()],
    define: {
      'import.meta.env.VITE_VIDEO_API_URL': JSON.stringify(videoApiUrl),
      'import.meta.env.VITE_AUTH_API_URL': JSON.stringify(authApiUrl),
    },
  }
})
