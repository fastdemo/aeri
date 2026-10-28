/**
 * Tab-title builder: `<NAME> - Aeri`, or plain "Aeri"
 * when a page has no natural name (unknown routes). Everything that sets
 * a tab title goes through here so the format has exactly one home.
 */
export function aeriTitle(name: string | null | undefined): string {
  const clean = (name ?? '').trim()
  return clean ? `${clean} - Aeri` : 'Aeri'
}

/**
 * ROUTE fallback map for the tab title (the 'base' slot — see
 * useAeriTitle). Static names come from the URL alone, so pages never
 * wire titles manually; live-data pages (detail overlays, Watch, Read)
 * override with the record's name via the same hook's 'override' slot.
 * `/search` uses the live `?q=` term, wrapped in quotes
 * (`"romance" - Aeri` — real quote characters).
 */
export function routeDefaultTitle(pathname: string, search: string): string | null {
  const bare = pathname.replace(/\/+$/, '') || '/'
  const first = bare.split('/')[1] ?? ''
  if (first === 'search') {
    let term = ''
    try { term = new URLSearchParams(search || '').get('q')?.trim() ?? '' } catch { term = '' }
    return term ? `"${term}"` : 'Search'
  }
  const labels: Record<string, string> = {
    '': 'Home',
    anime: 'Anime',
    manga: 'Manga',
    list: 'My List',
    watch: 'Watch',
    read: 'Read',
    settings: 'Settings',
    docs: 'Docs',
    legal: 'Legal',
    profile: 'Profile',
  }
  return labels[first] ?? null
}
