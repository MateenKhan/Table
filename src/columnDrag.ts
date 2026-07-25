// Tree math for drag-and-drop column reordering.
//
// TanStack's `columnOrder` is a FLAT array of leaf column ids with no notion of
// groups, but the header tree here is three levels deep and a column may only
// ever move among its own siblings. This module is the translation layer: it
// models the header tree as plain `ColumnNode`s, decides which moves are legal,
// and turns a legal move back into the flat permutation TanStack wants.
//
// It deliberately imports NOTHING - not React, not @tanstack/react-table - so
// every rule below is unit-testable outside a browser. The React side
// (`useColumnDrag.ts`) is responsible only for measuring the DOM and driving
// the animation; every decision it makes comes from here.

export type ColumnNode = {
  id: string
  // Absent / empty means "leaf column". Group columns carry their children in
  // the order they are currently rendered in.
  children?: ColumnNode[]
}

// The leading checkbox column is a fixed anchor: it is never picked up, and
// nothing may be dropped in front of it.
export const FIXED_LEADING_COLUMN_IDS = ['select']

export const isFixedColumnId = (id: string): boolean =>
  FIXED_LEADING_COLUMN_IDS.includes(id)

/* --------------------------------------------------------------- tree walks */

/** Leaf ids under `node`, in tree order. A leaf yields itself. */
export function leafIdsOf(node: ColumnNode, into: string[] = []): string[] {
  if (node.children?.length) {
    for (const child of node.children) leafIdsOf(child, into)
  } else {
    into.push(node.id)
  }
  return into
}

/** Every id in the subtree, group ids included. Used to build CSS selectors. */
export function subtreeIdsOf(node: ColumnNode, into: string[] = []): string[] {
  into.push(node.id)
  if (node.children?.length) {
    for (const child of node.children) subtreeIdsOf(child, into)
  }
  return into
}

/** Leaf ids of a whole forest, in tree order. */
export const flattenLeafIds = (nodes: ColumnNode[]): string[] =>
  nodes.flatMap((node) => leafIdsOf(node))

export type SiblingScope = {
  // null when the node sits at the root of the header tree.
  parentId: string | null
  siblings: ColumnNode[]
  index: number
}

/**
 * Where `id` sits in the tree: its parent, the sibling list it belongs to and
 * its position in that list. `null` when the id is not in the tree at all.
 *
 * This is the whole of rule 2 and rule 3: a drag never sees anything outside
 * `siblings`, so a leaf can only ever be reordered among its own siblings and
 * a group header can only ever move as one block among its own siblings.
 */
export function findScope(
  nodes: ColumnNode[],
  id: string,
  parentId: string | null = null,
): SiblingScope | null {
  const index = nodes.findIndex((node) => node.id === id)
  if (index >= 0) return { parentId, siblings: nodes, index }

  for (const node of nodes) {
    if (!node.children?.length) continue
    const found = findScope(node.children, id, node.id)
    if (found) return found
  }
  return null
}

/**
 * Re-sort every level of `nodes` to match a flat leaf order - i.e. fold
 * TanStack's `columnOrder` back into the tree. A node ranks by its earliest
 * leaf; nodes whose leaves are all absent from `order` keep their relative
 * position, so an empty `order` is an identity transform.
 */
export function orderTree(nodes: ColumnNode[], order: string[]): ColumnNode[] {
  const rank = new Map<string, number>()
  order.forEach((id, index) => {
    if (!rank.has(id)) rank.set(id, index)
  })

  const rankOf = (node: ColumnNode): number => {
    let best = Number.POSITIVE_INFINITY
    for (const id of leafIdsOf(node)) {
      const value = rank.get(id)
      if (value !== undefined && value < best) best = value
    }
    return best
  }

  const walk = (list: ColumnNode[]): ColumnNode[] =>
    list
      .map((node, index) => ({ node, index, rank: rankOf(node) }))
      // Equal ranks (both Infinity) fall back to the incoming order, which
      // keeps the sort stable across engines.
      .sort((a, b) => (a.rank === b.rank ? a.index - b.index : a.rank - b.rank))
      .map(({ node }) =>
        node.children?.length
          ? { id: node.id, children: walk(node.children) }
          : node,
      )

  return walk(nodes)
}

