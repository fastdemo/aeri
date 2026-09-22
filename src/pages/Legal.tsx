import { Link } from 'react-router-dom'

function H({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-2 mt-8 text-[16px] font-semibold tracking-tight text-[var(--text)] first:mt-4">{children}</h2>
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] leading-6 text-[var(--text-muted)]">{children}</p>
}

export function Legal() {
  return (
    <div className="mx-auto w-full max-w-[900px] px-4 py-6 sm:px-6 lg:px-12 lg:py-8">
      <h1 className="text-[22px] font-semibold tracking-tight text-[var(--text)]">Legal Information</h1>
      <p className="mt-1 text-[13px] text-[var(--text-faint)]">Factual information about how Aeri works. This is not legal advice.</p>

      <H>What Aeri is</H>
      <P>Aeri is an anime and manga discovery frontend. It provides browsing, personal list tracking, and playback/reading interfaces. It does not maintain an owned catalog of uploaded third-party anime or manga files.</P>

      <H>Where content comes from</H>
      <P>Metadata (titles, artwork, descriptions, relations) comes from AniList. Video sources and manga chapter pages are resolved from independent third-party providers. Those third-party services remain responsible for the content they serve; Aeri does not claim ownership of third-party copyrighted works.</P>

      <H>Request relaying</H>
      <P>Some media requests are relayed through Aeri's Cloudflare Worker infrastructure (for example, signed video stream URLs and manga page-image URLs). This means bytes may pass through Aeri-operated infrastructure for technical delivery reasons such as authentication signing, referer requirements, and content-type correction. Relaying a request does not transfer any ownership or rights.</P>

      <H>Copyright</H>
      <P>Aeri does not intentionally reproduce copyrighted material beyond what is technically required for its functionality (such as thumbnails, page images, and stream delivery for playback you request). Users should respect copyright law and applicable terms of service in their jurisdiction.</P>

      <H>No guarantees</H>
      <P>Nothing here should be read as a guarantee of legal compliance, immunity from claims, or protection under any specific law. Applicable law depends on your jurisdiction and how you use the service.</P>

      <H>Reporting issues</H>
      <P>If you believe content referenced by Aeri infringes your rights, or if you find a technical problem with attribution or linking, open an issue at the project's GitHub repository (linked in the footer) with the specific title, URL, and a description of the concern.</P>

      <div className="mt-8 flex gap-2">
        <Link to="/docs" className="rounded-full bg-[color-mix(in_srgb,var(--text)_10%,transparent)] px-5 py-2 text-xs font-medium text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--text)_15%,transparent)]">Docs</Link>
        <Link to="/" className="rounded-full bg-[var(--text)] px-5 py-2 text-xs font-semibold text-[var(--on-text)] hover:bg-[color-mix(in_srgb,var(--text)_90%,transparent)]">Home</Link>
      </div>
    </div>
  )
}
