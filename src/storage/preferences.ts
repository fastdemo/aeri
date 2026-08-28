const KEY = 'aeri:prefs'

export interface Preferences {
  autoplay: boolean
  subtitles: boolean
  volume: number
  theme: 'dark'
}

const defaults: Preferences = {
  autoplay: true,
  subtitles: true,
  volume: 1,
  theme: 'dark',
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
