import React from 'react'

// Hand-rolled pointer dragging for ROW reordering — the row-gutter twin of
// `useColumnDrag`. Rows are a FLAT list, so there is no tree / scope math: the
// dragged row lands BEFORE some data index (or at the very end), and that is the
// whole model. Feedback (a drop line + a dimmed source row) is driven through
// React state rather than an imperative floating preview, which keeps this file
// small; state only changes when the drop boundary actually crosses, so a drag
// costs one re-render per boundary, not one per pixel.

const DRAG_THRESHOLD = 4

// Read fresh from the media query (never cached) so toggling the OS setting
// between drags is respected. When true the drop line does not tween.
const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * The permutation a single move produces, as `oldIndex -> newIndex`.
 *
 * Both the data/formula remap (App) and the row-height remap (CustomTable) must
 * agree on exactly where every row ends up, so the splice lives here once and is
 * shared. `to` is the ORIGINAL index the dragged row is inserted BEFORE, in the
 * range `0..n` (`n` = append at the end).
 */
export function buildRowPermutation(
  n: number,
  from: number,
  to: number,
): number[] {
  const order = Array.from({ length: n }, (_, i) => i)
  const [moved] = order.splice(from, 1)
  // After removing `from`, every original index above it shifts down by one, so
  // an insert target past it is off by one.
  const insertAt = to > from ? to - 1 : to
  order.splice(insertAt, 0, moved)
  const oldToNew = new Array<number>(n)
  order.forEach((oldIndex, newIndex) => {
    oldToNew[oldIndex] = newIndex
  })
  return oldToNew
}

// Geometry of the drop line, in the scroll container's CONTENT coordinates so it
// rides with vertical scroll and spans the full (possibly wider) table.
export type RowDropIndicator = { top: number; width: number }

export type RowDragApi = {
  onRowPointerDown: (
    dataRowIndex: number,
    event: React.PointerEvent<HTMLElement>,
  ) => void
  // The DATA index the dragged row would land BEFORE, `'end'` for after the last
  // row, or `null` when no drag is in progress.
  dropBeforeIndex: number | 'end' | null
  // DATA index of the row currently held, or `null`.
  draggingIndex: number | null
  // Where to paint the 2px drop line, or `null` when idle.
  indicator: RowDropIndicator | null
  // Snapshot of the reduced-motion preference for the caller's own transitions.
  reduceMotion: boolean
}

