/**
 * MangaHere manga resolution + chapter/page extraction (Worker-side).
 *
 * Verified 2026-09-27 (direct probes):
 * - Search: GET /search?title=<q> (plain HTML), series links `/manga/<slug>/`.
 * - Series page: /manga/<slug>/, chapter links `/manga/<slug>/c<N>/1.html`
 *   (chapter list may be paged/JS-driven — per-chapter links verified).
 * - Chapter pages: packed-JS `newImgs` array (Dean Edwards packer) decoding
 *   to zjcdn.mangahere.org JPEGs (verified 200, 221KB).
 * - Images accept Referer: https://www.mangahere.cc/ (relayed via the
 *   signed /api/manga/img relay — suffix allowlist extended).
 *
 * Security: public HTML only. No auth/CAPTCHA/DRM bypass.
 */

import type { ProviderHint } from './providers'

const MH_BASE = 'https://www.mangahere.cc'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

export interface MhChapter {
  providerChapterId: string
  label: string
  number: number | null
  kind?: string
  unitType?: 'volume' | 'chapter'
}

export interface MhMatch {
  providerMangaId: string
  providerTitle: string
}

async function mhFetch(path: string, init: RequestInit = {}, timeoutMs = 12000, signal?: AbortSignal): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  if (signal) {
    if (signal.aborted) ctrl.abort((signal as any).reason)
    else signal.addEventListener('abort', () => ctrl.abort((signal as any).reason), { once: true })
  }
  try {
    return await fetch(`${MH_BASE}${path}`, {
      ...init,
      headers: { 'User-Agent': UA, Accept: 'text/html,*/*', Referer: `${MH_BASE}/`, ...(init.headers || {}) },
      signal: ctrl.signal,
    })
  } finally {
    clearTimeout(t)
  }
}

function normalizeTitle(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function titleScore(name: string, variants: string[]): number {
  const n = normalizeTitle(name)
  if (!n) return 0
  let best = 0
  for (const raw of variants) {
    const v = normalizeTitle(raw)
    if (!v) continue
    if (v === n) return 100
    if (v.startsWith(n) || n.startsWith(v)) best = Math.max(best, 60)
    else if (v.includes(n) || n.includes(v)) best = Math.max(best, 40)
  }
  return best
}

const MH_MATCH_THRESHOLD = 40

interface MhCandidate { slug: string; title: string }

function parseSearchResults(html: string): MhCandidate[] {
  const out: MhCandidate[] = []
  const seen = new Set<string>()
  const re = /<a[^>]*href="\/manga\/([a-z0-9_-]+)\/"[^>]*>([\s\S]{0,400}?)<\/a\s*>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null && out.length < 20) {
    const slug = m[1]
    if (seen.has(slug)) continue
    seen.add(slug)
    const inner = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    out.push({ slug, title: inner.slice(0, 80) || slug.replace(/-/g, ' ') })
  }
  return out
}

export async function mhSearchAndMatch(hint: ProviderHint | undefined, signal?: AbortSignal): Promise<MhMatch> {
  const variants = [hint?.english, hint?.title, hint?.native].map(s => (s || '').trim()).filter(Boolean) as string[]
  if (!variants.length) throw new Error('no title hints for manga match')
  const pooled = new Map<string, MhCandidate>()
  for (const q of variants.slice(0, 3)) {
    try {
      const res = await mhFetch(`/search?title=${encodeURIComponent(q)}`, {}, 12000, signal)
      if (!res.ok) continue
      const html = await res.text()
      for (const c of parseSearchResults(html)) {
        if (!pooled.has(c.slug)) pooled.set(c.slug, c)
      }
    } catch { /* next query */ }
  }
  if (!pooled.size) throw new Error('no search results')
  const ranked = [...pooled.values()]
    .map(c => ({ c, s: Math.max(titleScore(c.title, variants), titleScore(c.slug.replace(/-/g, ' '), variants)) }))
    .sort((a, b) => b.s - a.s)
  const top = ranked[0]
  if (!top || top.s < MH_MATCH_THRESHOLD) throw new Error('no confident match')
  const tied = ranked.filter(r => r.s === top.s && r.c.slug !== top.c.slug)
  if (tied.length) throw new Error('ambiguous match')
  return { providerMangaId: top.c.slug, providerTitle: top.c.title }
}

