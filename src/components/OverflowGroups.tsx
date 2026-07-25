import React from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal } from 'lucide-react'

// A single-row container that keeps every child (a captioned action group) on
// ONE line and, when they don't all fit, collapses the trailing ones into a "⋮"
// popup — the Google-Sheets overflow pattern. Each child is rendered exactly
// ONCE (either inline or in the menu), so the stateful groups inside — live
// pagination inputs, dropdowns, the selection-aware Clear — never double-mount.
//
// How the measuring stays stable: natural widths are cached per child while it
// is inline; the fit is then computed from the cached widths + the container
// width in a single deterministic pass (reserving room for the "⋮" button when
// anything overflows), so moving a child into the menu never changes the
// measurement and loops.

type Props = {
  children: React.ReactNode
  className?: string
}

const GAP = 8 // matches the container's gap-2
const MORE_WIDTH = 44 // the "⋮" button's footprint incl. its own gap

export default function OverflowGroups({ children, className = '' }: Props) {
  const items = React.useMemo(
    () => React.Children.toArray(children),
    [children],
  )
  const containerRef = React.useRef<HTMLDivElement>(null)
  const itemRefs = React.useRef<(HTMLDivElement | null)[]>([])
  const widthsRef = React.useRef<number[]>([])
  const [visibleCount, setVisibleCount] = React.useState(items.length)
  const [menuOpen, setMenuOpen] = React.useState(false)
  const moreRef = React.useRef<HTMLButtonElement>(null)
  const menuRef = React.useRef<HTMLDivElement>(null)
  const [menuPos, setMenuPos] = React.useState<{
    left: number
    top: number
  } | null>(null)

  const recompute = React.useCallback(() => {
    const container = containerRef.current
    if (!container) return
    // Refresh cached widths for whatever is currently inline.
    const shown = Math.min(visibleCount, items.length)
    for (let i = 0; i < shown; i++) {
      const el = itemRefs.current[i]
      if (el && el.offsetWidth) widthsRef.current[i] = el.offsetWidth
    }
    const widths = widthsRef.current
    const avail = container.clientWidth
    if (!avail) return

    let total = 0
    for (let i = 0; i < items.length; i++) {
      total += (widths[i] ?? 0) + (i > 0 ? GAP : 0)
    }

    let next: number
    if (total <= avail) {
      next = items.length // everything fits — no "⋮".
    } else {
      let used = 0
      let count = 0
      for (let i = 0; i < items.length; i++) {
        const add = (widths[i] ?? 0) + (count > 0 ? GAP : 0)
        if (used + add + GAP + MORE_WIDTH <= avail) {
          used += add
          count++
        } else break
      }
      next = count
    }
    setVisibleCount((prev) => (prev === next ? prev : next))
  }, [items.length, visibleCount])

  React.useLayoutEffect(() => {
    recompute()
    const container = containerRef.current
    if (!container) return
    const ro = new ResizeObserver(() => recompute())
    ro.observe(container)
    return () => ro.disconnect()
  }, [recompute])

  // Any change in child count invalidates cached widths / positions.
  React.useEffect(() => {
    widthsRef.current.length = items.length
    setVisibleCount(items.length)
  }, [items.length])

  const overflow = items.slice(Math.min(visibleCount, items.length))

  // Position + outside-close for the "⋮" popup (portaled to escape any clipping).
  React.useLayoutEffect(() => {
    if (!menuOpen) {
      setMenuPos(null)
      return
    }
    const place = () => {
      const t = moreRef.current?.getBoundingClientRect()
      if (!t) return
      const width = menuRef.current?.offsetWidth ?? 220
      let left = t.right - width
      if (left < 8) left = 8
      setMenuPos({ left, top: t.bottom + 6 })
    }
    place()
    const onScroll = () => place()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [menuOpen, overflow.length])

  React.useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (moreRef.current?.contains(target)) return
      if (menuRef.current?.contains(target)) return
      setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  // Overflow disappeared (e.g. widened) → make sure the menu isn't left open.
  React.useEffect(() => {
    if (!overflow.length && menuOpen) setMenuOpen(false)
  }, [overflow.length, menuOpen])

  return (
    <div
      ref={containerRef}
      className={`flex min-w-0 items-center gap-2 ${className}`.trim()}
    >
      {items.map((child, i) =>
        i < visibleCount ? (
          <div
            key={i}
            ref={(el) => {
              itemRefs.current[i] = el
            }}
            className="shrink-0"
          >
            {child}
          </div>
        ) : null,
      )}

      {overflow.length ? (
        <button
          ref={moreRef}
          type="button"
          className="icon-btn shrink-0 border border-slate-300 text-slate-600 sm:hover:bg-slate-100"
          aria-label="More actions"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="More actions"
          onClick={() => setMenuOpen((v) => !v)}
        >
          <MoreHorizontal size={18} />
        </button>
      ) : null}

      {menuOpen && overflow.length
        ? createPortal(
            <div
              ref={menuRef}
              data-popover-portal=""
              className="fixed z-[100] flex max-w-[90vw] flex-col items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 pt-4 shadow-lg"
              style={{
                left: menuPos?.left ?? -9999,
                top: menuPos?.top ?? -9999,
                visibility: menuPos ? 'visible' : 'hidden',
              }}
            >
              {overflow}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
