import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

const base = '/'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // process.env (CI secret) takes precedence over .env file so production uses the deployed Worker URL
  const videoApiUrl = process.env.VITE_VIDEO_API_URL || env.VITE_VIDEO_API_URL || ''
  return {
    base,
    plugins: [react(), tailwindcss()],
    define: {
      'import.meta.env.VITE_VIDEO_API_URL': JSON.stringify(videoApiUrl),
    },
  }
})
