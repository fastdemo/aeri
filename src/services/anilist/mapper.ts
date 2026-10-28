import type { Anime, AnimeListEntry, AnimeStatus } from '../../types/anime'

// AniList GraphQL types (partial)
export interface AniListTitle {
  romaji?: string | null
  english?: string | null
  native?: string | null
}

/** AniList staff edge (manga catalogue: authors/artists). Roles are
    free-text ("Story & Art", "Supervisor", ...); translators included. */
export interface AniListStaffEdge {
  role?: string | null
  node?: { name?: { full?: string | null } | null } | null
}

/** AniList tag with spoiler-aware rank (lower rank = more relevant). */
export interface AniListTag {
  name?: string | null
  rank?: number | null
}

export interface AniListMedia {
  id: number
  idMal?: number | null
  title: AniListTitle
  description?: string | null
  coverImage?: { large?: string | null; extraLarge?: string | null; medium?: string | null } | null
  bannerImage?: string | null
  startDate?: { year?: number | null; month?: number | null; day?: number | null } | null
  season?: string | null
  seasonYear?: number | null
  episodes?: number | null
  chapters?: number | null
  volumes?: number | null
  duration?: number | null
  status?: string | null // FINISHED, RELEASING, NOT_YET_RELEASED etc
  averageScore?: number | null // 0-100
  genres?: string[] | null
  studios?: { nodes?: { name: string; isAnimationStudio: boolean }[] | null; edges?: { isMain: boolean }[] | null } | null
  format?: string | null // TV, MOVIE etc; anime queries never return MANGA and vice versa
  type?: string | null // ANIME | MANGA — authoritative when present
  popularity?: number | null
  streamingEpisodes?: { title?: string | null; thumbnail?: string | null; url?: string | null; site?: string | null }[] | null
  trailer?: { id?: string | null; site?: string | null } | null
  /** Manga catalogue fields (staff/tags/endDate). Anime queries omit them;
      absent = unknown, never fabricated. */
  staff?: { edges?: AniListStaffEdge[] | null } | null
  tags?: AniListTag[] | null
  endDate?: { year?: number | null; month?: number | null; day?: number | null } | null
  nextAiringEpisode?: { airingAt: number; timeUntilAiring: number; episode: number } | null
  airingSchedule?: { nodes: { airingAt: number; episode: number }[] } | null
  isAdult?: boolean | null
  /** AniList relation edges (informational only — powers Related Entries, never identity). */
  relations?: AniListMediaRelations | null
}

export interface AniListRelationEdge {
  relationType?: string | null
  node?: {
    id?: number | null
    title?: AniListTitle | null
    format?: string | null
    status?: string | null
    episodes?: number | null
    chapters?: number | null
    volumes?: number | null
    coverImage?: { large?: string | null; extraLarge?: string | null; medium?: string | null } | null
    bannerImage?: string | null
  } | null
}

export interface AniListMediaRelations {
  edges?: AniListRelationEdge[] | null
}

export interface AniListMediaListEntryRaw {
  id: number // list entry id
  mediaId: number
  status?: string | null // CURRENT, COMPLETED, PLANNING, PAUSED, DROPPED, REPEATING
  progress?: number | null
  score?: number | null // raw float, in the USER's scoring format
  /** `score(format: POINT_10_DECIMAL)` alias — always a 0-10 scale. */
  score10?: number | null
  updatedAt?: number | null // unix seconds — drives most-recent-first sorting
  media?: AniListMedia | null
}

export function anilistStatusToAeri(status: string | null | undefined): AnimeStatus {
  switch (status) {
    case 'CURRENT':
    case 'REPEATING':
      return 'watching'
    case 'COMPLETED':
      return 'completed'
    case 'PLANNING':
      return 'planned'
    case 'PAUSED':
      return 'on_hold'
    case 'DROPPED':
      return 'dropped'
    default:
      return 'planned'
  }
}

export function aeriStatusToAnilist(status: AnimeStatus): string {
  switch (status) {
    case 'watching': return 'CURRENT'
    case 'completed': return 'COMPLETED'
    case 'planned': return 'PLANNING'
    case 'on_hold': return 'PAUSED'
    case 'dropped': return 'DROPPED'
    default: return 'CURRENT'
  }
}

function cleanDescription(html?: string | null): string {
  if (!html) return ''
  // AniList description is HTML with <br> and <i> etc. Strip tags for Aeri
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?i>/gi, '')
    .replace(/<\/?b>/gi, '')
    .replace(/<[^>]*>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .trim()
    .slice(0, 900)
}

