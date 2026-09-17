import { useState } from 'react'
import { useMAL } from '../../contexts/MALContext'

export function MALConnectCompact() {
  const { isAuthenticated, user, login, logout, setManualToken, error, authExpired, loadingUser, hasClientId, redirectUri } = useMAL()
  const [showManual, setShowManual] = useState(false)
  const [manual, setManual] = useState('')

  if (isAuthenticated && user) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--text)]/[0.04] px-3 py-2">
        {user.avatar?.large ? (
          <img src={user.avatar.large} alt="" className="h-7 w-7 rounded-full bg-[color-mix(in_srgb,var(--text)_10%,transparent)] object-cover" loading="lazy" />
        ) : (
          <div className="grid h-7 w-7 place-items-center rounded-full bg-[var(--accent)] text-[10px] font-bold text-[var(--text)]">MAL</div>
        )}
        <div className="min-w-0">
          <p className="text-xs font-medium leading-none text-[var(--text)]">{user.name}</p>
          <p className="text-[11px] leading-none text-[var(--text-faint)]">MyAnimeList connected</p>
        </div>
        <button onClick={logout} className="ml-auto rounded-full bg-[color-mix(in_srgb,var(--text)_10%,transparent)] px-3 py-1 text-xs font-medium text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--text)_15%,transparent)]">
          Disconnect
        </button>
      </div>
    )
  }

  if (loadingUser) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--text)]/[0.03] px-3 py-3 text-xs text-[var(--text-muted)]">
        Connecting to MyAnimeList…
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-[var(--text)]">Connect MyAnimeList</p>
          <p className="text-[11px] text-[var(--text-faint)]">Sync your MAL list, progress, and ratings. Token stays in your browser.</p>
        </div>
        <div className="ml-auto flex gap-2">
          <button onClick={() => { login().catch(()=>{}) }} className="rounded-full bg-[var(--text)] px-4 py-1.5 text-xs font-semibold text-[var(--on-text)] hover:bg-[color-mix(in_srgb,var(--text)_90%,transparent)]">
            Connect
          </button>
          <button onClick={() => setShowManual(v => !v)} className="rounded-full bg-[color-mix(in_srgb,var(--text)_10%,transparent)] px-3 py-1.5 text-xs font-medium text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--text)_15%,transparent)]">
            Paste token
          </button>
        </div>
      </div>

      {authExpired && (
        <p className="mt-2 rounded bg-[var(--warn)] px-2 py-1.5 text-xs text-[var(--warn)]">Session expired. Please reconnect.</p>
      )}
      {error && !authExpired && (
        <p className="mt-2 rounded bg-[color-mix(in_srgb,var(--text)_5%,transparent)] px-2 py-1.5 text-xs text-[var(--text-muted)]">{error}</p>
      )}

      {!hasClientId && (
        <p className="mt-2 text-[11px] leading-4 text-[var(--text-faint)]">
          Client ID not set. Set <code className="rounded bg-[color-mix(in_srgb,var(--text)_10%,transparent)] px-1 py-0.5 text-[10px]">VITE_MAL_CLIENT_ID</code> and set redirect to <code className="rounded bg-[color-mix(in_srgb,var(--text)_10%,transparent)] px-1 py-0.5 text-[10px]">{redirectUri}</code> in MAL API settings, or paste a personal token below.
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
            className="flex-1 rounded-full border border-[var(--border)] bg-[var(--text)]/[0.06] px-3 py-1.5 text-xs text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[var(--border-strong)] focus:outline-none"
          />
          <button type="submit" className="rounded-full bg-[var(--text)] px-4 py-1.5 text-xs font-semibold text-[var(--on-text)]">
            Save
          </button>
        </form>
      )}
    </div>
  )
}
