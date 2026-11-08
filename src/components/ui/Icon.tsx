// Shared icon wrapper - every icon in Aeri comes from Lucide.
// Source: lucide-react (ISC). Icons render at the given size with
// currentColor; pass className for theme text colors. The public IconName
// keys are the app's stable names, mapped here to Lucide components so
// call sites never import an icon library directly.
import type { SVGProps } from 'react'
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
  ChartLine,
  CirclePlay,
  CirclePlus,
  EllipsisVertical,
  EyeOff,
  GripVertical,
  List,
  Menu,
  Minus,
  PenTool,
  Play,
  Plus,
  Scale,
  Search,
  Settings,
  User,
  X,
  type LucideIcon,
} from 'lucide-react'

// GitHub is a brand mark and lucide-react no longer ships brand icons, so
// it is drawn here with the same 24-unit viewBox and currentColor contract.
// The glyph is solid (a silhouette), unlike the stroke icons around it.
function GithubGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" {...props} fill="currentColor" stroke="none">
      <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58 0-.29-.01-1.04-.02-2.05-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.84 2.81 1.31 3.5 1 .11-.78.42-1.31.76-1.61-2.67-.3-5.47-1.34-5.47-5.96 0-1.32.47-2.39 1.24-3.23-.12-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 3-.4c1.02 0 2.05.14 3 .4 2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.24 2.88.12 3.18.77.84 1.24 1.91 1.24 3.23 0 4.63-2.8 5.65-5.48 5.95.43.37.81 1.1.81 2.22 0 1.6-.01 2.89-.01 3.29 0 .32.21.7.83.58C20.56 22.3 24 17.8 24 12.5 24 5.87 18.63.5 12 .5z" />
    </svg>
  )
}

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
  // tick - "now playing" reads as sound, not as "already seen".
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
  github: GithubGlyph as unknown as LucideIcon,
  'chart-line': ChartLine,
  'pen-tool': PenTool,
  scale: Scale,
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
