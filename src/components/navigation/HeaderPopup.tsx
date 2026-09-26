import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/** Geometry of the anchor the popup hangs off (viewport coords). */
export interface PopupAnchor {
  left: number
  right: number
  bottom: number
}

/**
 * Glass popup portaled to document.body. WHY a portal: our dropdowns hang
 * off elements INSIDE the fixed header. `backdrop-filter` on a descendant
 * samples only that ancestor's BackdropRoot — at the top of the page the
 * header is a transparent gradient (BackdropRoot ≈ page texture ⇒ blur
 * looks rich), but once scrolled the header is opaque `bg/95 + blur-md`
 * (BackdropRoot ≈ flat color ⇒ blur has nothing to work with and the panel
 * reads almost-transparent). A body-level portal puts the panel's
 * BackdropRoot over the real page, so blur samples true page texture at
 * every scroll position. The panel is `position: fixed` and tracks the
 * anchor via getBoundingClientRect (scroll/resize listeners), so it stays
 * glued 8px under the anchor exactly like the old absolute version.
 */
export function HeaderPopup({
  anchorRef,
  align = 'right',
  width,
  ariaLabel,
  role = 'menu',
  children,
}: {
  anchorRef: React.RefObject<HTMLElement | null>
  align?: 'left' | 'right'
  width: number
  ariaLabel: string
  role?: string
  children: React.ReactNode
}) {
  const [rect, setRect] = useState<PopupAnchor | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const measure = () => {
      const el = anchorRef.current
      if (!el) { setRect(null); return }
      const r = el.getBoundingClientRect()
      setRect({ left: r.left, right: r.right, bottom: r.bottom })
    }
    measure()
    window.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('resize', measure)
    return () => {
      window.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
    }
  }, [anchorRef])

  if (!rect) return null
  const style: React.CSSProperties = {
    position: 'fixed',
    top: rect.bottom + 8,
    width,
    maxWidth: 'calc(100vw - 2rem)',
    // Clamp horizontally into the viewport (mirrors the old in-header
    // absolute placement, which the header's own padding kept on-screen).
    ...(align === 'right'
      ? { right: Math.max(8, window.innerWidth - rect.right) }
      : { left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) }),
    isolation: 'isolate',
  }
  return createPortal(
    <div
      ref={panelRef}
      role={role}
      aria-label={ariaLabel}
      data-header-popup="true"
      style={style}
      className="z-[70] max-h-[min(68vh,420px)] overflow-x-hidden overflow-y-auto rounded-xl border border-[var(--border)] bg-[color-mix(in_srgb,var(--bg)_70%,transparent)] shadow-[0_16px_48px_var(--shadow)] backdrop-blur-2xl"
    >
      {children}
    </div>,
    document.body,
  )
}
