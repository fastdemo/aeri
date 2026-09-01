const KEY = 'aeri:prefs'

import type { VideoLanguage } from '../providers/video/types'

export interface Preferences {
  autoplay: boolean
  subtitles: boolean
  volume: number
  theme: 'dark'
  preferredAudio: VideoLanguage
  preferredProvider: string | null
  enabledProviders?: Record<string, boolean> | null
  providerOrder?: string[] | null
  customVideoApiUrl?: string | null
  preferredQuality?: string | null
}

const defaults: Preferences = {
  autoplay: true,
  subtitles: true,
  volume: 1,
  theme: 'dark',
  preferredAudio: 'sub',
  preferredProvider: null,
  enabledProviders: null,
  providerOrder: null,
  customVideoApiUrl: null,
  preferredQuality: null,
}

export function getEffectiveVideoApiUrl(): string | null {
  try {
    const prefs = getPreferences()
    const custom = prefs.customVideoApiUrl?.trim().replace(/\/$/, '') || null
    if (custom) {
      try { const u = new URL(custom); if (u.protocol !== 'https:' && u.protocol !== 'http:') return null; return custom } catch { return null }
    }
    const envUrl = (import.meta as any).env?.VITE_VIDEO_API_URL as string | undefined
    const base = envUrl?.trim().replace(/\/$/, '') || null
    if (base) return base
    // Same-origin fallback for Cloudflare deployment (frontend + worker on same origin)
    // When running on Cloudflare (not localhost, not github.io without worker), use same-origin /api
    try {
      if (typeof window !== 'undefined') {
        const host = window.location.hostname
        const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1'
        const isGithubPages = host.endsWith('github.io')
        // On Cloudflare (or any non-local, non-GH Pages), same-origin is the worker
        if (!isLocal && !isGithubPages) {
          return window.location.origin
        }
        // For GH Pages without custom URL, there is no same-origin worker — return null to trigger direct (will be CORS-blocked for MAL, but that's expected)
        // For local dev without env, also return null to allow direct fetches where possible
        return null
      }
    } catch {}
    return null
  } catch { return null }
}

export function getSameOriginApiBase(): string {
  // Helper for building same-origin API URLs like /api/mal/token
  // Returns '' for relative (same-origin) or a full origin if needed
  const base = getEffectiveVideoApiUrl()
  if (base && base.startsWith('http')) return base
  // Same-origin relative
  return ''
}

export function getPreferences(): Preferences {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...defaults, ...JSON.parse(raw) } : defaults
  } catch {
    return defaults
  }
}

export function setPreferences(patch: Partial<Preferences>) {
  const next = { ...getPreferences(), ...patch }
  localStorage.setItem(KEY, JSON.stringify(next))
  return next
}
