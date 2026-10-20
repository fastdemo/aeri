import { Link } from 'react-router-dom'

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-2 mt-8 text-[16px] font-semibold tracking-tight text-[var(--text)] first:mt-4">{children}</h2>
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] leading-6 text-[var(--text-muted)]">{children}</p>
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

export function Legal() {
  return (
    <div className="mx-auto w-full max-w-[900px] px-4 py-6 sm:px-6 lg:px-12 lg:py-8">
      <h1 className="text-[22px] font-semibold tracking-tight text-[var(--text)]">Legal</h1>
      <p className="mt-1 text-[13px] text-[var(--text-faint)]">How Aeri relates to copyright and content. Plain language, not legal advice.</p>

      <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
        <p className="text-[13px] leading-6 text-[var(--text-muted)]">
          <strong className="font-medium text-[var(--text)]">The short version:</strong> Aeri hosts nothing. It is a
          window — it displays public metadata about anime and manga, and plays or shows content streamed directly
          from independent third-party services. No copyrighted work is stored, uploaded, or redistributed by Aeri,
          and Aeri is not responsible for what those third parties make available.
        </p>
      </div>

      <H>What Aeri is</H>
      <P>
        Aeri is an anime and manga discovery frontend: browsing, personal list tracking, and playback/reading
        interfaces. It operates no catalog, accepts no uploads, and keeps no library of films, episodes, or chapters
        on its own infrastructure. There is nothing on Aeri's servers to download.
      </P>

      <H>Where everything comes from</H>
      <P>
        Metadata — titles, artwork links, descriptions, relations, scores — is displayed from AniList's public API to
        identify works, the same way a review or a catalogue references them. Video streams and manga chapter pages
        are hosted and delivered by independent third-party services. Aeri references those services and reads from
        them; it does not own, control, or republish what they serve.
      </P>

      <H>Why Aeri does not violate copyright law</H>
      <P>Copyright law is built around specific acts. Aeri's design avoids each of them:</P>
      <Lit items={[
        <><strong className="font-medium text-[var(--text)]">No reproduction.</strong> Aeri creates no copies of any work. Nothing is uploaded, mirrored, cached to disk, transcoded, or stored on Aeri's servers at any point.</>,
        <><strong className="font-medium text-[var(--text)]">No distribution.</strong> Aeri never sends you a media file. When you press Play or Read, your browser requests the content from the third-party service that publishes it — the bytes travel from that host to you, exactly like a browser loading a website you chose to visit.</>,
        <><strong className="font-medium text-[var(--text)]">Referencing, not republishing.</strong> Linking to publicly available content is not the same act as hosting or republishing it. Aeri labels every source it uses and never disguises where content comes from.</>,
        <><strong className="font-medium text-[var(--text)]">No protection circumvention.</strong> Aeri never breaks DRM, paywalls, or login walls, and never accesses anything that isn't already publicly reachable. If a service protects its content, Aeri simply can't see it.</>,
        <><strong className="font-medium text-[var(--text)]">No monetization of content.</strong> Aeri sells nothing, runs no ads, and charges no fee for playing or reading anything.</>,
        <><strong className="font-medium text-[var(--text)]">Factual metadata only.</strong> Titles, names, and artwork are used to identify the works themselves — standard referencing, kept current through a public database.</>,
      ]} />
      <P>
        In plain terms: the acts copyright law regulates — making copies, distributing them, and communicating works to
        the public — are done by the third-party services that host their own content, or not at all. Aeri contributes
        no work of its own to that chain; it is an interface. If any rights holder still disagrees about a specific
        reference, the maintainers remove it promptly on notice (see below) — no argument needed.
      </P>

      <H>Technical note: the delivery relay</H>
      <P>
        Some requests pass through Aeri's Cloudflare Worker for purely technical reasons — signing a URL for a
        provider that requires it, correcting a content type, or satisfying a referer requirement. The relay is a
        pass-through: it stores nothing, modifies nothing, and keeps no copy of any media. Relaying a request does not
        transfer ownership, rights, or responsibility over third-party content.
      </P>

      <H>Your responsibility</H>
      <P>
        You choose what to open. Respect the law where you live and the terms of the services you use — if a
        particular third-party service is not lawful in your jurisdiction, don't use it. Aeri is a neutral interface:
        it does not verify the licensing status of third-party catalogs and presents no content as its own.
      </P>

      <H>No affiliation</H>
      <P>
        Aeri is an independent, non-commercial project. It is not affiliated with, endorsed by, or sponsored by
        AniList, MyAnimeList, or any streaming, scanlation, or publishing service. All titles, names, and artwork
        belong to their respective owners and are used only to identify works.
      </P>

      <H>No responsibility, no guarantees</H>
      <P>
        Aeri and its maintainers are not responsible for anything that arises from using the app or the third-party
        services it references. The app is provided <em>as is</em>, with no warranties of any kind — express or
        implied — including availability, accuracy, fitness for a purpose, or that any source will work or remain
        lawful. To the fullest extent permitted by law, we accept no liability for third-party content
        (its availability, quality, legality, or safety), for anything that happens on external services, or for any
        direct, indirect, incidental, or consequential damages connected to using Aeri. You use Aeri at your own risk.
      </P>

      <H>Reporting &amp; takedown</H>
      <P>
        If you believe something referenced by Aeri infringes your rights, open an issue on the project's GitHub
        repository with the title and URL. Links are removed promptly — the project cooperates with rights holders
        first and asks questions later.
      </P>

      <H>Changes</H>
      <P>
        This page describes how the app works today and may be updated as Aeri evolves. Continuing to use Aeri means
        accepting the current version of this page.
      </P>

      <div className="mt-8 flex gap-2">
        <Link to="/" className="rounded-full bg-[var(--text)] px-5 py-2 text-xs font-semibold text-[var(--on-text)] hover:bg-[color-mix(in_srgb,var(--text)_90%,transparent)]">Home</Link>
      </div>
    </div>
  )
}
