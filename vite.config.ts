import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Base for GitHub Pages: /aeri/  (env-aware for forks)
const base = process.env.GITHUB_REPOSITORY
  ? `/${process.env.GITHUB_REPOSITORY.split('/')[1]}/`
  : '/aeri/'

export default defineConfig({
  base,
  plugins: [react(), tailwindcss()],
})
