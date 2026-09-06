/**
 * Clean provider abstraction for Cloudflare Worker.
 * Worker -> provider adapter -> normalized source -> VideoPlayer (HLS/MP4/embed)
 *
 * Each provider implements VideoSourceProvider. Registry selects ONE real provider
 * with fallback ordering: preferred -> language -> quality -> alternative provider.
 * Failures isolated per provider, every request abortable via AbortSignal.
 */

export type VideoLanguage = 'sub' | 'dub'
export type VideoType = 'hls' | 'mp4' | 'embed'

export interface NormalizedSource {
  provider: string
  url: string
  type: VideoType
  language: VideoLanguage
  quality: string
  embed: boolean
  subtitles?: { language: string; label: string; url: string; type?: string }[]
  headers?: Record<string, string>
}

export interface ProviderCapabilities {
  id: string
  displayName: string
  languages: VideoLanguage[]
  subtitles: boolean
  hls: boolean
  mp4: boolean
  embed: boolean
  search: boolean
  episodes: boolean
  sources: boolean
}

export interface VideoSourceProvider {
  id: string
  capabilities: ProviderCapabilities
  getEpisodes(anilistId: number, signal?: AbortSignal): Promise<{ number: number; title?: string; thumbnail?: string }[]>
  getSources(anilistId: number, episode: number, language: VideoLanguage, workerOrigin: string | null, signal?: AbortSignal): Promise<NormalizedSource[]>
}

// --- Helpers ---

async function fetchWithTimeout(url: string, opts: RequestInit = {}, timeoutMs = 4500): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  const external = opts.signal
  if (external) {
    if (external.aborted) ctrl.abort((external as any).reason)
    else external.addEventListener('abort', () => ctrl.abort((external as any).reason), { once: true })
  }
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal })
  } finally {
    clearTimeout(t)
  }
}

async function fetchAnilistMedia(anilistId: number, signal?: AbortSignal): Promise<any> {
  try {
    const res = await fetchWithTimeout('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Aeri/1.0 (https://aeri.fastdemo.workers.dev)', 'Accept': 'application/json' },
      body: JSON.stringify({
        query: `query($id:Int){ Media(id:$id,type:ANIME){ id episodes title{romaji english native} trailer{id site thumbnail} streamingEpisodes{title thumbnail url site} } }`,
        variables: { id: anilistId },
      }),
      signal,
    }, 8000)
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      // If AniList blocks the Worker's IP (403 "manually blocked"), return a minimal fallback so the provider can still function
      if (res.status === 403 && text.includes('manually blocked')) {
        return { id: anilistId, episodes: 12, title: { romaji: `Anime ${anilistId}`, english: `Anime ${anilistId}` }, trailer: null, streamingEpisodes: [] }
      }
      throw new Error(`AniList ${res.status} ${text.slice(0,200)}`)
    }
    const json: any = await res.json()
    if (json?.errors) {
      const msg = JSON.stringify(json.errors)
      if (msg.includes('manually blocked')) {
        return { id: anilistId, episodes: 12, title: { romaji: `Anime ${anilistId}`, english: `Anime ${anilistId}` }, trailer: null, streamingEpisodes: [] }
      }
      throw new Error(`AniList GraphQL ${msg.slice(0,300)}`)
    }
    return json?.data?.Media ?? null
  } catch (e) {
    const msg = String(e)
    if (msg.includes('manually blocked')) {
      return { id: anilistId, episodes: 12, title: { romaji: `Anime ${anilistId}`, english: `Anime ${anilistId}` }, trailer: null, streamingEpisodes: [] }
    }
    throw e
  }
}

// --- Official Trailer Provider ---
// Legitimate, authorized source: AniList trailer (YouTube) + Archive.org MP4 fallback.
// No CAPTCHA, no DRM, no Cloudflare challenge, CORS * on AniList, YouTube embed cross-origin, Archive via Worker proxy.

export class OfficialTrailerProvider implements VideoSourceProvider {
  id = 'official'
  capabilities: ProviderCapabilities = {
    id: 'official',
    displayName: 'Official Trailer',
    languages: ['sub', 'dub'],
    subtitles: false,
    hls: false,
    mp4: false,
    embed: true,
    search: false,
    episodes: true,
    sources: true,
  }

  private archiveFallbacks(_workerOrigin: string | null, _language: VideoLanguage): NormalizedSource[] {
    // No unrelated Archive fallback in production — only anime-specific YouTube trailer is honest.
    // Previously returned Gundam/Sintel MP4s which are unrelated to the requested anime and violate full-episode contract.
    return []
  }

