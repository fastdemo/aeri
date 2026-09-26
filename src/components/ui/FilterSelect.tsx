import type { ReactNode } from 'react'
import { Icon } from './Icon'

export interface FilterOption {
  value: string
  label: string
  key?: string
}

/**
 * Shared pill dropdown — the filter selects from the Anime/Manga browse tabs.
 * The native select is transparent and covers the WHOLE pill, so every pixel
 * opens the menu (no dead space, no unclickable prefix/suffix/padding); the
 * visible row (prefix + value + suffix + chevron) is pointer-events-none.
 * Same pill, same chevron, same option treatment in both variants.
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
  const current = options.find(o => o.value === value)?.label ?? placeholder ?? ''
  const overlay = (
    <select
      value={value}
      disabled={disabled}
      onChange={e => onChange(e.target.value)}
      aria-label={ariaLabel}
      className="absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0 focus:outline-none disabled:cursor-default"
    >
      {placeholder !== undefined && <option value="" className="bg-[var(--surface)]">{placeholder}</option>}
      {options.map(o => (
        <option key={o.key ?? o.value} className="bg-[var(--surface)]" value={o.value}>{o.label}</option>
      ))}
    </select>
  )
  if (prefix) {
    return (
      <span className={`relative inline-flex min-w-0 shrink-0 items-center gap-1 overflow-hidden rounded-full border border-[var(--border)] bg-[var(--bg-soft)] py-1.5 pl-3 pr-6 text-xs focus-within:border-[var(--border-strong)] ${disabled ? 'opacity-50' : ''}`}>
        <span aria-hidden className="pointer-events-none inline-flex min-w-0 items-center whitespace-nowrap">
          <span className="shrink-0 text-[var(--text-muted)]">{prefix}&nbsp;</span>
          <span className="truncate font-medium text-[var(--text)]">{current}</span>
          {suffix && <span className="shrink-0 text-[var(--text-muted)]">{suffix}</span>}
        </span>
        {overlay}
        <Icon name="chevron-down" size={12} className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 shrink-0 -translate-y-1/2 text-[var(--text-faint)]" />
      </span>
    )
  }
  return (
    <span className={`relative inline-flex min-w-0 shrink-0 items-center overflow-hidden rounded-full border border-[var(--border)] bg-[var(--bg-soft)] py-1.5 pl-3 pr-6 text-xs font-medium focus-within:border-[var(--border-strong)] ${disabled ? 'opacity-50' : ''}`}>
      <span aria-hidden className="pointer-events-none max-w-[130px] truncate whitespace-nowrap text-[var(--text)]">{current}</span>
      {overlay}
      <Icon name="chevron-down" size={12} className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--text-faint)]" />
    </span>
  )
}
