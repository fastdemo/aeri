import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// Base path:
// - Cloudflare Worker production: always '/' (https://aeri.fastdemo.workers.dev/)
// - GitHub Pages legacy: '/aeri/' (only when explicitly building for Pages)
// We must NOT derive Pages base from GITHUB_REPOSITORY during Worker builds, because
// GitHub Actions always sets GITHUB_REPOSITORY even for Worker deploys.
const isGhPagesBuild = process.env.AERI_DEPLOY_TARGET === 'gh-pages' || process.env.GITHUB_PAGES === 'true'
const base = isGhPagesBuild
  ? (process.env.AERI_BASE || (process.env.GITHUB_REPOSITORY ? `/${process.env.GITHUB_REPOSITORY.split('/')[1]}/` : '/aeri/'))
  : (process.env.AERI_BASE || '/')

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