/** Unpack Dean Edwards packed JS: eval(function(p,a,c,k,e,d){...}) → decoded source. */
function unpackPackedJs(packed: string): string | null {
  try {
    // Standard packer call shape: }('payload',radix,count,'symtab'.split('|'),0,{})
    const callStart = packed.indexOf('}(')
    if (callStart < 0) return null
    const args = packed.slice(callStart + 2)
    const strM = /^'((?:[^'\\]|\\.)*)',\s*(\d+)\s*,\s*(\d+)\s*,\s*'((?:[^'\\]|\\.)*)'\.split\('\|'\)/.exec(args.trim())
    if (!strM) return null
    const payload = strM[1].replace(/\\'/g, "'").replace(/\\\\/g, '\\')
    const radix = parseInt(strM[2], 10)
    const symtab = strM[4].split('|')
    if (radix < 2 || radix > 62 || !symtab.length) return null
    // Radix can exceed 36 (62 = 0-9a-zA-Z) — mirror the packer's own alphabet.
    const digits = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'.slice(0, radix)
    const word = (n: number): string => {
      let s = ''
      let x = n
      do { s = digits[x % radix] + s; x = Math.floor(x / radix) } while (x > 0)
      return s
    }
    const dict: Record<string, string> = {}
    for (let i = symtab.length - 1; i >= 0; i--) {
      const k = word(i)
      if (k && symtab[i]) dict[k] = symtab[i]
    }
    return payload.replace(/\b\w+\b/g, w => dict[w] ?? w)
  } catch { return null }
}

function parseChapterList(html: string, slug: string): MhChapter[] {
  const out: MhChapter[] = []
  const seen = new Set<string>()
  // /manga/<slug>/c001/1.html style links
  const re = /<a[^>]*href="\/manga\/[a-z0-9_-]+\/(c\d+[a-z]?(?:\/\d+\.html)?)"[^>]*>([\s\S]{0,300}?)<\/a\s*>/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) !== null) {
    const cid = m[1].replace(/\/1\.html$/, '')
    if (seen.has(cid)) continue
    seen.add(cid)
    const numM = /c(\d+)/i.exec(cid)
    out.push({
      providerChapterId: `${slug}::${cid}`,
      label: numM ? `Chapter ${Number(numM[1])}` : cid,
      number: numM ? Number(numM[1]) : null,
      kind: 'Chapter',
      unitType: 'chapter',
    })
  }
  // Fallback: chapterid/imagecount signals (single-chapter series page)
  if (!out.length) {
    const cm = /chapterid\s*=\s*(\d+)/i.exec(html)
    if (cm) {
      out.push({ providerChapterId: `${slug}::c001`, label: 'Chapter 1', number: 1, kind: 'Chapter', unitType: 'chapter' })
    }
  }
  return out
}

const mhMatchCache = new Map<string, { at: number; m: MhMatch }>()
const mhChaptersCache = new Map<string, { at: number; list: MhChapter[] }>()

export async function mhGetChapters(providerMangaId: string, signal?: AbortSignal): Promise<MhChapter[]> {
  const key = `mh-ch:${providerMangaId}`
  const hit = mhChaptersCache.get(key)
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.list
  const res = await mhFetch(`/manga/${providerMangaId}/`, {}, 15000, signal)
  if (!res.ok) throw new Error(`chapter list ${res.status}`)
  const html = await res.text()
  const list = parseChapterList(html, providerMangaId)
  if (!list.length) throw new Error('empty chapter list')
  mhChaptersCache.set(key, { at: Date.now(), list })
  if (mhChaptersCache.size > 200) {
    const oldest = mhChaptersCache.keys().next().value as string | undefined
    if (oldest !== undefined) mhChaptersCache.delete(oldest)
  }
  return list
}

export async function mhGetPages(providerChapterId: string, signal?: AbortSignal): Promise<string[]> {
  const [slug, cid] = providerChapterId.split('::')
  if (!slug || !cid) throw new Error('bad chapter id')
  const res = await mhFetch(`/manga/${slug}/${cid}/1.html`, {}, 15000, signal)
  if (!res.ok) throw new Error(`pages ${res.status}`)
  const html = await res.text()
  // Primary: packed-JS newImgs array. The eval statement runs to
  // </script> (the packed payload itself is ~6KB — a bounded {0,4000}
  // regex stops inside the decoder, not the payload). Slice from the
  // eval start to the closing script tag instead.
  const evalStart = html.indexOf('eval(function(p,a,c,k,e,d)')
  if (evalStart >= 0) {
    const scriptEnd = html.indexOf('</script>', evalStart)
    const packed = scriptEnd >= 0 ? html.slice(evalStart, scriptEnd) : html.slice(evalStart, evalStart + 20000)
    const decoded = unpackPackedJs(packed)
    if (decoded) {
      const urls = [...new Set([...decoded.matchAll(/['"]?(\/\/[a-z0-9.-]+\/[^\s'"]+?\.(?:jpe?g|png|webp))[^\s'"]*/gi)].map(m => 'https:' + m[1]))]
        .filter(u => /\.(jpe?g|png|webp)(\?|$)/i.test(u))
      if (urls.length) return urls
    }
  }
  // Fallback: direct <img> tags
  const urls = [...new Set(
    [...html.matchAll(/<img[^>]+src="(https?:\/\/[^"]+?\.(?:jpe?g|png|webp))[^"]*"/gi)].map(m => m[1]),
  )]
  if (!urls.length) throw new Error('empty page list')
  return urls
}

export function mhMatchCached(key: string): MhMatch | null {
  const hit = mhMatchCache.get(key)
  if (hit && Date.now() - hit.at < 60 * 60 * 1000) return hit.m
  return null
}

export function mhMatchStore(key: string, m: MhMatch) {
  mhMatchCache.set(key, { at: Date.now(), m })
  if (mhMatchCache.size > 500) {
    const oldest = mhMatchCache.keys().next().value as string | undefined
    if (oldest !== undefined) mhMatchCache.delete(oldest)
  }
}