/* ------------------------------------------------------------ legal moves */

/** Number of fixed anchors at the head of a sibling list. */
const leadingAnchors = (siblings: ColumnNode[]): number => {
  let count = 0
  while (count < siblings.length && isFixedColumnId(siblings[count]!.id)) count++
  return count
}

/**
 * Can this column be picked up at all? `select` never can, and neither can a
 * node with no sibling to trade places with.
 */
export function canDragColumn(nodes: ColumnNode[], id: string): boolean {
  if (isFixedColumnId(id)) return false
  const scope = findScope(nodes, id)
  if (!scope) return false
  // Everything except the node itself and the fixed anchors ahead of it.
  const movable = scope.siblings.filter(
    (node) => node.id !== id && !isFixedColumnId(node.id),
  )
  return movable.length > 0
}

/**
 * Is "drop `dragId` immediately before `beforeId`" a legal move? `beforeId` of
 * `null` means "after the last sibling".
 *
 * Rejects: a fixed anchor being dragged, a target that is not a sibling (the
 * cross-group case), and any position in front of the leading anchors.
 */
export function canDropBefore(
  nodes: ColumnNode[],
  dragId: string,
  beforeId: string | null,
): boolean {
  if (!canDragColumn(nodes, dragId)) return false
  const scope = findScope(nodes, dragId)
  if (!scope) return false
  if (beforeId === dragId) return true

  const others = scope.siblings.filter((node) => node.id !== dragId)
  const slot =
    beforeId === null
      ? others.length
      : others.findIndex((node) => node.id === beforeId)

  // Not a sibling: a leaf trying to enter another group, or a group trying to
  // land inside one. Never legal.
  if (slot < 0) return false
  return slot >= leadingAnchors(others)
}

/**
 * A legal move, expressed as the flat leaf order TanStack wants. `null` when
 * the move is illegal, so a caller can never accidentally commit one.
 *
 * `order` should be the current full flat leaf order (hidden columns
 * included); when it does not cover the tree, the tree's own order is used.
 */
export function reorderColumnOrder(
  nodes: ColumnNode[],
  order: string[],
  dragId: string,
  beforeId: string | null,
): string[] | null {
  if (!canDropBefore(nodes, dragId, beforeId)) return null

  const scope = findScope(nodes, dragId)!
  const dragNode = scope.siblings[scope.index]!
  const block = leafIdsOf(dragNode)
  const blockSet = new Set(block)

  const all = flattenLeafIds(nodes)
  const known = new Set(order)
  const base = all.every((id) => known.has(id)) ? order.slice() : all

  if (beforeId === dragId) return base

  const remaining = base.filter((id) => !blockSet.has(id))

  // Where the block goes, expressed against a sibling that is staying put.
  // Siblings are contiguous runs of leaves, so a single index is enough.
  let insertAt = remaining.length
  if (beforeId === null) {
    const last = [...scope.siblings]
      .reverse()
      .find((node) => node.id !== dragId)
    const positions = last
      ? leafIdsOf(last)
          .map((id) => remaining.indexOf(id))
          .filter((index) => index >= 0)
      : []
    if (positions.length) insertAt = Math.max(...positions) + 1
  } else {
    const target = scope.siblings.find((node) => node.id === beforeId)!
    const positions = leafIdsOf(target)
      .map((id) => remaining.indexOf(id))
      .filter((index) => index >= 0)
    if (positions.length) insertAt = Math.min(...positions)
  }

  return [
    ...remaining.slice(0, insertAt),
    ...block,
    ...remaining.slice(insertAt),
  ]
}

/* --------------------------------------------------------------- geometry */

// Horizontal extent of a column (or of a whole group block) on screen.
export type Rect = { left: number; right: number }

export const unionRect = (rects: Rect[]): Rect => ({
  left: Math.min(...rects.map((rect) => rect.left)),
  right: Math.max(...rects.map((rect) => rect.right)),
})

/**
 * Insertion index for a pointer x, measured against the RESTING positions of
 * the siblings that are not being dragged. Using resting positions (rather
 * than the shifted ones) is what keeps the slot from oscillating as the
 * columns animate.
 */
