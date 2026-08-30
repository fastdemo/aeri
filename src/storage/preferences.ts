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
    return base
  } catch { return null }
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
