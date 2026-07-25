import { Column, RowData, Table } from '@tanstack/react-table'
import React from 'react'
import { flushSync } from 'react-dom'
import {
  canDragColumn,
  ColumnNode,
  findScope,
  isFixedColumnId,
  leafIdsOf,
  minSlotFor,
  orderTree,
  planShift,
  Rect,
  reorderColumnOrder,
  resolveDrop,
  settleDurationMs,
  subtreeIdsOf,
  transformTransition,
  unionRect,
} from './columnDrag'

// Hand-rolled pointer dragging for column reordering.
//
// The rules live in `columnDrag.ts`; this file only measures the DOM, moves
// pixels and commits the result.
//
// Performance note: nothing here goes through React state until the drop.
// The reflow is driven by ONE <style> element whose text is rewritten only
// when the target slot actually changes (a handful of `transform` rules keyed
// on `data-col-id`), and the floating preview is a single `transform` write
// per pointermove. So a drag costs zero re-renders of a 1000-row table.

const DRAG_THRESHOLD = 4
const PREVIEW_ROWS = 6

// Motion timing (durations + the standard ease-in-out curve) and the
// reduced-motion decision all live in `columnDrag.ts` as pure helpers, so this
// file has exactly one source of truth to consult - see `transformTransition`
// / `settleDurationMs` and the §9 note beside them in that file.

/**
 * Does the user want reduced motion RIGHT NOW? Read fresh from the media query
 * (never cached) so toggling the OS setting between drags is respected. This
 * is the JS-side check §9 requires: the injected reflow stylesheet's own
 * `transition:` declarations bypass index.css's global media query, exactly
 * like Framer's rAF transforms, so honoring reduced motion is on us here.
 */
const prefersReducedMotion = (doc: Document): boolean =>
  !!doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches

// Anything in a header that owns the pointer for its own purposes. The resize
// grip is the important one: it must keep resizing and must never start a drag.
const INTERACTIVE = 'button, input, select, textarea, label, a, [data-resize-handle]'

