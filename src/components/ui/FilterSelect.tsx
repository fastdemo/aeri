import type { ReactNode } from 'react'
import { Icon } from './Icon'

export interface FilterOption {
  value: string
  label: string
}

/**
 * Shared pill dropdown — the filter selects from the Anime/Manga browse tabs.
 * Plain variant: the select itself is the pill (value doubles as the visible
 * label, e.g. Genre/Year). Prefixed variant: a muted `prefix` (e.g. "Status:",
 * "★") sits inside the pill and the select shows only the value.
 * Same pill, same chevron, same option treatment in both.
 */
export function FilterSelect({
  value,
  onChange,
  ariaLabel,
  options,
  disabled,
  prefix,
  suffix,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  ariaLabel: string
  options: FilterOption[]
  disabled?: boolean
  prefix?: ReactNode
  /** Static text after the select (e.g. "/10" for scores). */
  suffix?: ReactNode
  /** Shown when value is '' (e.g. unrated). Omitted = no placeholder option. */
  placeholder?: string
}) {
  if (prefix) {
    return (
      <span className="relative inline-flex shrink-0 items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--bg-soft)] py-1.5 pl-3.5 pr-8">
        <span className="text-xs text-[var(--text-muted)]">{prefix}</span>
        <select
          value={value}
          disabled={disabled}
          onChange={e => onChange(e.target.value)}
          aria-label={ariaLabel}
          className="appearance-none bg-transparent text-xs font-medium text-[var(--text)] focus:outline-none disabled:opacity-50"
        >
          {placeholder !== undefined && <option value="" className="bg-[var(--surface)]">{placeholder}</option>}
          {options.map(o => (
            <option key={o.value} className="bg-[var(--surface)]" value={o.value}>{o.label}</option>
          ))}
        </select>
        {suffix && <span className="text-xs text-[var(--text-muted)]">{suffix}</span>}
        <Icon name="chevron-down" size={12} className="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--text-faint)]" />
      </span>
    )
  }
  return (
    <div className="relative shrink-0">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        aria-label={ariaLabel}
        disabled={disabled}
        className="max-w-[130px] appearance-none truncate rounded-full border border-[var(--border)] bg-[var(--bg-soft)] py-1.5 pl-3.5 pr-8 text-xs font-medium text-[var(--text)] focus:border-[var(--border-strong)] focus:outline-none disabled:opacity-50"
      >
        {placeholder !== undefined && <option value="" className="bg-[var(--surface)]">{placeholder}</option>}
        {options.map(o => (
          <option key={o.value} className="bg-[var(--surface)]" value={o.value}>{o.label}</option>
        ))}
      </select>
      <Icon name="chevron-down" size={12} className="pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--text-faint)]" />
    </div>
  )
}
