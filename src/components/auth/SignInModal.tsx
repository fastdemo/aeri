import { useEffect } from 'react'
import { useAniList } from '../../contexts/AniListContext'
import { useMAL } from '../../contexts/MALContext'
import { useTracking } from '../../contexts/TrackingContext'
import { TrackerPicker } from './TrackerPicker'
import { ProviderIcon } from './ProviderIcon'

// Sign-in entry point: offer both providers; either or both may connect, but
// exactly one is the active tracker (switchable here and in Settings).
export function SignInModal({ onClose }: { onClose: () => void }) {
  const ani = useAniList()
  const mal = useMAL()
  const { trackingProvider, setTrackingProvider } = useTracking()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Sign in"
      className="fixed inset-0 z-[70] grid place-items-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[380px] rounded-xl border border-white/10 bg-[#141416] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">Sign in</h2>
            <p className="mt-1 text-xs text-white/50">Connect either or both. One tracks your list.</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close sign in"
            className="grid h-8 w-8 place-items-center rounded-full text-white/60 hover:bg-white/10 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="mt-4 space-y-2">
          <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2.5">
            <ProviderIcon provider="anilist" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-white">AniList</p>
              <p className="truncate text-[11px] text-white/50">
                {ani.isAuthenticated && ani.user ? `Connected as ${ani.user.name}` : 'List tracking + rich metadata'}
              </p>
            </div>
            {ani.isAuthenticated ? (
              <button onClick={() => ani.logout()} className="shrink-0 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/15">Disconnect</button>
            ) : (
              <button onClick={() => ani.login()} className="shrink-0 rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black hover:bg-white/90">Connect</button>
            )}
          </div>
          {ani.error && !ani.isAuthenticated && <p className="text-xs text-amber-200/70">{ani.error}</p>}

          <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2.5">
            <ProviderIcon provider="mal" />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-white">MyAnimeList</p>
              <p className="truncate text-[11px] text-white/50">
                {mal.isAuthenticated && mal.user ? `Connected as ${mal.user.name}` : 'List tracking via built-in server'}
              </p>
            </div>
            {mal.isAuthenticated ? (
              <button onClick={() => mal.logout()} className="shrink-0 rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/15">Disconnect</button>
            ) : (
              <button onClick={() => mal.login().catch(() => {})} className="shrink-0 rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black hover:bg-white/90">Connect</button>
            )}
          </div>
          {mal.error && <p className="text-xs text-amber-200/70">{mal.error}</p>}
        </div>

        {(ani.isAuthenticated || mal.isAuthenticated) && (
          <div className="mt-4 border-t border-white/10 pt-4">
            <p className="mb-2 text-[11px] text-white/50">Track with</p>
            <TrackerPicker
              value={trackingProvider}
              onChange={setTrackingProvider}
              anilistConnected={ani.isAuthenticated}
              malConnected={mal.isAuthenticated}
              anilistName={ani.user?.name ?? null}
              malName={mal.user?.name ?? null}
            />
            <button
              onClick={onClose}
              className="mt-4 w-full rounded-full bg-white px-4 py-2 text-xs font-semibold text-black hover:bg-white/90"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