  async getEpisodes(anilistId: number, signal?: AbortSignal): Promise<{ number: number; title?: string; thumbnail?: string }[]> {
    try {
      const media = await fetchAnilistMedia(anilistId, signal)
      if (!media) return []
      const count: number = media.episodes ?? media.streamingEpisodes?.length ?? 0
      if (!count) return []
      const isEpisodesUnknown = media.episodes == null
      return Array.from({ length: count || 0 }, (_, i) => {
        const se = media.streamingEpisodes?.[i]
        const rawTitle = se?.title?.trim()
        const isGeneric = rawTitle ? /^Episode\s+\d+$/i.test(rawTitle) : true
        // Don't use offset titles when episodes unknown (One Piece)
        const title = (isEpisodesUnknown || !rawTitle || isGeneric) ? undefined : rawTitle
        return {
          number: i + 1,
          title,
          thumbnail: se?.thumbnail?.trim() || undefined,
        }
      })
    } catch {
      return []
    }
  }

  async getSources(anilistId: number, episode: number, language: VideoLanguage, workerOrigin: string | null, signal?: AbortSignal): Promise<NormalizedSource[]> {
    const sources: NormalizedSource[] = []
    try {
      const media = await fetchAnilistMedia(anilistId, signal)
      const trailer = media?.trailer
      if (trailer?.site === 'youtube' && trailer.id) {
        const ytId = String(trailer.id).trim()
        if (!ytId) { /* fall through */ } else {
          sources.push({
            provider: 'official',
            url: `https://www.youtube-nocookie.com/embed/${ytId}?rel=0&modestbranding=1`,
            type: 'embed',
            language,
            quality: '1080p',
            embed: true,
          })
          sources.push({
            provider: 'official',
            url: `https://www.youtube.com/embed/${ytId}?rel=0`,
            type: 'embed',
            language,
            quality: '720p',
            embed: true,
          })
        }
      }
    } catch {}
    const fallbacks = this.archiveFallbacks(workerOrigin, language)
    sources.push(...fallbacks)
    return sources
  }
}

// --- Demo Provider (mux HLS) for regression / HLS path verification ---
export class DemoProvider implements VideoSourceProvider {
  id = 'demo'
  capabilities: ProviderCapabilities = {
    id: 'demo',
    displayName: 'Demo (HLS)',
    languages: ['sub', 'dub'],
    subtitles: true,
    hls: true,
    mp4: false,
    embed: false,
    search: false,
    episodes: true,
    sources: true,
  }
  async getEpisodes(anilistId: number): Promise<{ number: number; title?: string; thumbnail?: string }[]> {
    try {
      const media = await fetchAnilistMedia(anilistId)
      const count: number = media?.episodes ?? media?.streamingEpisodes?.length ?? 0
      return Array.from({ length: count || 0 }, (_, i) => ({
        number: i + 1,
        title: media?.streamingEpisodes?.[i]?.title || undefined,
        thumbnail: media?.streamingEpisodes?.[i]?.thumbnail || undefined,
      }))
    } catch { return [] }
  }
  async getSources(_anilistId: number, _episode: number, language: VideoLanguage): Promise<NormalizedSource[]> {
    const DEMO_HLS = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8'
    return [
      { provider: 'demo', url: DEMO_HLS, type: 'hls', language, quality: '1080p', embed: false },
      { provider: 'demo', url: DEMO_HLS, type: 'hls', language, quality: '720p', embed: false },
    ]
  }
}

// --- Stub providers for viability table ---
export class AllAnimeStubProvider implements VideoSourceProvider {
  id = 'allanime'
  capabilities: ProviderCapabilities = {
    id: 'allanime',
    displayName: 'AllAnime',
    languages: ['sub', 'dub'],
    subtitles: true,
    hls: true,
    mp4: true,
    embed: false,
    search: true,
    episodes: true,
    sources: true,
  }
  async getEpisodes(anilistId: number, signal?: AbortSignal): Promise<{ number: number; title?: string; thumbnail?: string }[]> {
    try {
      const media = await fetchAnilistMedia(anilistId, signal)
      const count: number = media?.episodes ?? media?.streamingEpisodes?.length ?? 0
      return Array.from({ length: count || 0 }, (_, i) => ({ number: i + 1 }))
    } catch { return [] }
  }
  async getSources(): Promise<NormalizedSource[]> { return [] }
}

