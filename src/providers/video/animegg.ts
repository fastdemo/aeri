import type { Anime } from '../../types/anime'
import type { VideoProvider, VideoEpisode, VideoSourceEnhanced, ProviderCapabilities, SourceOptions } from './types'
import { cachedFetch, fetchWithTimeout } from './base'

const BASE = 'https://www.animegg.org'
const REFERER = 'https://www.animegg.org/'

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'User-Agent': 'Mozilla/5.0',
    Accept: 'text/html,*/*',
    Referer: REFERER,
    ...extra,
  }
}

/**
 * AnimeGG anime provider — VERIFIED_WORKING 2026-09-27 (Naruto ep 1:
 * search → /series/naruto → /naruto-episode-1 → /embed/25881 →
 * /play/248322/video.mp4 → 200 video/mp4, sub+dub variants).
 *
 * Tier 2 (first fallback after MegaVid). Browser-direct scraping of the
 * site's server-rendered HTML (Express + jwplayer); NO worker JSON routes.
 *
 * Signed/date-stamped MP4 URLs: episodes (stable series/episode links)
 * are cached; sources (signed /play/ MP4) ALWAYS resolve fresh at
 * playback time, never served from cache.
 */
export class AnimeGGProvider implements VideoProvider {
  id = 'animegg'
  name = 'AnimeGG'
  status = 'verified' as const
  capabilities: ProviderCapabilities = {
    id: 'animegg',
    name: 'animegg',
    displayName: 'AnimeGG',
    languages: ['sub', 'dub'],
    subtitles: true,
    embed: false,
    directVideo: true,
    search: true,
    episodes: true,
    sources: true,
    hls: false,
    mp4: true,
  }

  async resolveAnimeId(anime: Anime): Promise<string | null> {
    return cachedFetch(`video:animegg:resolve:${anime.identity.internalId}`, async () => {
      try {
        const q = anime.title.english || anime.title.romaji
        const res = await fetchWithTimeout(`${BASE}/search/?q=${encodeURIComponent(q)}`, { headers: headers() }, 6000)
        if (!res.ok) return null
        const html = await res.text()
        const slugs = [...new Set([...html.matchAll(/\/series\/([a-z0-9-]+)/gi)].map(m => m[1]))]
        if (!slugs.length) return null
        const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
        const want = [anime.title.romaji, anime.title.english ?? ''].map(norm).filter(Boolean)
        // Prefer exact slug match (romaji words joined by dashes), else first.
        const exact = slugs.find(s => want.some(w => norm(s) === w || norm(s).startsWith(w) || w.startsWith(norm(s))))
        return exact ?? slugs[0] ?? null
      } catch { return null }
    })
  }

  async getEpisodes(anime: Anime, signal?: AbortSignal): Promise<VideoEpisode[]> {
    const slug = await this.resolveAnimeId(anime)
    if (!slug) return []
    return cachedFetch(`video:animegg:episodes:${slug}`, async () => {
      try {
        const res = await fetchWithTimeout(`${BASE}/series/${slug}`, { headers: headers() }, 6000, signal)
        if (!res.ok) return []
        const html = await res.text()
        // Episode links look like /<slug>-episode-<n>; collect unique numbers.
        const nums = new Set<number>()
        const re = new RegExp(`${slug.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}-episode-(\\d+)`, 'gi')
        let m: RegExpExecArray | null
        while ((m = re.exec(html)) !== null) {
          const n = Number(m[1])
          if (Number.isFinite(n) && n > 0 && n < 5000) nums.add(n)
        }
        if (!nums.size) return []
        return [...nums].sort((a, b) => a - b).map(n => ({
          id: `animegg-${slug}-${n}`,
          animeId: anime.identity.internalId,
          number: n,
          title: `Episode ${n}`,
          thumbnail: undefined,
          provider: 'animegg',
          providerEpisodeId: `${slug}::${n}`,
          language: 'sub' as const,
          availableLanguages: ['sub', 'dub'] as const,
        })) as VideoEpisode[]
      } catch { return [] }
    })
  }

  async getSources(episode: VideoEpisode, options?: SourceOptions): Promise<VideoSourceEnhanced[]> {
    const lang = options?.preferredLanguage ?? episode.language ?? 'sub'
    // NEVER cachedFetch: signed /play/ MP4 URLs are temporary.
    // Language routing: the episode page exposes Subbed/Dubbed toggles as
    // separate episode URLs; the embed list order follows the page variant.
    // We fetch the page for the REQUESTED language first (dub pages carry
    // -dub slugs), so the first working MP4 matches lang.
    try {
      const [slug, num] = episode.providerEpisodeId.split('::')
      if (!slug || !num) return []
      const langSlug = lang === 'dub' && !slug.endsWith('-dub') ? `${slug}-dub` : slug
      const trySlugs = langSlug === slug ? [slug] : [langSlug, slug]
      const out: VideoSourceEnhanced[] = []
      for (const s of trySlugs) {
        try {
          const epRes = await fetchWithTimeout(`${BASE}/${s}-episode-${num}`, { headers: headers() }, 6000, options?.signal)
          if (!epRes.ok) continue
          const epHtml = await epRes.text()
          // Embed ids: /embed/<n> — first working MP4 wins for this page
          // variant (embeds on a sub page are sub, dub page are dub).
          const embeds = [...new Set([...epHtml.matchAll(/\/embed\/(\d+)/g)].map(m => m[1]))]
          if (!embeds.length) continue
          for (const emb of embeds.slice(0, 2)) {
            try {
              const emRes = await fetchWithTimeout(`${BASE}/embed/${emb}`, { headers: { ...headers(), Referer: `${BASE}/${s}-episode-${num}` } }, 6000, options?.signal)
              if (!emRes.ok) continue
              const emHtml = await emRes.text()
              const play = emHtml.match(/\/play\/(\d+)\/video\.mp4\?for=([0-9]+)/)
              if (!play) continue
              out.push({
                url: `${BASE}/play/${play[1]}/video.mp4?for=${play[2]}`,
                type: 'mp4',
                quality: 'auto',
                provider: 'animegg',
                language: lang as any,
                embed: false,
                headers: { Referer: REFERER },
              })
              break // one working MP4 per page variant is enough
            } catch { /* next embed */ }
          }
          if (out.length) break // requested-language page won; stop
        } catch { /* next slug */ }
      }
      return out
    } catch { return [] }
  }
}

export const animeGGProvider = new AnimeGGProvider()
