/**
 * SortableList — drag-to-reorder rows with a real grip handle.
 *
 * The handle is a <button>: pointer users drag it, keyboard users focus it
 * and press ↑/↓. That keeps WCAG 2.5.7 (Dragging Movements) satisfied without
 * drawing a second set of arrow buttons.
 *
 * During a drag the rows keep their DOM order; the dragged row follows the
 * pointer and the rows between `from` and `to` slide out of the way with a
 * transform. The new order is committed once, on drop — no re-render churn
 * per pixel and no midpoint flicker.
 *
 * Move/up listeners live on `window` and read a ref, not React state: the
 * first pointermove can land before the re-render that would attach a new
 * handler, and pointer capture alone does not fix that race.
 */
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'

export interface SortableRow {
  /** Attach to the row element so the list can measure it. */
  rowRef: (el: HTMLDivElement | null) => void
  /** Transform/lift style for this row. */
  rowStyle: CSSProperties
  /** True for the row currently being dragged. */
  isDragging: boolean
  /** Spread on the grip button. */
  handleProps: {
    onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => void
    onKeyDown: (e: ReactKeyboardEvent<HTMLButtonElement>) => void
    'aria-label': string
    'aria-describedby': string
    title: string
  }
}

interface SortableListProps<T> {
  items: T[]
  getId: (item: T) => string
  getLabel: (item: T) => string
  /** Called once on drop / arrow key with final indices. */
  onReorder: (from: number, to: number) => void
  renderRow: (item: T, index: number, row: SortableRow) => ReactNode
  className?: string
}

interface DragState {
  from: number
  to: number
  startY: number
  dy: number
  pointerId: number
  /** Viewport geometry captured at drag start (transforms excluded). */
  tops: number[]
  heights: number[]
  /**
   * How far the dragged row may travel before its top/bottom leaves the
   * list. Without this the row followed the pointer forever — dragging past
   * the last row left a floating card far below the panel (owner report
   * 2026-10-30: "i can drag forever which looks unhinged").
   */
  minDy: number
  maxDy: number
}

const SHIFT = 'transform 160ms cubic-bezier(0.2, 0, 0, 1)'

export function SortableList<T>({
  items,
  getId,
  getLabel,
  onReorder,
  renderRow,
  className = '',
}: SortableListProps<T>) {
  const hintId = useId()
  const rowRefs = useRef(new Map<string, HTMLDivElement>())
  const dragRef = useRef<DragState | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [announcement, setAnnouncement] = useState('')

  // Escape cancels a drag that is in flight.
  useEffect(() => {
    if (!drag) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        dragRef.current = null
        setDrag(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drag])

  const rowRefFor = (id: string) => (el: HTMLDivElement | null) => {
    if (el) rowRefs.current.set(id, el)
    else rowRefs.current.delete(id)
  }

  const begin = (e: ReactPointerEvent<HTMLButtonElement>, index: number) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const rects = items.map((item) => {
      const el = rowRefs.current.get(getId(item))
      const r = el?.getBoundingClientRect()
      return { top: r?.top ?? 0, height: r?.height ?? 0 }
    })
    // No text selection while the grip is held.
    e.preventDefault()

    // Vertical travel is bounded by the list's own box: the dragged row can
    // reach the first/last slot but never float past the panel.
    const first = rects[0]
    const last = rects[rects.length - 1]
    const listTop = first?.top ?? 0
    const listBottom = (last?.top ?? 0) + (last?.height ?? 0)
    const dragTop = rects[index]?.top ?? 0
    const dragHeight = rects[index]?.height ?? 0
    const minDy = listTop - dragTop
    const maxDy = listBottom - (dragTop + dragHeight)

    const start: DragState = {
      from: index,
      to: index,
      startY: e.clientY,
      dy: 0,
      pointerId: e.pointerId,
      tops: rects.map((r) => r.top),
      heights: rects.map((r) => r.height),
      minDy: Math.min(minDy, 0),
      maxDy: Math.max(maxDy, 0),
    }
    dragRef.current = start
    setAnnouncement('')
    setDrag(start)

    const onMove = (ev: PointerEvent) => {
      const cur = dragRef.current
      if (!cur || ev.pointerId !== cur.pointerId) return
      let slot = cur.heights.length
      for (let i = 0; i < cur.heights.length; i++) {
        if (ev.clientY < cur.tops[i] + cur.heights[i] / 2) {
          slot = i
          break
        }
      }
      // Removing the dragged row shifts every slot after it up by one.
      const to = Math.max(0, Math.min(items.length - 1, slot <= cur.from ? slot : slot - 1))
      const dy = Math.max(cur.minDy, Math.min(cur.maxDy, ev.clientY - cur.startY))
      const next = { ...cur, dy, to }
      dragRef.current = next
      setDrag(next)
    }

    const finish = (ev: PointerEvent) => {
      const cur = dragRef.current
      if (!cur || ev.pointerId !== cur.pointerId) return
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      dragRef.current = null
      setDrag(null)
      if (cur.to !== cur.from) {
        onReorder(cur.from, cur.to)
        setAnnouncement(`${getLabel(items[cur.from])} moved to position ${cur.to + 1} of ${items.length}`)
      }
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>, item: T, index: number) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    const to = e.key === 'ArrowUp' ? index - 1 : index + 1
    if (to < 0 || to >= items.length) return
    onReorder(index, to)
    setAnnouncement(`${getLabel(item)} moved to position ${to + 1} of ${items.length}`)
  }

  const rowStyleFor = (index: number): CSSProperties => {
    if (!drag) return {}
    if (index === drag.from) {
      return {
        transform: `translateY(${drag.dy}px)`,
        position: 'relative',
        zIndex: 20,
        transition: 'none',
      }
    }
    const draggedHeight = drag.heights[drag.from] ?? 0
    if (drag.to > drag.from && index > drag.from && index <= drag.to) {
      return { transform: `translateY(${-draggedHeight}px)`, transition: SHIFT }
    }
    if (drag.to < drag.from && index >= drag.to && index < drag.from) {
      return { transform: `translateY(${draggedHeight}px)`, transition: SHIFT }
    }
    return { transition: SHIFT }
  }

  return (
    <div className={className}>
      <span id={hintId} className="sr-only">
        Drag the grip to reorder, or focus it and press the up and down arrow keys.
      </span>
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {items.map((item, index) =>
        renderRow(item, index, {
          rowRef: rowRefFor(getId(item)),
          rowStyle: rowStyleFor(index),
          isDragging: drag?.from === index,
          handleProps: {
            onPointerDown: (e) => begin(e, index),
            onKeyDown: (e) => onKeyDown(e, item, index),
            'aria-label': `Reorder ${getLabel(item)}`,
            'aria-describedby': hintId,
            title: 'Drag to reorder, or press ↑/↓',
          },
        }),
      )}
    </div>
  )
}
