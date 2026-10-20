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
function Lit({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="mt-1 space-y-1.5 text-[13px] leading-6 text-[var(--text-muted)]">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2">
          <span aria-hidden className="mt-[9px] h-1 w-1 shrink-0 rounded-full bg-[var(--text-faint)]" />
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ul>
  )
}
function Lead({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
      <p className="text-[13px] leading-6 text-[var(--text-muted)]">{children}</p>
    </div>
  )
}

export function Docs() {
  return (
    <div className="mx-auto w-full max-w-[900px] px-4 py-6 sm:px-6 lg:px-12 lg:py-8">
      <h1 className="text-[22px] font-semibold tracking-tight text-[var(--text)]">Docs</h1>
      <p className="mt-1 text-[13px] text-[var(--text-faint)]">A friendly guide for viewers — plus everything a developer needs to run, test, and ship it.</p>

      <Lead>
        Aeri is an anime &amp; manga discovery frontend: a calm place to browse what's out there, keep a personal list,
        and watch or read through it. Metadata comes from AniList; playback and reading use independent third-party
        sources. There's no catalog of uploaded files anywhere in Aeri — it's a window, not a warehouse.
      </Lead>

      <H>Getting started — your first five minutes</H>
      <Lit items={[
        <><strong className="font-medium text-[var(--text)]">Browse freely.</strong> No account is needed to explore Home, search, <Code>/anime</Code>, and <Code>/manga</Code>.</>,
        <><strong className="font-medium text-[var(--text)]">Preview a title.</strong> Hover a card and the play/read button plus a ⋮ menu appear; click (or tap, on a phone) anywhere else on the card to open its full preview card.</>,
        <><strong className="font-medium text-[var(--text)]">Play or read.</strong> Play starts your next unwatched episode; Read opens your next unread chapter. The preview card's episode/chapter lists also let you jump anywhere.</>,
        <><strong className="font-medium text-[var(--text)]">Track it (optional).</strong> Connect AniList and/or MyAnimeList in Settings to keep progress, statuses, and scores — Aeri syncs them for you.</>,
        <><strong className="font-medium text-[var(--text)]">Pick up where you left off.</strong> Continue Watching on Home always points at the exact next episode.</>,
      ]} />
      <P>
        One thing to know up front: on phones, hover doesn't exist, so card controls stay hidden by design — tapping a
        card opens its preview, and Play / Read live right there inside it.
      </P>

      <H>Finding anime &amp; manga</H>
      <P>
        <Code>/anime</Code> and <Code>/manga</Code> share the same layout: category pills (Popular, Trending, Airing,
        Upcoming, Finished…) plus dropdown filters for Genre, Year, Season, and Format, with a Clear button whenever
        something is active. Search covers anime, manga, and OVAs with suggestions as you type. Every AniList entry is
        its own page — seasons are <em>separate entries</em> ("Season 2" never hides inside "Season 1").
      </P>

      <H>The preview card</H>
      <P>
        Clicking a card opens the preview as a layer over the page you were on — close it with ✕, Esc, or by clicking
        outside, and you're exactly where you were. Inside you'll find the description, a metadata sidebar
        (genres / format / status / year / season), your tracker controls (status pill, score, +1 progress buttons),
        the full episode or chapter list, and Related entries — clicking a related title swaps the card in place,
        keeping your history smooth.
      </P>

      <H>Watching</H>
      <Lit items={[
        <>Play always targets the <strong className="font-medium text-[var(--text)]">next</strong> episode for your progress — never the one you finished.</>,
        <>The episode list sorts newest- or oldest-first with the small ⇅ button.</>,
        <>An episode counts as watched at 80% (or at the end) — just opening the player never marks anything.</>,
        <>Sources are resolved on the fly from the provider you've prioritized in Settings. If a source is down you get an honest error — Aeri never pretends with a fake player.</>,
      ]} />

      <H>Reading manga</H>
      <Lit items={[
        <>Chapter lists run oldest-first by default, toggleable to newest-first.</>,
        <>The reader scrolls vertically and remembers chapter + page — reopening a title resumes where you stopped.</>,
        <>A chapter counts as read when you reach 80% of its pages; progress saves are quiet and instant.</>,
        <>If one source lags, enable another in Settings → Providers (MangaDex, Weeb Central, and MangaPill are supported).</>,
      ]} />

      <H>Your list &amp; tracking</H>
      <P>
        Connect AniList and/or MyAnimeList in Settings — both are optional, and one of them receives your writes
        (never both, so nothing double-writes). Per-field toggles let you choose exactly what syncs — status,
        episodes watched, and score — and changes you make elsewhere are picked up when you return to the tab. The My List page shows
        everything you track with the same filters as browse, plus status pills — All, Plan to Watch, Watching,
        Completed, On Hold, Dropped — in AniList/MAL's common status language.
      </P>

      <H>Tips &amp; troubleshooting</H>
      <Lit items={[
        <><strong className="font-medium text-[var(--text)]">"No playable source"</strong> — try another episode or retry; some titles have upstream gaps.</>,
        <><strong className="font-medium text-[var(--text)]">"Couldn't load chapters"</strong> — open Settings → Providers and make sure a manga source is enabled, or retry later.</>,
        <><strong className="font-medium text-[var(--text)]">A title looks bare</strong> — AniList may be briefly rate-limiting; cached content is served and fresh details arrive shortly.</>,
        <><strong className="font-medium text-[var(--text)]">Stale list after editing on another device</strong> — focus the Aeri tab; it re-syncs within a minute.</>,
      ]} />

      <H>For developers</H>
      <P>
        <strong className="font-medium text-[var(--text)]">Stack.</strong> Vite + React 19 + TypeScript (strict) +
        Tailwind v4, deployed as a static bundle served by a Cloudflare Worker that also exposes <Code>/api/*</Code>.
        Routing is BrowserRouter path URLs (legacy <Code>#/</Code> links normalize on load); preview cards are overlay
        routes — <Code>/anime/:id</Code> and <Code>/manga/:id</Code> render over the page beneath, so deep links and
        full-card UX coexist. State is React context + hooks with a storage abstraction over localStorage (tokens,
        preferences) and IndexedDB (progress, caches). No server sessions, no database.
      </P>
      <P>
        <strong className="font-medium text-[var(--text)]">Data layer.</strong> AniList GraphQL is called directly from
        the browser with type-scoped cache keys (<Code>anilist:media:ANIME|MANGA:id</Code>), a memory + IndexedDB
        (24h) cache, in-flight deduplication, and a shared rate-limit cooldown that serves stale data instead of
        failing. MAL runs through PKCE OAuth via the Worker's token proxy (anime and manga lists, same
        <Code>my_list_status</Code> writes). Video: a provider registry resolves episodes → sources, then the
        Worker signs a relay URL and hls.js (Chromium) or native HLS (Safari) plays it. Manga: MangaDex (primary) +
        Weeb Central + MangaPill resolve chapters → page images through the signed <Code>/api/manga/img</Code> relay.
      </P>
      <P>
        <strong className="font-medium text-[var(--text)]">Build, test, deploy.</strong> Source the env first, then
        build (<Code>set -a; source .env; set +a; npm run build</Code>), deploy the Worker
        (<Code>npx wrangler deploy --env production</Code>), and verify the live bundle
        (<Code>npm run verify:live</Code>). Tests: <Code>tsc --noEmit</Code> plus Playwright browser passes against
        real bundles (final production verification is done in an actual browser, not by HTTP status codes).
      </P>

      <div className="mt-8 flex gap-2">
        <Link to="/" className="rounded-full bg-[var(--text)] px-5 py-2 text-xs font-semibold text-[var(--on-text)] hover:bg-[color-mix(in_srgb,var(--text)_90%,transparent)]">Home</Link>
      </div>
    </div>
  )
}