export function useRowDrag(options: {
  // False when the visible order would not match the underlying array (sorted /
  // grouped / filtered / multi-page), so a reorder cannot be trusted.
  enabled: boolean
  // Commit: move the row at `fromDataIndex` to sit before `toDataIndex`
  // (`toDataIndex === row count` means append at the end).
  onReorder: (fromDataIndex: number, toDataIndex: number) => void
}): RowDragApi {
  const { enabled, onReorder } = options

  const [draggingIndex, setDraggingIndex] = React.useState<number | null>(null)
  const [dropBeforeIndex, setDropBeforeIndex] = React.useState<
    number | 'end' | null
  >(null)
  const [indicator, setIndicator] = React.useState<RowDropIndicator | null>(null)

  // Kept in refs so the window listeners a drag installs always see the latest
  // callback / gate without re-subscribing.
  const onReorderRef = React.useRef(onReorder)
  onReorderRef.current = onReorder
  const enabledRef = React.useRef(enabled)
  enabledRef.current = enabled

  const onRowPointerDown = React.useCallback(
    (dataRowIndex: number, event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return
      if (!enabledRef.current || dataRowIndex < 0) return
      // The row-height grip at the gutter's BOTTOM edge owns its own pointer —
      // a pointerdown there resizes, never reorders.
      const downTarget = event.target as HTMLElement | null
      if (downTarget?.closest('[data-resize-handle]')) return

      const gutterCell = event.currentTarget
      const tableEl = gutterCell.closest('table') as HTMLTableElement | null
      if (!tableEl) return
      const scroller = gutterCell.closest(
        '[data-row-drag-scroll]',
      ) as HTMLElement | null

      const pointerId = event.pointerId
      const startX = event.clientX
      const startY = event.clientY

      let active = false
      // Latest destination, read at drop. `pendingTo` is an index into the
      // ORIGINAL array (0..count).
      let pendingTo: number | null = null
      // Last committed boundary, so state is only written when it changes.
      let lastBefore: number | 'end' | undefined

      const computeDrop = (clientY: number) => {
        // Re-measure every move so a scroll mid-drag can't leave stale rects.
        const rows = Array.from(
          tableEl.querySelectorAll<HTMLTableRowElement>(
            'tbody tr[data-data-index]',
          ),
        )
          .map((tr) => {
            const idx = Number(tr.getAttribute('data-data-index'))
            const r = tr.getBoundingClientRect()
            return { idx, top: r.top, bottom: r.bottom, mid: (r.top + r.bottom) / 2 }
          })
          .filter((b) => b.idx >= 0)
        if (!rows.length) return

        // Land before the first row whose midpoint is at/below the pointer;
        // past them all → the end.
        let before: number | 'end' = 'end'
        let boundaryY = rows[rows.length - 1].bottom
        for (const b of rows) {
          if (clientY < b.mid) {
            before = b.idx
            boundaryY = b.top
            break
          }
        }

        // With drag ENABLED the visible order equals the data order, so data
        // indices run 0..count-1 top to bottom and the target is simply the
        // boundary index (or the count, for the end).
        const count = rows.length
        pendingTo = before === 'end' ? count : before

        if (before === lastBefore) return
        lastBefore = before

        let ind: RowDropIndicator | null = null
        if (scroller) {
          const cRect = scroller.getBoundingClientRect()
          ind = {
            top: boundaryY - cRect.top + scroller.scrollTop,
            width: tableEl.offsetWidth,
          }
        }
        setDropBeforeIndex(before)
        setIndicator(ind)
      }

      const reset = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onCancel)
        window.removeEventListener('keydown', onKey, true)
        if (gutterCell.hasPointerCapture?.(pointerId))
          gutterCell.releasePointerCapture(pointerId)
        setDraggingIndex(null)
        setDropBeforeIndex(null)
        setIndicator(null)
      }

      const finish = (commit: boolean) => {
        const to = pendingTo
        const from = dataRowIndex
        const wasActive = active
        reset()
        // Skip no-op landings: before `from` (its own slot) or before `from + 1`
        // (the slot just below, i.e. staying put) both leave the row in place.
        if (
          commit &&
          wasActive &&
          to != null &&
          to !== from &&
          to !== from + 1
        ) {
          onReorderRef.current(from, to)
        }
      }

      function onMove(moveEvent: PointerEvent) {
        if (moveEvent.pointerId !== pointerId) return
        if (!active) {
          // A few pixels of slack so a plain click still selects the row.
          if (
            Math.abs(moveEvent.clientX - startX) < DRAG_THRESHOLD &&
            Math.abs(moveEvent.clientY - startY) < DRAG_THRESHOLD
          )
            return
          active = true
          setDraggingIndex(dataRowIndex)
        }
        moveEvent.preventDefault()
        computeDrop(moveEvent.clientY)
      }

      function onUp(upEvent: PointerEvent) {
        if (upEvent.pointerId !== pointerId) return
        finish(true)
      }

      function onCancel(cancelEvent: PointerEvent) {
        if (cancelEvent.pointerId !== pointerId) return
        finish(false)
      }

      // Escape cancels the drag and leaves the order untouched.
      function onKey(keyEvent: KeyboardEvent) {
        if (keyEvent.key !== 'Escape' || !active) return
        keyEvent.preventDefault()
        keyEvent.stopPropagation()
        finish(false)
      }

      try {
        gutterCell.setPointerCapture(pointerId)
      } catch {
        // Capture is a nicety — the window listeners do the real work.
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onCancel)
      window.addEventListener('keydown', onKey, true)
    },
    [],
  )

  return {
    onRowPointerDown,
    dropBeforeIndex,
    draggingIndex,
    indicator,
    reduceMotion: prefersReducedMotion(),
  }
}

export default useRowDrag
