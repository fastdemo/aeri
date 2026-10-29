// Shared icon wrapper — every icon in Aeri comes from Lucide.
// Source: lucide-react (ISC). Icons render at the given size with
// currentColor; pass className for theme text colors. The public IconName
// keys are the app's stable names, mapped here to Lucide components so
// call sites never import an icon library directly.
import {
  ArrowDown,
  AudioLines,
  ArrowLeft,
  ArrowUp,
  ArrowUpDown,
  Bell,
  Book,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CirclePlay,
  CirclePlus,
  EllipsisVertical,
  EyeOff,
  GripVertical,
  List,
  Menu,
  Minus,
  Play,
  Plus,
  Search,
  Settings,
  User,
  X,
  type LucideIcon,
} from 'lucide-react'

const ICONS: Record<string, LucideIcon> = {
  book: Book,
  'book-open': BookOpen,
  // Legacy key kept for call-site compatibility; the filled variant is not
  // drawn anywhere today, so it renders the same outline book.
  'book-fill': Book,
  'play-fill': Play,
  'play-circle': CirclePlay,
  'three-dots-vertical': EllipsisVertical,
  'check-lg': Check,
  // The Watch grid marks the CURRENT episode with the
  // same overlay as a watched one, but an audio-bars glyph instead of the
  // tick — "now playing" reads as sound, not as "already seen".
  'audio-lines': AudioLines,
  x: X,
  'plus-lg': Plus,
  'plus-circle': CirclePlus,
  'dash-lg': Minus,
  list: List,
  // The collapsed nav trigger is Lucide's `menu`
  // (three rules), not the `list` glyph (bulleted rows). `list` stays for
  // its historical call sites.
  menu: Menu,
  search: Search,
  bell: Bell,
  person: User,
  gear: Settings,
  'eye-slash': EyeOff,
  'chevron-down': ChevronDown,
  'chevron-left': ChevronLeft,
  'chevron-right': ChevronRight,
  'arrow-left': ArrowLeft,
  'arrow-down-up': ArrowUpDown,
  'arrow-up-short': ArrowUp,
  'arrow-down-short': ArrowDown,
  'grip-vertical': GripVertical,
}

export type IconName = keyof typeof ICONS

export function Icon({
  name,
  size = 14,
  className,
  label,
  strokeWidth,
}: {
  name: IconName
  size?: number
  className?: string
  label?: string
  /** Optional override for stroke glyphs. Small icons need a heavier
   *  viewBox stroke to carry the same optical weight as 12px text arrows:
   *  the 24-unit viewBox scales a 2-unit stroke down to 1px at size 12. */
  strokeWidth?: number
}) {
  const Glyph = ICONS[name] ?? Book
  // The play glyph is the one solid icon in the app; everything else is a
  // stroke glyph (Bootstrap's filled look does not translate 1:1).
  const solid = name === 'play-fill'
  return (
    <Glyph
      width={size}
      height={size}
      strokeWidth={solid ? 0 : (strokeWidth ?? 2)}
      fill={solid ? 'currentColor' : 'none'}
      className={className}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
    />
  )
}
