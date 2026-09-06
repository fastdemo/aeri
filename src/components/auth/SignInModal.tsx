import { useEffect } from 'react'
import { useAniList } from '../../contexts/AniListContext'
import { useMAL } from '../../contexts/MALContext'
import { useTracking } from '../../contexts/TrackingContext'
import { ProviderIcon } from './ProviderIcon'
import type { TrackingProviderId } from '../../storage/preferences'

// Sign-in entry point: both providers as selectable rows. Either or both may
// connect; the connected rows double as the tracker radio (selected row gets
// the white border). No separate picker section, no all-caps badges.
export function SignInModal({ onClose }: { onClose: () => void }) {
  const ani = useAniList()
  const mal = useMAL()
  const { trackingProvider, setTrackingProvider } = useTracking()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const rows: {
    id: TrackingProviderId
    title: string
    desc: string
    connected: boolean
    connectLabel: string
    onConnect: () => void
    onDisconnect: () => void
  }[] = [
    {
      id: 'anilist',
      title: 'AniList',
      desc: ani.isAuthenticated
        ? (ani.user ? `Connected as ${ani.user.name}` : ani.loadingUser ? 'Connecting…' : 'Connected')
        : 'List tracking + rich metadata',
      connected: ani.isAuthenticated,
      connectLabel: 'Connect',
      onConnect: () => { try { ani.login() } catch {} },
      onDisconnect: () => ani.logout(),
    },
    {
      id: 'mal',
      title: 'MyAnimeList',
      desc: mal.isAuthenticated
        ? (mal.user ? `Connected as ${mal.user.name}` : mal.loadingUser ? 'Connecting…' : 'Connected')
        : 'List tracking via built-in server',
      connected: mal.isAuthenticated,
      connectLabel: 'Connect',
      onConnect: () => { mal.login().catch(() => {}) },
      onDisconnect: () => mal.logout(),
    },
  ]
  const anyConnected = rows.some((r) => r.connected)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Sign in"
      className="fixed inset-0 z-[70] grid place-items-center bg-black/75 p-4 backdrop-blur-[2px] anim-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[380px] rounded-xl border border-white/10 bg-[#141416] p-5 shadow-2xl anim-pop-in-center"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">Sign in</h2>
            <p className="mt-1 text-xs text-white/50">Connect either or both. Select one to track your list.</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close sign in"
            className="grid h-8 w-8 place-items-center rounded-full text-white/60 hover:bg-white/10 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 space-y-2" role={anyConnected ? 'radiogroup' : undefined} aria-label={anyConnected ? 'Accounts — select one to track your list' : undefined}>
          {rows.map((r) => {
            const selected = anyConnected && trackingProvider === r.id
            return (
              <div
                key={r.id}
                className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 transition ${
                  selected ? 'border-white bg-white/[0.04]' : 'border-white/10 bg-white/[0.02]'
                }`}
              >
                {r.connected && (
                  <button
                    role="radio"
                    aria-checked={selected}
                    aria-label={`Track with ${r.title}`}
                    title={`Track with ${r.title}`}
                    onClick={() => setTrackingProvider(r.id)}
                    className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${selected ? 'border-white' : 'border-white/30 hover:border-white/60'}`}
                  >
                    {selected && <span className="h-2 w-2 rounded-full bg-white" />}
                  </button>
                )}
                <ProviderIcon provider={r.id} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-white">{r.title}</p>
                  <p className="truncate text-[11px] text-white/50">{r.desc}</p>
                </div>
                {r.connected ? (
                  <button onClick={r.onDisconnect} className="shrink-0 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/15">Disconnect</button>
                ) : (
                  <button onClick={r.onConnect} className="shrink-0 rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black hover:bg-white/90">{r.connectLabel}</button>
                )}
              </div>
            )
          })}
        </div>
        {ani.error && !ani.isAuthenticated && <p className="mt-2 text-xs text-amber-200/70">{ani.error}</p>}
        {mal.error && <p className="mt-2 text-xs text-amber-200/70">{mal.error}</p>}

        <button
          onClick={onClose}
          className="mt-4 w-full rounded-full bg-white px-4 py-2 text-xs font-semibold text-black hover:bg-white/90"
        >
          Continue
        </button>
      </div>
    </div>
  )
}
