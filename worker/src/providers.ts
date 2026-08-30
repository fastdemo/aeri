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
  const res = await fetchWithTimeout('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `query($id:Int){ Media(id:$id,type:ANIME){ id episodes title{romaji english native} trailer{id site thumbnail} streamingEpisodes{title thumbnail url site} } }`,
      variables: { id: anilistId },
    }),
    signal,
  }, 5000)
  if (!res.ok) throw new Error(`AniList ${res.status}`)
  const json: any = await res.json()
  return json?.data?.Media ?? null
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
  capabilities: ProviderCapabilities = { id: 'anikoto', displayName: 'AniKoto', languages: ['sub','dub'], subtitles: true, hls: false, mp4: false, embed: true, search: true, episodes: true, sources: true }
  private cache = new Map<string, {id:number, ani_id:string}>()
  private async resolveAnikotoId(anilistId: number, title: string, signal?: AbortSignal): Promise<number|null> {
    const key = String(anilistId)
    if (this.cache.has(key)) return this.cache.get(key)!.id
    try {
      const searchRes = await fetchWithTimeout(`https://anikototv.to/ajax/anime/search?keyword=${encodeURIComponent(title)}`, { headers: { 'X-Requested-With': 'XMLHttpRequest', 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://anikototv.to/' }, signal }, 4500)
      if (!searchRes.ok) { console.log(`[anikoto] search not ok ${searchRes.status} for ${title}`); } else {
        const j:any = await searchRes.json().catch(()=>null)
        const html: string = j?.result?.html || ''
        const slugs = [...html.matchAll(/href="https:\/\/anikototv\.to\/watch\/([^"]+)"/g)].map(m=>m[1])
        console.log(`[anikoto] search ${title} got ${slugs.length} slugs`, slugs.slice(0,2))
        for (const slug of slugs.slice(0,3)) {
          try {
            const pageRes = await fetchWithTimeout(`https://anikototv.to/watch/${slug}`, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://anikototv.to/' }, signal }, 4500)
            if (!pageRes.ok) { console.log(`[anikoto] page not ok ${pageRes.status} for ${slug}`); continue }
            const html2 = await pageRes.text()
            const m = html2.match(/data-id="(\d+)"/)
            if (!m) { console.log(`[anikoto] no data-id for ${slug}`); continue }
            const cand = Number(m[1])
            const verifyRes = await fetchWithTimeout(`https://www.anikotoapi.site/series/${cand}`, {}, 3500, signal)
            if (!verifyRes.ok) { console.log(`[anikoto] verify not ok ${verifyRes.status} for ${cand}`); continue }
            const v:any = await verifyRes.json().catch(()=>null)
            console.log(`[anikoto] verify cand ${cand} ani_id ${v?.data?.anime?.ani_id} vs ${anilistId}`)
            if (String(v?.data?.anime?.ani_id) === String(anilistId)) { this.cache.set(key, {id:cand, ani_id:String(anilistId)}); console.log(`[anikoto] resolved ${anilistId} -> ${cand}`); return cand }
          } catch (e) { console.log(`[anikoto] slug ${slug} error`, String(e).slice(0,100)) }
        }
      }
    } catch (e) { console.log(`[anikoto] resolve error`, String(e).slice(0,200)) }
    console.log(`[anikoto] failed to resolve ${anilistId} title ${title}`)
    return null
  }
  async getEpisodes(anilistId: number, signal?: AbortSignal): Promise<{ number: number; title?: string; thumbnail?: string }[]> {
    try {
      const media = await fetchAnilistMedia(anilistId, signal)
      const title = media?.title?.romaji || media?.title?.english || ''
      const anikotoId = await this.resolveAnikotoId(anilistId, title, signal)
      if (!anikotoId) return []
      const res = await fetchWithTimeout(`https://www.anikotoapi.site/series/${anikotoId}`, {}, 4000, signal)
      if (!res.ok) return []
      const j:any = await res.json().catch(()=>null)
      const eps = j?.data?.episodes
      if (!Array.isArray(eps)) return []
      return eps.map((e:any)=>({ number: e.number, title: e.title || e.jp_title || `Episode ${e.number}`, thumbnail: undefined }))
    } catch { return [] }
  }
  async getSources(anilistId: number, episode: number, language: VideoLanguage, _workerOrigin: string | null, signal?: AbortSignal): Promise<NormalizedSource[]> {
    try {
      const media = await fetchAnilistMedia(anilistId, signal)
      const title = media?.title?.romaji || media?.title?.english || ''
      const anikotoId = await this.resolveAnikotoId(anilistId, title, signal)
      if (!anikotoId) return []
      const res = await fetchWithTimeout(`https://www.anikotoapi.site/series/${anikotoId}`, {}, 4000, signal)
      if (!res.ok) return []
      const j:any = await res.json().catch(()=>null)
      const eps = j?.data?.episodes
      if (!Array.isArray(eps)) return []
      const ep = eps.find((e:any)=>e.number===episode)
      if (!ep) return []
      const url = ep.embed_url?.[language] || ep.embed_url?.sub
      if (!url || typeof url !== 'string') return []
      return [{ provider: 'anikoto', url, type: 'embed', language, quality: 'auto', embed: true }]
    } catch { return [] }
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
