// Display labels for media format/status. AniList uses SCREAMING enums
// (TV, RELEASING, …), MAL uses lowercase (tv, currently_airing, …) — the UI
// must never show the raw MAL shape, even for entries with no AniList match.

export function formatLabel(raw?: string | null): string | null {
  if (!raw) return null
  switch (raw.toLowerCase()) {
    case 'tv': return 'TV'
    case 'tv_short': return 'TV Short'
    case 'movie': return 'Movie'
    case 'ova': return 'OVA'
    case 'ona': return 'ONA'
    case 'special': return 'Special'
    case 'tv_special': return 'TV Special'
    case 'music': return 'Music'
    case 'cm': return 'CM'
    case 'pv': return 'PV'
    default: return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase()
  }
}

export function statusLabel(raw?: string | null): string | null {
  if (!raw) return null
  switch (raw.toLowerCase()) {
    case 'finished':
    case 'finished_airing': return 'Finished'
    case 'releasing':
    case 'currently_airing': return 'Airing'
    case 'not_yet_released':
    case 'not_yet_aired': return 'Upcoming'
    case 'hiatus': return 'Hiatus'
    case 'cancelled': return 'Cancelled'
    default: return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase()
  }
}
