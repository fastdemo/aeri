/**
 * Aeri switch — the one on/off control in Settings.
 *
 * COLOR SCHEME = THE SUB/DUB SEGMENTED TOGGLE (owner instruction 2026-10-29):
 * the ON state is the active pill exactly — solid `--text` fill with the
 * `--on-text` knob — and the OFF state is the inactive pill: hairline
 * `--border-strong` track with a muted `--text` knob. Nothing here references
 * `--accent`, so every theme (including Aeri Light, where `--text` is dark and
 * `--on-text` light) reads the same as the audio toggle beside it.
 *
 * MOTION: 220ms knob slide with the standard entrance easing, track color
 * cross-fade on the same curve, and a small press contraction. All of it is
 * disabled under `prefers-reduced-motion`.
 */

function Track({ checked, disabled }: { checked: boolean; disabled?: boolean }) {
  return (
    <span
      aria-hidden
      className={`relative h-[18px] w-8 shrink-0 rounded-full border transition-[background-color,border-color,transform] duration-200 ease-[cubic-bezier(.2,.8,.2,1)] group-active:scale-[0.94] motion-reduce:transition-none motion-reduce:group-active:scale-100 group-focus-visible:ring-2 group-focus-visible:ring-[color-mix(in_srgb,var(--text)_35%,transparent)] ${
        checked
          ? 'border-[var(--text)] bg-[var(--text)]'
          : 'border-[var(--border-strong)] bg-transparent group-hover:border-[color-mix(in_srgb,var(--text)_30%,transparent)]'
      } ${disabled ? 'opacity-40' : ''}`}
    >
      <span
        className={`absolute left-0.5 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full transition-[transform,background-color] duration-200 ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none ${
          checked
            ? 'translate-x-[14px] bg-[var(--on-text)]'
            : 'translate-x-0 bg-[color-mix(in_srgb,var(--text)_45%,transparent)]'
        }`}
      />
    </span>
  )
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  /** Accessible name — the visual control carries no text. */
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="group inline-flex h-6 w-8 shrink-0 items-center rounded-full focus-visible:outline-none disabled:cursor-not-allowed"
    >
      <Track checked={checked} disabled={disabled} />
    </button>
  )
}

/**
 * Label + description + switch as ONE control: the whole row is the switch,
 * so the text stays clickable (the previous `<label>` behaviour) without
 * nesting a button inside a label.
 */
export function SwitchRow({
  checked,
  onChange,
  label,
  description,
  ariaLabel,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  description?: string
  ariaLabel: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className="group flex w-full items-center justify-between gap-4 rounded-md text-left focus-visible:outline-none"
    >
      <span className="min-w-0">
        <span className="block text-xs font-medium text-[var(--text)]">{label}</span>
        {description && (
          <span className="mt-0.5 block text-[11px] leading-[1.5] text-[var(--text-faint)]">{description}</span>
        )}
      </span>
      <Track checked={checked} />
    </button>
  )
}