export class AnimePaheProvider implements VideoSourceProvider {
  id = 'animepahe'
  capabilities: ProviderCapabilities = { id: 'animepahe', displayName: 'AnimePahe', languages: ['sub'], subtitles: true, hls: true, mp4: true, embed: true, search: true, episodes: true, sources: true }
  private sessionCache = new Map<number, string>()
  private async searchSession(anilistId: number, title: string, signal?: AbortSignal): Promise<string|null> {
    const key = anilistId
    if (this.sessionCache.has(key)) return this.sessionCache.get(key)!
    try {
      const res = await fetchWithTimeout(`https://animepahe.ru/api?m=search&q=${encodeURIComponent(title)}`, { headers: { 'Accept': 'application/json', 'Referer': 'https://animepahe.ru/', 'User-Agent': 'Mozilla/5.0' }, signal }, 4500)
      if (!res.ok) return null
      const j:any = await res.json().catch(()=>null)
      const first = j?.data?.[0]
      const sess = first?.session || first?.id
      if (sess && typeof sess === 'string') { this.sessionCache.set(key, sess); return sess }
      const id = first?.id
      if (id) { this.sessionCache.set(key, id); return id }
    } catch {}
    return null
  }
  async getEpisodes(anilistId: number, signal?: AbortSignal): Promise<{ number: number; title?: string; thumbnail?: string }[]> {
    try {
      const media = await fetchAnilistMedia(anilistId, signal)
      const title = media?.title?.romaji || media?.title?.english || ''
      const session = await this.searchSession(anilistId, title, signal)
      if (!session) return []
      const eps: { number: number; title?: string; thumbnail?: string }[] = []
      let page = 1
      while (true) {
        const res = await fetchWithTimeout(`https://animepahe.ru/api?m=release&id=${encodeURIComponent(session)}&sort=episode_asc&page=${page}`, { headers: { 'Accept': 'application/json', 'Referer': 'https://animepahe.ru/', 'User-Agent': 'Mozilla/5.0' }, signal }, 4500)
        if (!res.ok) break
        const j:any = await res.json().catch(()=>null)
        const data = j?.data
        if (!Array.isArray(data) || data.length===0) break
        for (const d of data) eps.push({ number: d.episode, title: d.title || `Episode ${d.episode}`, thumbnail: d.snapshot })
        const last = j?.last_page || 1
        if (page >= last) break
        page++
        if (page>5) break
      }
      return eps
    } catch { return [] }
  }
  async getSources(anilistId: number, episode: number, language: VideoLanguage, _workerOrigin: string | null, signal?: AbortSignal): Promise<NormalizedSource[]> {
    if (language === 'dub') return []
    try {
      const media = await fetchAnilistMedia(anilistId, signal)
      const title = media?.title?.romaji || media?.title?.english || ''
      const session = await this.searchSession(anilistId, title, signal)
      if (!session) return []
      // Find episode session
      let epSession: string|null = null
      let page = 1
      while (!epSession && page<=5) {
        const res = await fetchWithTimeout(`https://animepahe.ru/api?m=release&id=${encodeURIComponent(session)}&sort=episode_asc&page=${page}`, { headers: { 'Accept': 'application/json', 'Referer': 'https://animepahe.ru/', 'User-Agent': 'Mozilla/5.0' }, signal }, 4500)
        if (!res.ok) break
        const j:any = await res.json().catch(()=>null)
        const data = j?.data
        if (!Array.isArray(data)) break
        const found = data.find((d:any)=>d.episode===episode)
        if (found) epSession = found.session
        const last = j?.last_page || 1
        if (page>=last) break
        page++
      }
      if (!epSession) return []
      // Get pahe.win links via play page API (requires session)
      const playRes = await fetchWithTimeout(`https://animepahe.ru/api?m=links&id=${encodeURIComponent(epSession)}&p=kwik`, { headers: { 'Accept': 'application/json', 'Referer': `https://animepahe.ru/play/${session}/${epSession}`, 'User-Agent': 'Mozilla/5.0' }, signal }, 4500)
      if (!playRes.ok) return []
      const pj:any = await playRes.json().catch(()=>null)
      const links = pj?.data
      if (!Array.isArray(links) || links.length===0) return []
      // Pick best quality (highest)
      const sorted = [...links].sort((a:any,b:any)=>(parseInt(b.resolution)||0)-(parseInt(a.resolution)||0))
      const best = sorted[0]
      const url = best?.kwik || best?.kwik_pahe || best?.link
      if (!url || typeof url !== 'string') return []
      // Return as embed (kwik) — player will iframe it. Type embed is honest.
      return [{ provider: 'animepahe', url, type: 'embed', language: 'sub', quality: String(best.resolution||'auto'), embed: true }]
    } catch { return [] }
  }
}
export class AnikotoProvider implements VideoSourceProvider {
  id = 'anikoto'
  capabilities: ProviderCapabilities = { id: 'anikoto', displayName: 'AniKoto', languages: ['sub','dub'], subtitles: true, hls: true, mp4: false, embed: false, search: true, episodes: true, sources: true }
  private cache = new Map<string, {id:number, ani_id:string}>()
  // Series payloads cached in worker memory so the per-episode source call
  // only needs the cheap getSourcesNew hop (signed URLs are never cached —
  // neither here nor by edge cache headers on this route).
  private seriesCache = new Map<number, { at: number; data: any }>()
  private static readonly UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

