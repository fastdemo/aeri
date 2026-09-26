import { useEffect, useState } from 'react'
import type { AnimeStatus } from '../../types/anime'
import { FilterSelect, type FilterOption } from '../ui/FilterSelect'
import { Icon } from '../ui/Icon'

const STATUS_VALUES: AnimeStatus[] = ['watching', 'completed', 'planned', 'on_hold', 'dropped']

/** Tracker vocabulary matches each provider: AniList CURRENT… and MAL
    watching/reading share one Aeri status; MAL plan_to_* splits by kind. */
function statusLabel(s: AnimeStatus, isManga: boolean): string {
  switch (s) {
    case 'watching': return isManga ? 'Reading' : 'Watching'
    case 'planned': return isManga ? 'Plan to Read' : 'Plan to Watch'
    case 'completed': return 'Completed'
    case 'on_hold': return 'On Hold'
    case 'dropped': return 'Dropped'
  }
}

/** All possible ratings, 10→1. 0/untracked shows the "–" placeholder;
    picking "–" writes 0, which both providers treat as unrated
    (AniList scoreRaw 0, MAL score 0). Integers only: MAL takes 0-10 ints,
    AniList floats accept them as-is. */
const SCORE_OPTIONS: FilterOption[] = Array.from({ length: 10 }, (_, i) => {
  const v = String(10 - i)
  return { value: v, label: v }
})

/**
 * Compact tracker control for the preview/detail modal.
 * Three pills, always visible, no expanding bar: a Status dropdown (all
 * five statuses plus "–" to remove the entry from the list, manga-aware
 * labels), a type-in Episode/Chapter pill (commit on Enter/blur, Escape
 * reverts, clamped to the known total), and a ★ score dropdown (10→1 plus
 * unrated). All values come from props derived live from useTracking, so
 * mutations propagate through the existing reactive contexts with no
 * reload. Status/progress/score routing (incl. manga vocabulary +
 * endpoints) lives in TrackingContext and the provider mappers — this
 * component only collects input.
 */
export function TrackerCompact({
  status,
  score,
  progress,
  total,
  isManga,
  syncing,
  onStatus,
  onRemove,
  onScore,
  onProgress,
}: {
  status: AnimeStatus | null
  score: number | null
  progress: number
  /** Known episode/chapter total, or null when unknown (no upper clamp). */
  total: number | null
  isManga: boolean
  syncing: string | null
  onStatus: (s: AnimeStatus) => Promise<void>
  /** Remove the entry from the list entirely (Status "–"). */
  onRemove: () => Promise<void>
  onScore: (n: number) => Promise<void>
  onProgress: (n: number) => Promise<void>
}) {
  // Status "–" removes the entry from the list (AniList
  // DeleteMediaListEntry / MAL DELETE my_list_status). Any other value is
  // a plain status change. No silent no-op: every branch runs a write.
  // After a local remove the pill must read "–" IMMEDIATELY (props still
  // show the old status until the refetch lands), so a just-removed flag
  // forces the "–" display until props confirm status === null.
  const REMOVE_VALUE = '__remove__'
  const [justRemoved, setJustRemoved] = useState(false)
  const statusValue = justRemoved || status === null ? REMOVE_VALUE : status
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  // Clear the just-removed display override once the entry carries a
  // real status again (user re-added, or remove failed and the refetch
  // restored it). status === null keeps the override (props already agree).
  useEffect(() => {
    if (status !== null) setJustRemoved(false)
  }, [status])
  const unit = isManga ? 'Chapters' : 'Episodes'
  const disabled = busy || syncing !== null
  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try { await fn() } finally { setBusy(false) }
  }
  const bump = () => {
    setDraft(null)
    const max = total && total > 0 ? total : Number.POSITIVE_INFINITY
    const next = Math.min(max, progress + 1)
    if (next === progress) return
    run(() => onProgress(next))
  }
  const commitDraft = () => {
    const raw = draft
    setDraft(null)
    if (raw === null) return
    const n = Number.parseInt(raw, 10)
    if (Number.isNaN(n)) return
    const max = total && total > 0 ? total : Number.POSITIVE_INFINITY
    const clamped = Math.max(0, Math.min(max, n))
    if (clamped === progress) return
    run(() => onProgress(clamped))
  }
  return (
    <div className="px-4 pt-3 sm:px-6">
      <div className="flex flex-wrap items-center gap-2">
        {/* Status "–" removes the entry from the list; untracked titles
            also show "–" (no phantom "Planned on air" default). */}
        <FilterSelect
          prefix="Status:"
          value={statusValue}
          ariaLabel="Tracking status"
          disabled={disabled}
          options={[
            { value: REMOVE_VALUE, label: '–' },
            ...STATUS_VALUES.map(s => ({ value: s, label: statusLabel(s, isManga) })),
          ]}
          onChange={v => {
            if (v === REMOVE_VALUE) run(async () => { setJustRemoved(true); try { await onRemove() } catch { setJustRemoved(false); throw new Error('remove failed') } })
            else if (v) run(() => onStatus(v as AnimeStatus))
          }}
        />
        {/* Progress pill: "Episodes: N" / "Chapters: N" — the number is a
            type-in that commits on Enter/blur (Escape reverts), clamped to
            the known total. */}
        <span className="inline-flex min-w-0 shrink-0 items-center gap-1 overflow-hidden rounded-full border border-[var(--border)] bg-[var(--bg-soft)] py-1.5 pl-3 pr-2.5 text-xs">
          <label htmlFor="tracker-progress" className="shrink-0 cursor-text whitespace-nowrap text-[var(--text-muted)]">{unit}:</label>
          <input
            id="tracker-progress"
            value={draft ?? String(progress)}
            disabled={disabled}
            inputMode="numeric"
            aria-label={`${unit} progress, type a number`}
            onChange={e => setDraft(e.target.value.replace(/[^0-9]/g, '').slice(0, 4))}
            onBlur={commitDraft}
            onKeyDown={e => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              else if (e.key === 'Escape') { setDraft(null); (e.target as HTMLInputElement).blur() }
            }}
            // Width tracks the digit count: a fixed w-[4ch] left ~3ch of
            // empty input after 1-digit values ("Episodes: 5   ").
            style={{ width: `${Math.max(1, (draft ?? String(progress)).length || 1)}ch` }}
            className="bg-transparent font-medium text-[var(--text)] focus:outline-none disabled:opacity-50"
          />
          <button
            type="button"
            disabled={disabled}
            onClick={bump}
            aria-label={`Mark one more ${isManga ? 'chapter' : 'episode'} watched`}
            className="grid shrink-0 place-items-center self-center rounded-full text-[var(--text-muted)] transition hover:text-[var(--text)] disabled:opacity-30"
          >
            <Icon name="plus-lg" size={12} />
          </button>
        </span>
        <FilterSelect
          prefix="★"
          suffix=" /10"
          value={score !== null && score > 0 ? String(Math.round(score)) : ''}
          placeholder="–"
          ariaLabel="Score out of 10"
          disabled={disabled}
          options={SCORE_OPTIONS}
          onChange={v => run(() => onScore(v === '' ? 0 : Number(v)))}
        />
        {(syncing || busy) && <span className="px-1 text-[11px] text-[var(--text-faint)]">Syncing…</span>}
      </div>
    </div>
  )
}
