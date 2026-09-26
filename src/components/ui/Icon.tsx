// Shared Bootstrap Icons wrapper — every icon in Aeri comes from here.
// Source: bootstrap-icons npm package (MIT). Icons render at the given size
// with currentColor; pass className for theme text colors.
import bookSvg from 'bootstrap-icons/icons/book.svg?raw'
import playFillSvg from 'bootstrap-icons/icons/play-fill.svg?raw'
import playCircleSvg from 'bootstrap-icons/icons/play-circle.svg?raw'
import threeDotsVerticalSvg from 'bootstrap-icons/icons/three-dots-vertical.svg?raw'
import checkLgSvg from 'bootstrap-icons/icons/check-lg.svg?raw'
import xSvg from 'bootstrap-icons/icons/x.svg?raw'
import plusLgSvg from 'bootstrap-icons/icons/plus-lg.svg?raw'
import plusCircleSvg from 'bootstrap-icons/icons/plus-circle.svg?raw'
import dashLgSvg from 'bootstrap-icons/icons/dash-lg.svg?raw'
import listSvg from 'bootstrap-icons/icons/list.svg?raw'
import searchSvg from 'bootstrap-icons/icons/search.svg?raw'
import bellSvg from 'bootstrap-icons/icons/bell.svg?raw'
import personSvg from 'bootstrap-icons/icons/person.svg?raw'
import gearSvg from 'bootstrap-icons/icons/gear.svg?raw'
import chevronDownSvg from 'bootstrap-icons/icons/chevron-down.svg?raw'
import chevronLeftSvg from 'bootstrap-icons/icons/chevron-left.svg?raw'
import chevronRightSvg from 'bootstrap-icons/icons/chevron-right.svg?raw'
import arrowLeftSvg from 'bootstrap-icons/icons/arrow-left.svg?raw'
import arrowDownUpSvg from 'bootstrap-icons/icons/arrow-down-up.svg?raw'
import arrowUpShortSvg from 'bootstrap-icons/icons/arrow-up-short.svg?raw'
import arrowDownShortSvg from 'bootstrap-icons/icons/arrow-down-short.svg?raw'

const PATHS: Record<string, string> = {
  book: bookSvg,
  'play-fill': playFillSvg,
  'play-circle': playCircleSvg,
  'three-dots-vertical': threeDotsVerticalSvg,
  'check-lg': checkLgSvg,
  x: xSvg,
  'plus-lg': plusLgSvg,
  'plus-circle': plusCircleSvg,
  'dash-lg': dashLgSvg,
  list: listSvg,
  search: searchSvg,
  bell: bellSvg,
  person: personSvg,
  gear: gearSvg,
  'chevron-down': chevronDownSvg,
  'chevron-left': chevronLeftSvg,
  'chevron-right': chevronRightSvg,
  'arrow-left': arrowLeftSvg,
  'arrow-down-up': arrowDownUpSvg,
  'arrow-up-short': arrowUpShortSvg,
  'arrow-down-short': arrowDownShortSvg,
}

export type IconName = keyof typeof PATHS

function svgBody(svg: string): string {
  const m = svg.match(/<svg[^>]*>([\s\S]*)<\/svg>/)
  return m ? m[1].trim() : svg
}

export function Icon({
  name,
  size = 14,
  className,
  label,
}: {
  name: IconName
  size?: number
  className?: string
  label?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      className={className}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: static MIT-licensed icon paths
      dangerouslySetInnerHTML={{ __html: svgBody(PATHS[name]) }}
    />
  )
}
