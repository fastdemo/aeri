import { useState } from 'react'
import { useMAL } from '../../contexts/MALContext'

export function MALConnectCompact() {
  const { isAuthenticated, user, login, logout, setManualToken, error, authExpired, loadingUser, hasClientId, redirectUri } = useMAL()
  const [showManual, setShowManual] = useState(false)
  const [manual, setManual] = useState('')

  if (isAuthenticated && user) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2">
        {user.avatar?.large ? (
          <img src={user.avatar.large} alt="" className="h-7 w-7 rounded-full bg-white/10 object-cover" loading="lazy" />
        ) : (
          <div className="grid h-7 w-7 place-items-center rounded-full bg-[#2e51a2] text-[10px] font-bold text-white">MAL</div>
        )}
        <div className="min-w-0">
          <p className="text-xs font-medium leading-none text-white">{user.name}</p>
          <p className="text-[11px] leading-none text-white/50">MyAnimeList connected</p>
        </div>
        <button onClick={logout} className="ml-auto rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white hover:bg-white/15">
          Disconnect
        </button>
      </div>
    )
  }

  if (loadingUser) {
    return (
      <div className="rounded-lg border border-white/5 bg-white/[0.03] px-3 py-3 text-xs text-white/60">
        Connecting to MyAnimeList…
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-white/10 bg-[#141416] px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-white">Connect MyAnimeList</p>
          <p className="text-[11px] text-white/50">Sync your MAL list, progress, and ratings. Token stays in your browser.</p>
        </div>
        <div className="ml-auto flex gap-2">
          <button onClick={() => { login().catch(()=>{}) }} className="rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black hover:bg-white/90">
            Connect
          </button>
          <button onClick={() => setShowManual(v => !v)} className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-medium text-white hover:bg-white/15">
            Paste token
          </button>
        </div>
      </div>

      {authExpired && (
        <p className="mt-2 rounded bg-amber-500/10 px-2 py-1.5 text-xs text-amber-200/90">Session expired. Please reconnect.</p>
      )}
      {error && !authExpired && (
        <p className="mt-2 rounded bg-white/5 px-2 py-1.5 text-xs text-white/60">{error}</p>
      )}

      {!hasClientId && (
        <p className="mt-2 text-[11px] leading-4 text-white/40">
          Client ID not set. Set <code className="rounded bg-white/10 px-1 py-0.5 text-[10px]">VITE_MAL_CLIENT_ID</code> and set redirect to <code className="rounded bg-white/10 px-1 py-0.5 text-[10px]">{redirectUri}</code> in MAL API settings, or paste a personal token below.
        </p>
      )}

      {showManual && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (setManualToken(manual)) {
              setShowManual(false)
              setManual('')
            }
          }}
          className="mt-3 flex gap-2"
        >
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="Paste MAL access token"
            className="flex-1 rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs text-white placeholder:text-white/40 focus:border-white/20 focus:outline-none"
          />
          <button type="submit" className="rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-black">
            Save
          </button>
        </form>
      )}
    </div>
  )
}
