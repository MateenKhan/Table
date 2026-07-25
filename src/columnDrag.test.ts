/**
 * Rules for drag-and-drop column reordering.
 *
 * `columnOrder` is flat, the header tree is not. Everything here checks that
 * the tree math in `columnDrag.ts` only ever produces legal moves and that a
 * legal move translates into the right flat permutation.
 *
 * Run: npx vitest run src/columnDrag.test.ts
 */
// `vitest` is the test runner (`npx vitest run`), not a project dependency, so
// it is absent from node_modules and `tsc` cannot resolve it. Suppress the
// module-not-found here (harmless if vitest is ever installed); vitest supplies
// the real module at runtime.
// @ts-ignore -- vitest resolved at runtime, not a typecheck-time dependency
import { expect, test } from 'vitest'
import { columns } from './tableModels'

import {
  canDragColumn,
  canDropBefore,
  ColumnNode,
  flattenLeafIds,
  orderTree,
  planShift,
  Rect,
  reorderColumnOrder,
  resolveDrop,
  settleDurationMs,
  slotForPointer,
  transformTransition,
} from './columnDrag'

type AnyDef = {
  id?: string
  header?: unknown
  accessorKey?: string
  columns?: AnyDef[]
}

// Same id derivation TanStack uses, which is what keeps this test honest about
// the real header tree rather than a hand-written fixture.
const defId = (def: AnyDef): string =>
  def.id ?? def.accessorKey ?? (typeof def.header === 'string' ? def.header : '')

const toTree = (defs: AnyDef[]): ColumnNode[] =>
  defs.map((def) =>
    def.columns?.length
      ? { id: defId(def), children: toTree(def.columns) }
      : { id: defId(def) },
  )

const tree = toTree(columns as AnyDef[])
const order = flattenLeafIds(tree)

let failures = 0

function check(label: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`  ok   ${label}`)
  } else {
    failures++
    console.log(`  FAIL ${label}${detail ? `  ->  ${detail}` : ''}`)
  }
}

const same = (a: unknown[] | null, b: unknown[]) =>
  !!a && a.length === b.length && a.every((value, i) => value === b[i])

/* ------------------------------------------------- the tree we are testing */

check(
  'header tree reads as [select, Name, Info]',
  same(
    tree.map((node) => node.id),
    ['select', 'Name', 'Info'],
  ),
  tree.map((node) => node.id).join(', '),
)

check(
  'baseline flat order',
  same(order, [
    'select',
    'avatar',
    'firstName',
    'lastName',
    'fullName',
    'age',
    'visits',
    'status',
    'progress',
    'salary',
    'attachment',
  ]),
  order.join(', '),
)

/* ----------------------------------------- 1. a legal move within a group */

check(
  'firstName may be dropped before avatar (same parent)',
  canDropBefore(tree, 'firstName', 'avatar'),
)

check(
  'moving firstName before avatar only reorders inside Name',
  same(reorderColumnOrder(tree, order, 'firstName', 'avatar'), [
    'select',
    'firstName',
    'avatar',
    'lastName',
    'fullName',
    'age',
    'visits',
    'status',
    'progress',
    'salary',
    'attachment',
  ]),
  String(reorderColumnOrder(tree, order, 'firstName', 'avatar')),
)

check(
  'avatar may be dropped at the end of Name (beforeId = null)',
  same(reorderColumnOrder(tree, order, 'avatar', null), [
    'select',
    'firstName',
    'lastName',
    'fullName',
    'avatar',
    'age',
    'visits',
    'status',
    'progress',
    'salary',
    'attachment',
  ]),
  String(reorderColumnOrder(tree, order, 'avatar', null)),
)

check(
  'status may be reordered inside More Info',
  same(reorderColumnOrder(tree, order, 'status', 'visits'), [
    'select',
    'avatar',
    'firstName',
    'lastName',
    'fullName',
    'age',
    'status',
    'visits',
    'progress',
    'salary',
    'attachment',
  ]),
  String(reorderColumnOrder(tree, order, 'status', 'visits')),
)

/* --------------------------------------- 2. a cross-group move is rejected */

check(
  'firstName may NOT be dropped before age (different group)',
  !canDropBefore(tree, 'firstName', 'age'),
)

check(
  'firstName -> age yields no reordering at all',
  reorderColumnOrder(tree, order, 'firstName', 'age') === null,
)

check(
  'visits may NOT escape More Info into Name',
  !canDropBefore(tree, 'visits', 'lastName') &&
    reorderColumnOrder(tree, order, 'visits', 'lastName') === null,
)

check(
  'age may NOT be dropped inside More Info',
  !canDropBefore(tree, 'age', 'status'),
)

check(
  'a leaf may not be dropped before a group it is not a sibling of',
  !canDropBefore(tree, 'firstName', 'More Info'),
)

/* ------------------------------------------------- 3. moving a group block */

check(
  'Name moves as one block to the end of the root level',
  same(reorderColumnOrder(tree, order, 'Name', null), [
    'select',
    'age',
    'visits',
    'status',
    'progress',
    'salary',
    'attachment',
    'avatar',
    'firstName',
    'lastName',
    'fullName',
  ]),
  String(reorderColumnOrder(tree, order, 'Name', null)),
)

check(
  'Info moves as one block in front of Name',
  same(reorderColumnOrder(tree, order, 'Info', 'Name'), [
    'select',
    'age',
    'visits',
    'status',
    'progress',
    'salary',
    'attachment',
    'avatar',
    'firstName',
    'lastName',
    'fullName',
  ]),
  String(reorderColumnOrder(tree, order, 'Info', 'Name')),
)

