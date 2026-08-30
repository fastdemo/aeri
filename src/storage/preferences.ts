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
