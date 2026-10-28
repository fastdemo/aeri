import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useServiceStatus, type ServiceDownInfo, type ServiceKey } from '../../contexts/ServiceStatusContext'
import { useTracking } from '../../contexts/TrackingContext'

const SERVICE_LABEL: Record<ServiceKey, string> = {
  anilist: 'AniList',
  mal: 'MyAnimeList',
}

/** Full-surface replacement for a page the currently-down service powers
 *  (D112). Deliberately plain: wordmark, one honest line, one button.
 *  No spinners, no countdowns, no promotions of broken content.
 *  Secondary link: signed-in → Settings (diagnostics live there);
 *  signed-out → Docs (Settings requires an account and would bounce the
 *  visitor right back here). */
export function ServiceDown({ down }: { down: ServiceDownInfo }) {
  const { recheckNow } = useServiceStatus()
  const { isAuthenticated } = useTracking()
  const [checking, setChecking] = useState(false)

  // The probe can take up to its 8s network timeout; show a truthful
  // "checking" state bounded by that window (the gate lifts on its own the
  // moment the context clears the service).
  useEffect(() => {
    if (!checking) return
    const t = setTimeout(() => setChecking(false), 8500)
    return () => clearTimeout(t)
  }, [checking])

  const service = SERVICE_LABEL[down.service]
  const recheck = () => {
    if (checking) return
    setChecking(true)
    recheckNow(down.service)
  }

  return (
    <section
      role="status"
      aria-live="polite"
      className="mx-auto flex min-h-[70vh] w-full max-w-xl flex-col items-center justify-center px-6 py-16 text-center"
    >
      <p className="text-[13px] font-semibold tracking-[0.18em] text-[var(--text-muted)]">aeri</p>

      <h1 className="mt-8 text-[1.7rem] font-semibold leading-snug tracking-tight text-[var(--text)]">
        {service} is down right now
      </h1>

      <p className="mt-4 max-w-[420px] text-[13px] leading-relaxed text-[var(--text-muted)]">
        {down.reason
          ? `${down.reason} It's not your connection and not a problem on Aeri's end.`
          : `It's not your connection, and it's not Aeri — ${service} is offline right now. Aeri reconnects on its own the moment it's back.`}
      </p>

      <div className="mt-8 flex items-center gap-2.5">
        <button
          type="button"
          onClick={recheck}
          className="rounded-md border border-[var(--border)] px-3.5 py-1.5 text-xs font-medium text-[var(--text)] transition-colors hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        >
          {checking ? 'Checking…' : 'Reconnect now'}
        </button>
        {isAuthenticated ? (
          <Link
            to="/settings"
            className="rounded-md px-2.5 py-1.5 text-xs font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            Open Settings
          </Link>
        ) : (
          <Link
            to="/docs"
            className="rounded-md px-2.5 py-1.5 text-xs font-medium text-[var(--text-muted)] transition-colors hover:text-[var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
          >
            Learn more
          </Link>
        )}
      </div>

      <p className="mt-6 text-[11px] text-[var(--text-faint)]">
        {checking
          ? `Asking ${service} again...`
          : 'Your list, progress and settings are kept on this device — nothing was lost.'}
      </p>

      <div className="mt-12 flex items-center gap-4" aria-hidden>
        <ServiceDot service="anilist" status={down.service} />
        <ServiceDot service="mal" status={down.service} />
      </div>
    </section>
  )
}

function ServiceDot({ service, status }: { service: ServiceKey; status: ServiceDownInfo['service'] }) {
  const isDown = service === status
  return (
    <span className="flex items-center gap-1.5 text-[10px] font-medium tracking-wide text-[var(--text-faint)]">
      <span
        className="inline-block h-[6px] w-[6px] rounded-full"
        style={{ background: isDown ? 'var(--accent)' : 'rgba(52, 211, 153, 0.45)' }}
      />
      {service === 'anilist' ? 'AniList' : 'MyAnimeList'}
    </span>
  )
}
