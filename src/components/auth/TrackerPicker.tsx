import type { TrackingProviderId } from '../../storage/preferences'

type Props = {
  value: TrackingProviderId | null
  onChange: (p: TrackingProviderId) => void
  anilistConnected: boolean
  malConnected: boolean
  anilistName?: string | null
  malName?: string | null
}

// Single-select: both accounts may stay signed in, but exactly one drives
// tracking reads + writes. AniList stays the metadata backbone either way.
export function TrackerPicker({ value, onChange, anilistConnected, malConnected, anilistName, malName }: Props) {
  if (!anilistConnected && !malConnected) return null
  const options: { id: TrackingProviderId; label: string; sub: string; connected: boolean }[] = [
    {
      id: 'anilist',
      label: 'AniList',
      sub: anilistConnected ? (anilistName ? `Track as ${anilistName}` : 'Connected') : 'Not connected',
      connected: anilistConnected,
    },
    {
      id: 'mal',
      label: 'MyAnimeList',
      sub: malConnected ? (malName ? `Track as ${malName}` : 'Connected') : 'Not connected',
      connected: malConnected,
    },
  ]
  return (
    <div role="radiogroup" aria-label="Tracking account" className="flex flex-col gap-2">
      {options.map((o) => {
        const selected = value === o.id
        return (
          <button
            key={o.id}
            role="radio"
            aria-checked={selected}
            disabled={!o.connected}
            onClick={() => o.connected && onChange(o.id)}
            className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition ${
              selected
                ? 'border-white/40 bg-white/[0.06]'
                : o.connected
                  ? 'border-white/10 bg-white/[0.02] hover:border-white/25'
                  : 'cursor-not-allowed border-white/5 bg-transparent opacity-40'
            }`}
          >
            <span
              aria-hidden
              className={`grid h-4 w-4 shrink-0 place-items-center rounded-full border ${
                selected ? 'border-white' : 'border-white/30'
              }`}
            >
              {selected && <span className="h-2 w-2 rounded-full bg-white" />}
            </span>
            <span className="min-w-0">
              <span className="block text-xs font-medium text-white">{o.label}</span>
              <span className="block truncate text-[11px] text-white/50">{o.sub}</span>
            </span>
            {selected && <span className="ml-auto shrink-0 text-[10px] font-medium uppercase tracking-wide text-white/50">Tracking</span>}
          </button>
        )
      })}
    </div>
  )
}