export function slotForPointer(others: Rect[], x: number): number {
  let slot = 0
  for (const rect of others) {
    if (x < (rect.left + rect.right) / 2) break
    slot++
  }
  return slot
}

export type DropResolution = {
  // -1 when blocked.
  slot: number
  blocked: boolean
}

/**
 * Pointer x -> the slot the drop would land in, or a blocked result.
 *
 * Blocked means the pointer has left the parent block entirely (dragging
 * `firstName` out over `Info`) or has crossed in front of a fixed anchor.
 * Blocked is a visible state during the drag, not a silent snap-back.
 */
export function resolveDrop(
  others: Rect[],
  x: number,
  minSlot: number,
  bounds: Rect,
): DropResolution {
  if (x < bounds.left || x > bounds.right) return { slot: -1, blocked: true }
  const slot = slotForPointer(others, x)
  if (slot < minSlot) return { slot: -1, blocked: true }
  return { slot, blocked: false }
}

/** Fixed anchors that a drop can never get in front of, in `others` space. */
export const minSlotFor = (others: ColumnNode[]): number =>
  leadingAnchors(others)

export type ShiftPlan = {
  // One dx per entry of `others`, same order.
  offsets: number[]
  // Screen x the dragged block's gap opens at.
  gapLeft: number
}

/**
 * The reflow: which of the staying siblings move, how far, and where the hole
 * for the dragged block ends up. Everything is derived from resting rects, so
 * this is a pure function of (geometry, slot) and can be recomputed from
 * scratch on every slot change without drifting.
 */
export function planShift(
  others: Rect[],
  origin: Rect,
  originIndex: number,
  slot: number,
): ShiftPlan {
  const width = origin.right - origin.left

  const offsets = others.map((_, index) => {
    // Siblings the block jumped over on its way right close up behind it.
    if (index >= originIndex && index < slot) return -width
    // ...and on its way left they open up in front of it.
    if (index >= slot && index < originIndex) return width
    return 0
  })

  let gapLeft = origin.left
  if (slot < originIndex) gapLeft = others[slot]!.left
  else if (slot > originIndex) gapLeft = others[slot - 1]!.right - width

  return { offsets, gapLeft }
}

/* ----------------------------------------------------------------- motion */

// Timing for the drag reflow and the drop-into-place settle. Kept here (pure,
// no DOM, no globals) so the reduced-motion + easing decision is a single,
// unit-testable source of truth that `useColumnDrag.ts` consumes.
//
// Motion rules (reduced-motion aware):
//  - `prefers-reduced-motion: reduce` MUST be honored. The transitions below
//    are injected from JS into a <style> element, so they BYPASS index.css's
//    global media query the same way Framer's rAF transforms do (§9's warning).
//    The React side re-reads the media query at drag start and passes the
//    result here; `none` disables the transition so the reorder snaps into
//    place at duration 0 - the move still happens, it just isn't animated.
//  - Ease in AND out, never `linear` and never a hard cut: the "standard"
//    ease-in-out curve is used for every transition.
//  - Durations stay short and snappy (§9's fast/normal band, 120-200ms).

/** Drop-into-place settle duration, in ms. Inside §9's fast/normal band. */
export const SETTLE_MS = 180

/** The "standard" ease-in-out curve (never `linear`, never a hard cut). */
export const STANDARD_EASE = 'cubic-bezier(0.2, 0, 0, 1)'

/**
 * The CSS `transition` value for a dragged / reflowing element's `transform`.
 * With reduced motion requested it becomes `none`, so the element snaps to its
 * target instantly (duration 0) rather than animating.
 */
export function transformTransition(reduceMotion: boolean): string {
  return reduceMotion ? 'none' : `transform ${SETTLE_MS}ms ${STANDARD_EASE}`
}

/**
 * How long to wait before committing the reorder and tearing down the drag
 * chrome: the settle duration normally, but 0 under reduced motion so the drop
 * lands immediately instead of sitting through an animation that never plays.
 */
export const settleDurationMs = (reduceMotion: boolean): number =>
  reduceMotion ? 0 : SETTLE_MS