export function mapAniListMediaToAnime(media: AniListMedia, mediaType?: 'ANIME' | 'MANGA'): Anime {
  const title = {
    romaji: media.title?.romaji ?? `Anime ${media.id}`,
    english: media.title?.english ?? undefined,
    native: media.title?.native ?? undefined,
  }
  const cover = media.coverImage?.extraLarge ?? media.coverImage?.large ?? media.coverImage?.medium ?? ''
  // Banner fallback to cover if missing — hero expects landscape
  const banner = media.bannerImage ?? cover

  const year = media.seasonYear ?? media.startDate?.year ?? undefined
  const season = media.season ?? undefined

  // averageScore is 0-100 integer, convert to 0-10 (one decimal of real
  // precision, e.g. 85 -> 8.5; display formats the decimals)
  const rating = media.averageScore != null ? media.averageScore / 10 : undefined

  // Only animation studios — not all studios (producers are not studios)
  const studios = (() => {
    const nodes = media.studios?.nodes ?? []
    const edges = media.studios?.edges ?? []
    // Prefer main animation studio if available, otherwise all animation studios
    const animNodes = nodes.filter(n => n.isAnimationStudio)
    if (animNodes.length > 0) {
      // If edges available, prefer isMain
      if (edges.length === nodes.length) {
        const mainIdx = edges.findIndex(e => e.isMain)
        if (mainIdx >= 0 && nodes[mainIdx]?.isAnimationStudio) {
          return [nodes[mainIdx].name].filter(Boolean) as string[]
        }
      }
      return animNodes.map(n => n.name).filter(Boolean) as string[]
    }
    // Fallback: if no animationStudio flag, return all (older data)
    return nodes.map(n => n.name).filter(Boolean) as string[]
  })()

  // Preserve original order/length for index-based episode normalization.
  // Do NOT filter by title/thumbnail — an entry with only url is still an episode slot,
  // filtering would compress the array and shift subsequent titles (Death Note bug).
  // Only discard truly empty entries (no title, no thumbnail, no url, no site).
  const streamingEpisodes = (() => {
    const raw = media.streamingEpisodes
    if (!raw || raw.length === 0) return undefined
    const mapped = raw
      .map(e => ({
        title: e.title?.trim() ? e.title.trim() : undefined,
        thumbnail: e.thumbnail?.trim() ? e.thumbnail.trim() : undefined,
        url: e.url ?? undefined,
        site: e.site ?? undefined,
      }))
      .filter(e => !!(e.title || e.thumbnail || e.url || e.site))
    return mapped.length ? mapped : undefined
  })()

  const nextAiringEpisode = media.nextAiringEpisode ? {
    airingAt: media.nextAiringEpisode.airingAt,
    timeUntilAiring: media.nextAiringEpisode.timeUntilAiring,
    episode: media.nextAiringEpisode.episode,
  } : undefined

  const airingSchedule = media.airingSchedule?.nodes?.map(n => ({
    airingAt: n.airingAt,
    episode: n.episode,
  })).filter(n => typeof n.airingAt === 'number' && typeof n.episode === 'number') ?? undefined

  // Identity boundary: AniList id alone is NOT sufficient — the same
  // numeric id under ANIME vs MANGA is a different entity (HxH anime vs
  // HxH manga). Callers pass the query's media type; the response's own
  // `type` field wins when present; format infers it otherwise
  // (MANGA/NOVEL/ONE_SHOT ⇒ MANGA, else ANIME).
  // Manga catalogue metadata: staff (creators first), tags by rank,
  // endDate. Absent when the query did not request them (anime surfaces)
  // — never fabricated. Translators and other long-tail roles are dropped:
  // catalogue shows creators, not full credits. Names AND roles both
  // trimmed: AniList roles carry volume ranges ("Story & Art (vols 1-41)")
  // that would overflow the sidebar row untrimmed.
  const staff = (() => {
    const edges = media.staff?.edges ?? []
    if (!edges.length) return undefined
    const clean = (s: string) => s.replace(/\s*\([^)]*\)\s*/g, '').trim()
    const creatorRe = /story|art|author|illustrat|supervisor|original/i
    const makers = edges
      .filter(e => e?.node?.name?.full && creatorRe.test(e?.role ?? ''))
      .map(e => ({ role: clean(e!.role ?? '') || null, name: e!.node!.name!.full!.trim() }))
      .filter(e => e.name)
    const seen = new Set(makers.map(m => m.name))
    const rest = edges
      .filter(e => e?.node?.name?.full && !seen.has(e.node.name.full.trim()))
      .slice(0, Math.max(0, 6 - makers.length))
      .map(e => ({ role: clean(e!.role ?? '') || null, name: e!.node!.name!.full!.trim() }))
      .filter(e => e.name)
    const all = [...makers, ...rest]
    return all.length ? all : undefined
  })()
  const tags = (() => {
    const list = (media.tags ?? [])
      .filter(t => t?.name)
      .map(t => ({ name: t!.name!, rank: t!.rank ?? null }))
      .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
      .slice(0, 12)
    return list.length ? list : undefined
  })()
  const endDate = media.endDate?.year ? { year: media.endDate.year, month: media.endDate.month ?? null, day: media.endDate.day ?? null } : undefined
  const responseType = (media.type ?? '').toUpperCase()
  const inferredType: 'ANIME' | 'MANGA' = responseType === 'ANIME' || responseType === 'MANGA' ? responseType
    : (mediaType ?? (
      ['MANGA', 'NOVEL', 'ONE_SHOT'].includes((media.format ?? '').toUpperCase()) ? 'MANGA' : 'ANIME'
    ))
  return {
    identity: {
      internalId: `anilist-${media.id}`,
      anilistId: media.id,
      malId: media.idMal ?? undefined,
      mediaType: inferredType,
    },
    title,
    description: cleanDescription(media.description),
    coverImage: cover,
    backdropImage: banner,
    bannerImage: banner,
    year,
    season,
    episodes: media.episodes ?? undefined,
    chapters: media.chapters ?? undefined,
    volumes: media.volumes ?? undefined,
    duration: media.duration ?? undefined,
    status: media.status ?? undefined,
    rating,
    ratings: rating != null ? { anilist: rating } : undefined,
    genres: media.genres ?? [],
    studios,
    staff,
    tags,
    endDate,
    format: media.format ?? undefined,
    popularity: media.popularity ?? undefined,
    streamingEpisodes,
    trailer: media.trailer?.id && media.trailer?.site ? { id: media.trailer.id, site: media.trailer.site } : undefined,
    nextAiringEpisode,
    airingSchedule,
    isAdult: media.isAdult ?? undefined,
    relations: media.relations ?? undefined,
  }
}

