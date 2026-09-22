import { Link } from 'react-router-dom'

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-2 mt-8 text-[16px] font-semibold tracking-tight text-[var(--text)] first:mt-4">{children}</h2>
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] leading-6 text-[var(--text-muted)]">{children}</p>
}
function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-[color-mix(in_srgb,var(--text)_8%,transparent)] px-1.5 py-0.5 font-mono text-[12px] text-[var(--text)]">{children}</code>
}

export function Docs() {
  return (
    <div className="mx-auto w-full max-w-[900px] px-4 py-6 sm:px-6 lg:px-12 lg:py-8">
      <h1 className="text-[22px] font-semibold tracking-tight text-[var(--text)]">Aeri Docs</h1>
      <p className="mt-1 text-[13px] text-[var(--text-faint)]">What Aeri is, how it works, and how to fix common issues.</p>

      <H>What Aeri is</H>
      <P>Aeri is an anime and manga discovery frontend: browse what's popular, keep a personal list, track episode/chapter progress, watch via resolved third-party sources, and read manga chapter pages. There is no owned catalog of uploaded files — Aeri resolves public metadata (AniList) and external sources, relaying some media requests through its Worker.</P>

      <H>How the site works</H>
      <P>Home rails (Trending, Popular, Airing, themed picks) → detail pages/modals → Watch (<Code>#/watch/:id/:episode</Code>) or Reader (<Code>#/read/:id/:chapter</Code>). Progress persists locally (IndexedDB) and syncs to your tracker. Every AniList media ID is an independent entity — no season grouping.</P>

      <H>Anime discovery</H>
      <P>Browse (<Code>#/anime</Code>) filters by category, genre, year, season, and format. Search covers anime, manga, and OVAs with grouped suggestions. Detail pages show episodes (with per-field title/thumbnail states), Related Anime, and tracking controls.</P>

      <H>Manga discovery</H>
      <P>Manga lives at <Code>#/manga</Code> with the same category/filter pattern. Detail modals show chapters (units, oldest-first default, ↑/↓ toggle) plus Related Manga. The reader is vertical-continuous with chapter+page resume.</P>

      <H>Tracking</H>
      <P>An episode counts as watched at 80% watched (or video end); a chapter counts as read at 80% of pages reached. Opening alone never marks anything. The preview card's compact tracker (status pill → expands to status + score) updates immediately via the same contexts — no reload.</P>

      <H>AniList integration</H>
      <P>OAuth sign-in; AniList is the metadata backbone (titles, art, relations, scores). Mutations use <Code>SaveMediaListEntry</Code> (status, progress, score). External changes sync on app start, window focus, reconnect, and visibility return (60s cooldown) — AniList offers no webhooks.</P>

      <H>MAL integration</H>
      <P>MyAnimeList connects via PKCE (plain) OAuth through the Worker token proxy (browsers can't reach MAL directly from static hosting). Anime list read/writes go through <Code>/anime/…/my_list_status</Code>. Manga list endpoints are not yet wired — manga progress currently syncs to AniList only. Same pull-sync triggers as AniList.</P>

      <H>Streaming architecture</H>
      <P>Providers resolve episodes → sources (aniwave-first registry) → the Worker verifies and signs a relay URL → hls.js (Chromium) or native HLS (Safari) plays it. Only verified providers appear in Settings. Failures are fail-closed with honest empty states.</P>

      <H>Manga reader architecture</H>
      <P>MangaDex (primary) + WeebCentral + MangaPill resolve matches → chapters → page URLs. Page images load through the signed <Code>/api/manga/img</Code> relay (per-host Referer, byte-sniffed content type). Progress = chapter + page in IndexedDB; resume restores scroll position.</P>

      <H>Providers</H>
      <P>Settings lists only verified providers (video + manga separately, reorderable, toggleable). Disabled providers are never requested. New candidates are exposed only after end-to-end verification: match → enumerate → resolve → real bytes.</P>

      <H>Caching</H>
      <P>Memory (minutes) + IndexedDB (24h) + in-flight dedup + a shared rate-limit cooldown. Keys are type-scoped (<Code>anilist:media:ANIME|MANGA:id</Code>) so anime and manga never collide. Throttled responses serve stale data rather than failing.</P>

      <H>Account connections</H>
      <P>Connect AniList and/or MAL in Settings; pick one active tracker. Writes go to the active tracker only (never fan-out). Per-field sync toggles (status/progress/score) gate each write. Disconnecting the last account returns to Home.</P>

      <H>Privacy & security</H>
      <P>Tokens live in localStorage; watch/read positions and caches in IndexedDB — all in your browser. Media requests may pass through the Aeri Worker relay (see Legal). No analytics, no ads. Secrets (client secrets) live only in Worker env, never in the bundle.</P>

      <H>Troubleshooting</H>
      <P>“Couldn't load chapters” → check Settings → Providers (enable one) or retry (upstream scanlation gaps happen). No playable source → try another episode/source; most video needs the backend proxy. Stale list after external changes → focus the tab (pull-sync runs within 60s) or use My List refresh. AniList busy → cached content is served; wait and retry.</P>

      <H>Development</H>
      <P>Vite + React + TypeScript + Tailwind, HashRouter, Cloudflare Worker serves <Code>dist/</Code> + <Code>/api/*</Code>. Build with env sourced (<Code>set -a; source .env</Code>), verify with <Code>npm run verify:live</Code>, deploy with <Code>wrangler deploy --env production</Code>. Tests: typecheck, provider matrix, Playwright E2E.</P>

      <div className="mt-8 flex gap-2">
        <Link to="/legal" className="rounded-full bg-[color-mix(in_srgb,var(--text)_10%,transparent)] px-5 py-2 text-xs font-medium text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--text)_15%,transparent)]">Legal</Link>
        <Link to="/" className="rounded-full bg-[var(--text)] px-5 py-2 text-xs font-semibold text-[var(--on-text)] hover:bg-[color-mix(in_srgb,var(--text)_90%,transparent)]">Home</Link>
      </div>
    </div>
  )
}