check(
  'More Info moves as one block in front of its sibling age',
  same(reorderColumnOrder(tree, order, 'More Info', 'age'), [
    'select',
    'avatar',
    'firstName',
    'lastName',
    'fullName',
    'visits',
    'status',
    'progress',
    'salary',
    'attachment',
    'age',
  ]),
  String(reorderColumnOrder(tree, order, 'More Info', 'age')),
)

check(
  'a group may NOT be dropped among another group’s children',
  !canDropBefore(tree, 'More Info', 'firstName') &&
    !canDropBefore(tree, 'Name', 'age'),
)

/* --------------------------------------------------- 4. the select anchor */

check('select is never draggable', !canDragColumn(tree, 'select'))

check(
  'nothing may be dropped in front of select',
  !canDropBefore(tree, 'Name', 'select') &&
    !canDropBefore(tree, 'Info', 'select'),
)

check(
  'Name -> before select yields no reordering at all',
  reorderColumnOrder(tree, order, 'Name', 'select') === null,
)

check(
  'select stays at index 0 after every legal root-level move',
  reorderColumnOrder(tree, order, 'Name', null)?.[0] === 'select' &&
    reorderColumnOrder(tree, order, 'Info', 'Name')?.[0] === 'select',
)

check('Name and Info are draggable', canDragColumn(tree, 'Name') && canDragColumn(tree, 'Info'))

/* ------------------------------------------------ round-tripping the order */

const moved = reorderColumnOrder(tree, order, 'Info', 'Name')!
const movedTree = orderTree(tree, moved)

check(
  'orderTree folds a committed flat order back into the tree',
  same(
    movedTree.map((node) => node.id),
    ['select', 'Info', 'Name'],
  ),
  movedTree.map((node) => node.id).join(', '),
)

check(
  'the folded tree flattens back to the order it came from',
  same(flattenLeafIds(movedTree), moved),
)

check(
  'a move is reversible from the reordered tree',
  same(reorderColumnOrder(movedTree, moved, 'Info', null), order),
  String(reorderColumnOrder(movedTree, moved, 'Info', null)),
)

check(
  'an empty flat order is an identity fold',
  same(
    orderTree(tree, []).map((node) => node.id),
    ['select', 'Name', 'Info'],
  ),
)

/* --------------------------------------------------------- pointer -> slot */

// Three 100px-wide siblings sitting side by side at x = 0, 100, 200.
const rects: Rect[] = [
  { left: 0, right: 100 },
  { left: 100, right: 200 },
  { left: 200, right: 300 },
]

check(
  'slotForPointer counts the resting centres the pointer has passed',
  slotForPointer(rects, 10) === 0 &&
    slotForPointer(rects, 60) === 1 &&
    slotForPointer(rects, 160) === 2 &&
    slotForPointer(rects, 290) === 3,
)

check(
  'a pointer outside the parent block is blocked, not clamped',
  resolveDrop(rects, -20, 0, { left: 0, right: 300 }).blocked &&
    resolveDrop(rects, 400, 0, { left: 0, right: 300 }).blocked,
)

check(
  'a pointer in front of a fixed anchor is blocked',
  resolveDrop(rects, 10, 1, { left: 0, right: 300 }).blocked &&
    !resolveDrop(rects, 160, 1, { left: 0, right: 300 }).blocked,
)

/* ------------------------------------------------------------- the reflow */

// Dragging the sibling that was at index 1 out of a four-wide row; the other
// three keep their resting rects above.
const origin: Rect = { left: 100, right: 200 }

check(
  'dropping right shifts the jumped-over siblings left by the block width',
  same(planShift(rects, origin, 1, 3).offsets, [0, -100, -100]) &&
    planShift(rects, origin, 1, 3).gapLeft === 200,
  JSON.stringify(planShift(rects, origin, 1, 3)),
)

check(
  'dropping left shifts the jumped-over siblings right by the block width',
  same(planShift(rects, origin, 1, 0).offsets, [100, 0, 0]) &&
    planShift(rects, origin, 1, 0).gapLeft === 0,
  JSON.stringify(planShift(rects, origin, 1, 0)),
)

check(
  'dropping back where it started moves nothing',
  same(planShift(rects, origin, 1, 1).offsets, [0, 0, 0]) &&
    planShift(rects, origin, 1, 1).gapLeft === 100,
  JSON.stringify(planShift(rects, origin, 1, 1)),
)

/* ------------------------------------------ motion compliance (§9 helpers) */

check(
  'transformTransition animates transform with the standard ease-in-out curve',
  transformTransition(false) === 'transform 180ms cubic-bezier(0.2, 0, 0, 1)',
  transformTransition(false),
)

check(
  'transformTransition never uses linear or a hard cut when motion is allowed',
  !/linear/.test(transformTransition(false)) &&
    transformTransition(false) !== 'none',
  transformTransition(false),
)

check(
  'transformTransition disables the transition under reduced motion',
  transformTransition(true) === 'none',
  transformTransition(true),
)

check(
  'settleDurationMs stays in the 120-200ms band, and snaps to 0 when reduced',
  settleDurationMs(false) === 180 &&
    settleDurationMs(false) >= 120 &&
    settleDurationMs(false) <= 200 &&
    settleDurationMs(true) === 0,
  `${settleDurationMs(false)} / ${settleDurationMs(true)}`,
)

const total = 34

console.log(
  failures === 0
    ? `\ncolumnDrag: ${total} passed, 0 failed`
    : `\ncolumnDrag: ${failures} FAILED`,
)

// Exposed as a vitest suite so `npx vitest run` finds a test to collect; the
// script-style `check()` calls above have already run at import and tallied
// into `failures`.
test('columnDrag: all rules and motion helpers pass', () => {
  expect(failures).toBe(0)
})