export function mapAniListEntryToAeri(entry: AniListMediaListEntryRaw): AnimeListEntry | null {
  if (!entry.media) return null
  const anime = mapAniListMediaToAnime(entry.media)
  const status = anilistStatusToAeri(entry.status)
  const progress = entry.progress ?? 0
  // Progress base is type-aware: chapters for manga, episodes for anime.
  // A manga entry with 0 chapters field but real progress still shows 50%.
  const total = anime.identity.mediaType === 'MANGA' ? (anime.chapters ?? 0) : (anime.episodes ?? 0)
  const percent = total > 0 ? Math.round((progress / total) * 100) : progress > 0 ? 50 : 0

  // attach progress to anime for continue watching UI
  anime.progress = { episode: progress, percent }
  anime.inList = true
  anime.listStatus = status

  // SCORE NORMALIZATION: the list query also asks for
  // `score(format: POINT_10_DECIMAL)` — a fixed 0-10 scale that is immune to
  // the account's scoring format. Prefer it, and keep the raw field as a
  // fallback: POINT_100 values (>10) divide down, POINT_5 stays on a 0-5
  // scale but is still a valid ordinal for Highest/Lowest tiers. 0 = unrated
  // on every format, so it never becomes a score.
  const rawScore = entry.score10 ?? entry.score
  let score: number | undefined = undefined
  if (rawScore != null && rawScore > 0) {
    score = rawScore > 10 ? Math.round((rawScore / 10) * 10) / 10 : rawScore
  }

  return {
    anime,
    status,
    progress,
    score,
    updatedAt: entry.updatedAt ?? undefined,
  }
}

// For hero/backdrop fallback, ensure at least one image
export function ensureAnimeImages(a: Anime): Anime {
  if (!a.backdropImage && a.coverImage) a.backdropImage = a.coverImage
  if (!a.coverImage && a.backdropImage) a.coverImage = a.backdropImage
  return a
}