const cssEscape = (value: string) => value.replace(/["\\]/g, '\\$&')

const selectorForIds = (ids: string[]) =>
  ids.map((id) => `[data-col-id="${cssEscape(id)}"]`).join(',')

/* ------------------------------------------------------------ table -> tree */

const toNode = <T,>(column: Column<T, unknown>): ColumnNode =>
  column.columns.length
    ? { id: column.id, children: column.columns.map(toNode) }
    : { id: column.id }

/**
 * The header tree as it currently reads, left to right.
 *
 * `getAllColumns()` is definition order and `getAllLeafColumns()` is the same
 * set with `columnOrder` applied, so folding the second into the first gives
 * the tree the user is looking at - and, unlike `getHeaderGroups()`, it is
 * blind to pinning, which keeps the reorder math independent of it.
 */
export function buildColumnTree<T extends RowData>(
  table: Table<T>,
): ColumnNode[] {
  return orderTree(
    table.getAllColumns().map(toNode),
    table.getAllLeafColumns().map((column) => column.id),
  )
}

/* ------------------------------------------------------------- measurement */

const rectOfElement = (el: Element): Rect => {
  const box = el.getBoundingClientRect()
  return { left: box.left, right: box.right }
}

// Every leaf column owns exactly one <th> in the header, so its width and
// screen position can be read straight off it - which also means pinning,
// horizontal scroll and live resizing are all accounted for for free.
const headerCell = (root: HTMLElement, id: string) =>
  root.querySelector<HTMLElement>(`thead th[data-col-id="${cssEscape(id)}"]`)

/* ------------------------------------------------------------- the preview */

const stripDragAttrs = (el: HTMLElement) => {
  el.removeAttribute('data-col-id')
  el.removeAttribute('data-header-id')
  el.querySelectorAll('[data-col-id], [data-header-id]').forEach((child) => {
    child.removeAttribute('data-col-id')
    child.removeAttribute('data-header-id')
  })
}

/**
 * "The column in your hand": the real header cells plus a few real body cells,
 * cloned out of the live table so the preview is pixel-accurate without this
 * module knowing anything about how a cell renders.
 *
 * Clones lose `data-col-id`, otherwise the reflow stylesheet below would
 * translate and hide the preview along with the source column.
 */
function buildPreview(
  tableEl: HTMLTableElement,
  ids: Set<string>,
  width: number,
): HTMLElement {
  const doc = tableEl.ownerDocument
  const wrap = doc.createElement('div')
  wrap.setAttribute('data-column-drag-preview', '')
  Object.assign(wrap.style, {
    position: 'fixed',
    top: '0px',
    left: '0px',
    zIndex: '9999',
    pointerEvents: 'none',
    width: `${width}px`,
    opacity: '0.92',
    borderRadius: '4px',
    overflow: 'hidden',
    background: 'white',
    boxShadow: '0 12px 28px rgba(15,23,42,0.35)',
    outline: '2px solid #2563eb',
    willChange: 'transform',
  } as Partial<CSSStyleDeclaration>)

  const preview = doc.createElement('table')
  Object.assign(preview.style, {
    borderCollapse: 'separate',
    borderSpacing: '0',
    tableLayout: 'fixed',
    width: `${width}px`,
    background: 'white',
  } as Partial<CSSStyleDeclaration>)

  const copyCell = (cell: HTMLTableCellElement, row: HTMLTableRowElement) => {
    const box = cell.getBoundingClientRect()
    const clone = cell.cloneNode(true) as HTMLTableCellElement
    stripDragAttrs(clone)
    Object.assign(clone.style, {
      // `relative` rather than `static`: the resize grip and the selection
      // overlay inside are absolutely positioned and would otherwise escape.
      position: 'relative',
      left: '',
      right: '',
      top: '',
      zIndex: '',
      boxShadow: '',
      background: 'white',
      width: `${box.width}px`,
      minWidth: `${box.width}px`,
      maxWidth: `${box.width}px`,
      height: `${box.height}px`,
      boxSizing: 'border-box',
    } as Partial<CSSStyleDeclaration>)
    row.appendChild(clone)
  }

  const copySection = (
    source: HTMLTableSectionElement | null,
    target: HTMLTableSectionElement,
    maxRows: number,
  ) => {
    if (!source) return
    for (const sourceRow of Array.from(source.rows).slice(0, maxRows)) {
      const cells = Array.from(sourceRow.cells).filter((cell) => {
        const id = cell.getAttribute('data-col-id')
        return !!id && ids.has(id)
      })
      if (!cells.length) continue
      const row = target.insertRow()
      row.style.height = `${sourceRow.getBoundingClientRect().height}px`
      cells.forEach((cell) => copyCell(cell, row))
    }
  }

  copySection(tableEl.tHead, preview.createTHead(), 32)
  copySection(tableEl.tBodies[0] ?? null, preview.createTBody(), PREVIEW_ROWS)

  wrap.appendChild(preview)
  doc.body.appendChild(wrap)
  return wrap
}

/* ------------------------------------------------------------------- hook */

type ActiveDrag = {
  move: (x: number, y: number) => void
  finish: (commit: boolean) => void
}

export type ColumnDragApi = {
  /** True when this column may be picked up at all. */
  canDrag: (columnId: string) => boolean
  onHeaderPointerDown: (
    columnId: string,
    event: React.PointerEvent<HTMLElement>,
  ) => void
}

export function useColumnDrag<T extends RowData>(
  table: Table<T>,
  tableRef: React.RefObject<HTMLTableElement>,
): ColumnDragApi {
  // One drag at a time, including while the drop animation settles.
  const busyRef = React.useRef(false)

  // Rebuilt every render: ~15 nodes, and it has to track columnOrder /
  // visibility / merges without a dependency list that could go stale.
  const tree = buildColumnTree(table)

  const begin = React.useCallback(
    (columnId: string, startX: number, startY: number): ActiveDrag | null => {
      const tableEl = tableRef.current
      const doc = tableEl?.ownerDocument
      if (!tableEl || !doc) return null

      // Re-checked at every pick-up so a user toggling the OS setting mid-
      // session is honored. When true, every transition below becomes `none`
      // (duration 0) and the settle timeout collapses to 0: the reorder still
      // happens, it just snaps instead of animating.
      const reduceMotion = prefersReducedMotion(doc)
      const settleMs = settleDurationMs(reduceMotion)
      const settleTransition = transformTransition(reduceMotion)

      // Measured fresh at pick-up rather than at render time, so a resize or a
      // scroll that happened in between is already accounted for.
      const liveTree = buildColumnTree(table)
      const scope = findScope(liveTree, columnId)
      if (!scope || !canDragColumn(liveTree, columnId)) return null

      const node = scope.siblings[scope.index]
      if (!node) return null

      const visible = new Set(
        table.getVisibleLeafColumns().map((column) => column.id),
      )
      const rectOf = (candidate: ColumnNode): Rect | null => {
        const rects = leafIdsOf(candidate)
          .filter((id) => visible.has(id))
          .map((id) => headerCell(tableEl, id))
          .filter((el): el is HTMLElement => !!el)
          .map(rectOfElement)
        return rects.length ? unionRect(rects) : null
      }

      const origin = rectOf(node)
      const ownCell = headerCell(tableEl, node.id)
      if (!origin || !ownCell) return null
      const originTop = ownCell.getBoundingClientRect().top

      // Only siblings that are actually on screen can take part in the
      // reflow; hidden ones still ride along in the flat order.
      const others: { node: ColumnNode; rect: Rect }[] = []
      let originIndex = 0
      scope.siblings.forEach((sibling, index) => {
        if (sibling.id === columnId) return
        const rect = rectOf(sibling)
        if (!rect) return
        if (index < scope.index) originIndex++
        others.push({ node: sibling, rect })
      })
      if (!others.length) return null

      const otherRects = others.map((entry) => entry.rect)
      const otherNodes = others.map((entry) => entry.node)
      const minSlot = minSlotFor(otherNodes)
      // Rule 2 made visible: outside the parent block there is no legal slot.
      const bounds = unionRect([origin, ...otherRects])
      const width = origin.right - origin.left

      const subtree = subtreeIdsOf(node)
      const dragSelector = selectorForIds(subtree)
      const preview = buildPreview(tableEl, new Set(subtree), width)

      const grabX = Math.min(Math.max(startX - origin.left, 0), width)
      const previewHeight = preview.getBoundingClientRect().height
      const grabY = Math.min(Math.max(startY - originTop, 0), previewHeight)

      const styleEl = doc.createElement('style')
      styleEl.setAttribute('data-column-drag', '')
      doc.head.appendChild(styleEl)

      const base = [
        `[data-col-id]{transition:${settleTransition}}`,
        'body{cursor:grabbing!important;user-select:none!important}',
        // The source column stays in the flow (so nothing else has to relayout)
        // but reads as an empty slot: hatched, with every child hidden.
        `${dragSelector}{background-image:repeating-linear-gradient(45deg,#eef2f7,#eef2f7 6px,#dfe6ef 6px,#dfe6ef 12px)!important}`,
        `${dragSelector} *{visibility:hidden!important}`,
      ].join('\n')

      let slot = originIndex
      let blocked = false
      let gapLeft = origin.left
      let painted = ''

      const paint = () => {
        const parts = [base]
        if (blocked) {
          parts.push('body{cursor:not-allowed!important}')
          gapLeft = origin.left
        } else {
          const plan = planShift(otherRects, origin, originIndex, slot)
          gapLeft = plan.gapLeft
          plan.offsets.forEach((dx, index) => {
            if (!dx) return
            parts.push(
              `${selectorForIds(subtreeIdsOf(otherNodes[index]!))}{transform:translateX(${dx}px)}`,
            )
          })
        }
        parts.push(
          `${dragSelector}{transform:translateX(${gapLeft - origin.left}px)}`,
        )

        const next = parts.join('\n')
        // Rewriting the sheet is the only per-frame layout cost, so skip it
        // whenever the pointer moved without changing the outcome.
        if (next === painted) return
        painted = next
        styleEl.textContent = next
      }

      const place = (x: number, y: number, settle = false) => {
        // `settleTransition` is `none` under reduced motion, so the settle is
        // an instant snap rather than a tween.
        preview.style.transition = settle ? settleTransition : ''
        preview.style.transform = `translate3d(${x}px,${y}px,0) scale(${
          settle ? 1 : 1.02
        })`
      }

      place(startX - grabX, startY - grabY)
      paint()

      return {
        move: (x, y) => {
          place(x - grabX, y - grabY)
          const drop = resolveDrop(otherRects, x, minSlot, bounds)
          // A blocked pointer keeps the slot it last had, so stepping back
          // inside the parent re-opens the same gap rather than a new one.
          const nextSlot = drop.blocked ? slot : drop.slot
          if (drop.blocked === blocked && nextSlot === slot) return
          blocked = drop.blocked
          slot = nextSlot
          paint()
        },
        finish: (commit) => {
          const landed = commit && !blocked
          const targetLeft = landed ? gapLeft : origin.left
          place(targetLeft, originTop, true)

          const beforeId = others[slot]?.node.id ?? null
          const order = landed
            ? reorderColumnOrder(
                liveTree,
                table.getAllLeafColumns().map((column) => column.id),
                columnId,
                beforeId,
              )
            : null

          doc.defaultView?.setTimeout(() => {
            // flushSync so the new order and the removal of the reflow sheet
            // land in the same frame - otherwise the table would flash back
            // through its un-shifted layout.
            if (order) flushSync(() => table.setColumnOrder(order))
            styleEl.remove()
            preview.remove()
            busyRef.current = false
          }, settleMs)
        },
      }
    },
    [table, tableRef],
  )

  const onHeaderPointerDown = React.useCallback(
    (columnId: string, event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0 || busyRef.current) return
      const target = event.target as HTMLElement | null
      // Never swallow the pointer from the resize grip or a header button.
      // No preventDefault happens on this path either, so their own mouse
      // handlers still see the compatibility events they expect.
      if (!target || target.closest(INTERACTIVE)) return
      if (!canDragColumn(tree, columnId)) return

      const el = event.currentTarget
      const pointerId = event.pointerId
      const startX = event.clientX
      const startY = event.clientY
      const box: { active: ActiveDrag | null } = { active: null }

      const detach = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        window.removeEventListener('pointercancel', onCancel)
        window.removeEventListener('keydown', onKey, true)
        if (el.hasPointerCapture?.(pointerId)) el.releasePointerCapture(pointerId)
      }

      function onMove(this: unknown, moveEvent: PointerEvent) {
        if (moveEvent.pointerId !== pointerId) return
        let active = box.active
        if (!active) {
          // A few pixels of slack, so a plain click on the header (sort,
          // group) is never mistaken for a drag.
          if (
            Math.abs(moveEvent.clientX - startX) < DRAG_THRESHOLD &&
            Math.abs(moveEvent.clientY - startY) < DRAG_THRESHOLD
          )
            return
          active = begin(columnId, startX, startY)
          box.active = active
          if (!active) {
            detach()
            return
          }
          busyRef.current = true
        }
        moveEvent.preventDefault()
        active.move(moveEvent.clientX, moveEvent.clientY)
      }

      function onUp(this: unknown, upEvent: PointerEvent) {
        if (upEvent.pointerId !== pointerId) return
        detach()
        box.active?.finish(true)
      }

      function onCancel(this: unknown, cancelEvent: PointerEvent) {
        if (cancelEvent.pointerId !== pointerId) return
        detach()
        box.active?.finish(false)
      }

      // Escape animates the column back where it came from.
      function onKey(this: unknown, keyEvent: KeyboardEvent) {
        if (keyEvent.key !== 'Escape') return
        if (!box.active) return
        keyEvent.preventDefault()
        keyEvent.stopPropagation()
        detach()
        box.active.finish(false)
      }

      try {
        el.setPointerCapture(pointerId)
      } catch {
        // Capture is a nicety - the window listeners below do the real work.
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      window.addEventListener('pointercancel', onCancel)
      window.addEventListener('keydown', onKey, true)
    },
    [begin, tree],
  )

  const canDrag = React.useCallback(
    (columnId: string) => !isFixedColumnId(columnId) && canDragColumn(tree, columnId),
    [tree],
  )

  return { canDrag, onHeaderPointerDown }
}

export default useColumnDrag
