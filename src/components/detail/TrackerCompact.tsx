import { useState } from 'react'
import type { AnimeStatus } from '../../types/anime'

/**
 * Compact tracker control for the preview/detail modal (§2).
 * Collapsed: status pill only — plus episode/chapter + score when the
 * status is anything but planned (Plan to Watch / Plan to Read hides both).
 * Expanded (tap the pill): the existing status picker options + a score
 * stepper, reusing the same update callbacks (no parallel tracker state).
 * All values come from props derived live from useTracking, so mutations
 * propagate through the existing reactive contexts with no reload.
 */
export function TrackerCompact({
  status,
  score,
  progress,
  isManga,
  syncing,
  onStatus,
  onScore,
}: {
  status: AnimeStatus | null
  score: number | null
  progress: number
  isManga: boolean
  syncing: string | null
  onStatus: (s: AnimeStatus) => Promise<void>
  onScore: (n: number) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const planned = status === 'planned'
  const unit = isManga ? 'Ch.' : 'Ep.'
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try { await fn() } finally { setBusy(false) }
  }
  return (
    <div className="px-4 pt-3 sm:px-6">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          aria-expanded={open}
          aria-label="Tracker controls"
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[color-mix(in_srgb,var(--text)_5%,transparent)] px-2.5 py-1 text-[var(--text)] transition hover:bg-[color-mix(in_srgb,var(--text)_10%,transparent)]"
        >
          <span className="capitalize text-[var(--text-muted)]">Status:</span>
          <span className="capitalize">{status ? status.replace('_', ' ') : '—'}</span>
          <span aria-hidden className="text-[9px] text-[var(--text-faint)]">{open ? '▲' : '▼'}</span>
        </button>
        {!planned && (
          <>
            <span className="rounded-full border border-[var(--border)] bg-[color-mix(in_srgb,var(--text)_5%,transparent)] px-2.5 py-1 text-[var(--text-muted)]">
              {unit} {progress}
            </span>
            {score !== null && score > 0 && (
              <span className="rounded-full border border-[var(--border)] bg-[color-mix(in_srgb,var(--text)_5%,transparent)] px-2.5 py-1 text-[var(--text)]">
                ★ {score}/10
              </span>
            )}
          </>
        )}
        {(syncing || busy) && <span className="px-1 text-[var(--text-faint)]">Syncing…</span>}
      </div>
      {open && (
        <div className="anim-pop-in mt-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-2">
          {(['watching', 'completed', 'planned', 'on_hold', 'dropped'] as AnimeStatus[]).map(s => (
            <button
              key={s}
              type="button"
              disabled={busy}
              onClick={() => run(() => onStatus(s))}
              className={`rounded-full px-2.5 py-1 text-[11px] capitalize transition ${status === s ? 'bg-[var(--text)] font-semibold text-[var(--on-text)]' : 'text-[var(--text-muted)] hover:bg-[color-mix(in_srgb,var(--text)_10%,transparent)] hover:text-[var(--text)]'}`}
            >
              {s.replace('_', ' ')}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-[var(--border)]" aria-hidden />
          {[0, -1, 1].map(d =>
            d === 0 ? (
              <span key="lbl" className="px-1 text-[11px] text-[var(--text-faint)]">Score{score ? ` ${score}` : ''}</span>
            ) : (
              <button
                key={d}
                type="button"
                disabled={busy || score === null}
                onClick={() => run(() => onScore(Math.max(0, Math.min(10, (score ?? 0) + d))))}
                aria-label={d > 0 ? 'Increase score' : 'Decrease score'}
                className="grid h-5 w-5 place-items-center rounded-full text-[var(--text-muted)] transition hover:bg-[color-mix(in_srgb,var(--text)_10%,transparent)] hover:text-[var(--text)] disabled:opacity-30"
              >
                {d > 0 ? '+' : '−'}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  )
}