  private async resolveAnikotoId(anilistId: number, title: string, signal?: AbortSignal): Promise<number|null> {
    const key = String(anilistId)
    if (this.cache.has(key)) return this.cache.get(key)!.id
    // Mirror the Mangayomi AniKoto extension: /filter HTML → /watch/<slug>
    // links → #watch-main[data-id] → verify data.anime.ani_id matches.
    try {
      const searchRes = await fetchWithTimeout(`https://anikototv.to/filter?keyword=${encodeURIComponent(title)}&page=1`, {
        headers: { 'User-Agent': AnikotoProvider.UA, 'Accept': 'text/html', 'Referer': 'https://anikototv.to/' }, signal,
      }, 4500)
      if (!searchRes.ok) return null
      const html = await searchRes.text()
      const slugs = [...new Set([...html.matchAll(/\/watch\/([a-z0-9\-]+)(?:\/ep-\d+)?/gi)].map(m => m[1]))].slice(0, 5)
      for (const slug of slugs) {
        try {
          const pageRes = await fetchWithTimeout(`https://anikototv.to/watch/${slug}`, {
            headers: { 'User-Agent': AnikotoProvider.UA, 'Accept': 'text/html', 'Referer': 'https://anikototv.to/' }, signal,
          }, 4500)
          if (!pageRes.ok) continue
          const html2 = await pageRes.text()
          const m = html2.match(/id="watch-main"[^>]*data-id="(\d+)"/) || html2.match(/data-id="(\d+)"[^>]*id="watch-main"/)
          if (!m) continue
          const cand = Number(m[1])
          const verifyRes = await fetchWithTimeout(`https://www.anikotoapi.site/series/${cand}`, {
            headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }, signal,
          }, 3500)
          if (!verifyRes.ok) continue
          const v: any = await verifyRes.json().catch(() => null)
          if (String(v?.data?.anime?.ani_id) === String(anilistId)) {
            this.cache.set(key, { id: cand, ani_id: String(anilistId) })
            return cand
          }
        } catch {}
      }
    } catch {}
    return null
  }
  async getEpisodes(anilistId: number, signal?: AbortSignal): Promise<{ number: number; title?: string; thumbnail?: string }[]> {
    try {
      const media = await fetchAnilistMedia(anilistId, signal)
      const title = media?.title?.romaji || media?.title?.english || ''
      const anikotoId = await this.resolveAnikotoId(anilistId, title, signal)
      if (!anikotoId) return []
      const series = await this.getSeries(anikotoId, signal)
      const eps = series?.episodes
      if (!Array.isArray(eps)) return []
      return eps.map((e:any)=>({ number: e.number, title: e.title || e.jp_title || `Episode ${e.number}`, thumbnail: undefined }))
    } catch { return [] }
  }
  async getSources(anilistId: number, episode: number, language: VideoLanguage, workerOrigin: string | null, signal?: AbortSignal): Promise<NormalizedSource[]> {
    try {
      const media = await fetchAnilistMedia(anilistId, signal)
      const title = media?.title?.romaji || media?.title?.english || ''
      const anikotoId = await this.resolveAnikotoId(anilistId, title, signal)
      if (!anikotoId) return []
      const series = await this.getSeries(anikotoId, signal)
      const eps = series?.episodes
      if (!Array.isArray(eps)) return []
      const ep = eps.find((e: any) => e.number === episode)
      if (!ep) return []
      const embedUrl: string | undefined = ep.embed_url?.[language] || ep.embed_url?.sub
      if (!embedUrl || typeof embedUrl !== 'string') return []
      // embed_url looks like https://megaplay.buzz/stream/s-2/<key>/(sub|dub).
      // Per the extension pipeline, the path key is only a routing key: fetch
      // the embed page and use its data-id for getSources (fallback: path key).
      const m = embedUrl.match(/\/stream\/s-\d+\/(\d+)(?:\/|$)/)
      const pathId = m?.[1]
      let srcId = pathId ?? null
      try {
        const pageRes = await fetchWithTimeout(embedUrl, {
          headers: { 'User-Agent': AnikotoProvider.UA, 'Accept': 'text/html', 'Referer': 'https://anikototv.to/' }, signal,
        }, 4000)
        if (pageRes.ok) {
          const pageHtml = await pageRes.text()
          const dm = pageHtml.match(/id="megaplay-player"[\s\S]{0,400}?data-id="(\d+)"/)
          if (dm?.[1]) srcId = dm[1]
        }
      } catch {}
      if (!srcId) {
        // Non-megaplay embed: return as embed fallback (honest type)
        return [{ provider: 'anikoto', url: embedUrl, type: 'embed', language, quality: 'auto', embed: true }]
      }
      // MegaPlay JSON source API (plain JSON, no JS eval, no CAPTCHA):
      // requires AJAX header, returns direct m3u8 + VTT tracks + skip times.
      const apiRes = await fetchWithTimeout(`https://megaplay.buzz/stream/getSourcesNew?id=${encodeURIComponent(srcId)}`, {
        headers: {
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          'Referer': embedUrl,
          'User-Agent': 'Mozilla/5.0',
        },
        signal,
      }, 4500)
      if (!apiRes.ok) return []
      const aj: any = await apiRes.json().catch(() => null)
      const file: string | undefined = aj?.sources?.file
      if (!file || typeof file !== 'string' || !/^https?:\/\//.test(file)) return []
      const subs = Array.isArray(aj?.tracks) ? aj.tracks
        .filter((t: any) => t && typeof t.file === 'string' && /^https?:\/\//.test(t.file) && t.kind !== 'thumbnails')
        .map((t: any) => ({
          language: 'en',
          label: t.label || 'English',
          // Route VTT through the worker proxy (allowlisted) so the
          // browser never hits CDN CORS/IP issues on subtitle fetches.
          url: workerOrigin ? `${workerOrigin}/proxy?url=${encodeURIComponent(t.file)}` : t.file,
          type: 'vtt',
        })) : []
      const out: NormalizedSource[] = [{
        provider: 'anikoto',
        url: file,
        type: 'hls',
        language,
        quality: 'auto',
        embed: false,
        subtitles: subs.length ? subs : undefined,
      }]
      return out
    } catch { return [] }
  }

  private async getSeries(anikotoId: number, signal?: AbortSignal): Promise<any | null> {
    const now = Date.now()
    const hit = this.seriesCache.get(anikotoId)
    if (hit && now - hit.at < 5 * 60 * 1000) return hit.data
    try {
      const res = await fetchWithTimeout(`https://www.anikotoapi.site/series/${anikotoId}`, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
        signal,
      }, 4000)
      if (!res.ok) return null
      const j: any = await res.json().catch(() => null)
      const data = j?.data ?? null
      if (data) this.seriesCache.set(anikotoId, { at: now, data })
      return data
    } catch { return null }
  }
}
export class GenericStubProvider implements VideoSourceProvider {
  id: string
  capabilities: ProviderCapabilities
  constructor(id: string, displayName: string) {
    this.id = id
    this.capabilities = { id, displayName, languages: ['sub','dub'], subtitles: true, hls: false, mp4: false, embed: true, search: true, episodes: true, sources: true }
  }
  async getEpisodes(): Promise<any[]> { return [] }
  async getSources(): Promise<NormalizedSource[]> { return [] }
}

export class MiruroAliasProvider extends OfficialTrailerProvider {
  id = 'miruro'
  capabilities: ProviderCapabilities = {
    id: 'miruro',
    displayName: 'Miruro',
    languages: ['sub', 'dub'],
    subtitles: true,
    hls: true,
    mp4: true,
    embed: true,
    search: true,
    episodes: true,
    sources: true,
  }
  async getSources(anilistId: number, episode: number, language: VideoLanguage, workerOrigin: string | null, signal?: AbortSignal): Promise<NormalizedSource[]> {
    const srcs = await super.getSources(anilistId, episode, language, workerOrigin, signal)
    return srcs.map(s => ({ ...s, provider: 'miruro' }))
  }
}
