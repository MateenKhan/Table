import {
  CellContext,
  Column,
  ColumnDef,
  flexRender,
  RowData,
  Table,
} from '@tanstack/react-table'
import React from 'react'
import {
  ColumnType,
  formatCellValue,
  isAttachmentType,
  TypeOptions,
} from './columnTypes'
import AttachmentCell from './components/AttachmentCell'

// UI-driven column merging.
//
// The column definitions in `tableModels` stay the source of truth and are
// never mutated. Everything the user does in the merge dropdown is recorded as
// a small, serialisable *descriptor*; `buildMergedColumns` folds the list of
// descriptors over the base definitions and hands back the effective column
// tree. That keeps the feature a pure function of state, so `useMemo` alone is
// enough to give `useReactTable` a referentially stable `columns` value.

/* ------------------------------------------------------------- descriptors */

export type MergeSeparator = 'space' | 'comma' | 'dash' | 'newline'

export const SEPARATORS: {
  id: MergeSeparator
  label: string
  // What actually goes between two parts.
  text: string
  // What is drawn between two parts. Empty means "the flex gap is enough".
  glyph: string
}[] = [
  { id: 'space', label: 'Space', text: ' ', glyph: '' },
  { id: 'comma', label: 'Comma', text: ', ', glyph: ',' },
  { id: 'dash', label: 'Dash', text: ' - ', glyph: '-' },
  { id: 'newline', label: 'New line', text: '\n', glyph: '' },
]

const separatorOf = (id: MergeSeparator) =>
  SEPARATORS.find((entry) => entry.id === id) ?? SEPARATORS[0]!

// Mode A: several columns collapse into one derived column.
export type CombineMerge = {
  id: string
  mode: 'combine'
  header: string
  // In the order the user picked them - that is the order they are rendered in.
  columnIds: string[]
  separator: MergeSeparator
}

// Mode B: several contiguous sibling columns gain a shared parent header.
export type GroupMerge = {
  id: string
  mode: 'group'
  header: string
  columnIds: string[]
}

export type ColumnMerge = CombineMerge | GroupMerge

// Deterministic, so the same merge can never be added twice and so the derived
// column keeps its identity (and therefore its width / pin state) across
// re-renders.
const MERGE_STORAGE_KEY = 'tableColumnMerges'

// Descriptors are plain JSON, so they round-trip through localStorage. Anything
// malformed is discarded rather than allowed to break the column tree on boot.
export function loadStoredMerges(): ColumnMerge[] {
  try {
    const raw = window.localStorage.getItem(MERGE_STORAGE_KEY)
    if (!raw) return []

    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    return parsed.filter(
      (entry): entry is ColumnMerge =>
        !!entry &&
        typeof entry.id === 'string' &&
        typeof entry.header === 'string' &&
        (entry.mode === 'combine' || entry.mode === 'group') &&
        Array.isArray(entry.columnIds) &&
        entry.columnIds.length > 1 &&
        entry.columnIds.every((id: unknown) => typeof id === 'string'),
    )
  } catch {
    return []
  }
}

export function storeMerges(merges: ColumnMerge[]) {
  try {
    window.localStorage.setItem(MERGE_STORAGE_KEY, JSON.stringify(merges))
  } catch {
    // Storage blocked or full - merges still work for this session.
  }
}

export const mergeIdFor = (mode: ColumnMerge['mode'], columnIds: string[]) =>
  `${mode === 'combine' ? 'merged' : 'group'}:${columnIds.join('+')}`

/** Add a merge, dropping any existing one that would fight over a column. */
export function withMerge(
  merges: ColumnMerge[],
  next: ColumnMerge,
): ColumnMerge[] {
  const claimed = new Set(next.columnIds)
  return [
    ...merges.filter(
      (merge) =>
        merge.id !== next.id &&
        !merge.columnIds.some((id) => claimed.has(id)),
    ),
    next,
  ]
}

/**
 * Remove a merge. A group merge can be built on top of a combined column, so
 * anything that referenced the removed column has to go with it rather than
 * linger as a descriptor that can never be applied.
 */
export function withoutMerge(
  merges: ColumnMerge[],
  id: string,
): ColumnMerge[] {
  const removed = merges.find((merge) => merge.id === id)
  if (!removed) return merges
  return merges.filter(
    (merge) => merge.id !== id && !merge.columnIds.includes(id),
  )
}

/* --------------------------------------------------- column-def primitives */

type AnyDef<T> = ColumnDef<T, any>

type Accessor<T> = (row: T, index: number) => unknown

const isGroupDef = <T,>(def: AnyDef<T>): boolean =>
  Array.isArray((def as { columns?: unknown[] }).columns)

const childrenOf = <T,>(def: AnyDef<T>): AnyDef<T>[] =>
  (def as { columns?: AnyDef<T>[] }).columns ?? []

// The id TanStack will end up giving this definition.
const defId = <T,>(def: AnyDef<T>): string => {
  const anyDef = def as { id?: string; accessorKey?: string | number }
  return anyDef.id ?? String(anyDef.accessorKey ?? '')
}

// Rebuild the value getter a leaf definition would have had, so a merged column
// can read its sources straight off the original row.
const accessorFor = <T,>(def: AnyDef<T>): Accessor<T> => {
  const anyDef = def as {
    accessorFn?: Accessor<T>
    accessorKey?: string | number
  }
  if (typeof anyDef.accessorFn === 'function') return anyDef.accessorFn
  if (anyDef.accessorKey != null) {
    const path = String(anyDef.accessorKey).split('.')
    return (row) =>
      path.reduce<any>(
        (value, key) => (value == null ? value : value[key]),
        row,
      )
  }
  return () => undefined
}

/* ------------------------------------------------------------ merged cells */

type Source<T> = {
  id: string
  def: AnyDef<T>
  meta: TypeOptions | undefined
  type: ColumnType | undefined
  accessor: Accessor<T>
}

const sourceOf = <T,>(def: AnyDef<T>): Source<T> => {
  const meta = def.meta as TypeOptions | undefined
  return {
    id: defId(def),
    def,
    meta,
    type: meta?.type,
    accessor: accessorFor(def),
  }
}

/**
 * A cell context that looks, to a source column's own renderer, exactly like
 * the one it used to get. The source column no longer exists on the table, but
 * every renderer in this app only reads `id` and `columnDef` off `column`, and
 * `row` / `table` are the real ones - which is what keeps uploads, the
 * lightbox and `updateData` working from inside a merged cell.
 */
const subContext = <T extends RowData>(
  ctx: CellContext<T, unknown>,
  source: Source<T>,
  value: unknown,
): CellContext<T, unknown> =>
  ({
    ...ctx,
    column: { id: source.id, columnDef: source.def } as unknown as Column<
      T,
      unknown
    >,
    getValue: () => value,
    renderValue: () => value,
  }) as CellContext<T, unknown>

type MergedCellProps<T extends RowData> = {
  ctx: CellContext<T, unknown>
  sources: Source<T>[]
  separator: MergeSeparator
}

/**
 * The heart of mode A: the merged cell composes React *nodes*, never strings.
 * Text-ish parts go through the column's own formatter (so a currency column
 * keeps its symbol and decimals); `image` / `file` parts are handed to the
 * source column's own cell renderer - i.e. `AttachmentCell` - so a merged
 * avatar is a real thumbnail rather than `[object Object]`.
 */
export function MergedCell<T extends RowData>({
  ctx,
  sources,
  separator,
}: MergedCellProps<T>) {
  const { glyph } = separatorOf(separator)
  const vertical = separator === 'newline'
  const row = ctx.row
  const original = row.original as T | undefined

  const parts: React.ReactNode[] = []

  sources.forEach((source) => {
    const value =
      original === undefined ? undefined : source.accessor(original, row.index)

    let node: React.ReactNode = null

    if (isAttachmentType(source.type)) {
      // Aggregate rows have no backing data row to upload into, and
      // AttachmentCell already declines to render an affordance for them.
      node = flexRender(
        source.def.cell ?? AttachmentCell,
        subContext(ctx, source, value),
      )
    } else {
      const text = formatCellValue(value, source.meta)
      node = text === '' ? null : <span>{text}</span>
    }

    if (node === null || node === undefined || node === false) return

    if (parts.length && glyph && !vertical) {
      parts.push(
        <span key={`sep-${source.id}`} style={{ color: '#64748b' }}>
          {glyph}
        </span>,
      )
    }

    parts.push(
      <span
        key={source.id}
        style={{ display: 'inline-flex', alignItems: 'center', minWidth: 0 }}
      >
        {node}
      </span>,
    )
  })

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: vertical ? 'column' : 'row',
        alignItems: vertical ? 'flex-start' : 'center',
        flexWrap: vertical ? 'nowrap' : 'wrap',
        gap: vertical ? '0.125rem' : '0.25rem',
        minWidth: 0,
      }}
    >
      {parts}
    </div>
  )
}

/* ------------------------------------------------ building a merged column */

const DEFAULT_COLUMN_WIDTH = 150
const MAX_MERGED_WIDTH = 640

function buildCombinedColumn<T extends RowData>(
  merge: CombineMerge,
  sources: Source<T>[],
): AnyDef<T> {
  const { text } = separatorOf(merge.separator)
  // Attachments contribute a thumbnail, not prose. Feeding `avatar.svg` into
  // sorting and the global-search facets would only add noise, so the text
  // projection ignores them - and a merge made only of attachments is opaque
  // to sorting / filtering / search exactly like `avatar` already is.
  const textSources = sources.filter((source) => !isAttachmentType(source.type))
  const searchable = textSources.length > 0
  const joiner = merge.separator === 'newline' ? ' ' : text

  return {
    id: merge.id,
    header: merge.header,
    footer: (props) => props.column.id,
    size: Math.min(
      MAX_MERGED_WIDTH,
      sources.reduce(
        (total, source) => total + (source.def.size ?? DEFAULT_COLUMN_WIDTH),
        0,
      ),
    ),
    // Sorting, column filtering and global search all run off this text
    // projection of the merged value.
    accessorFn: (row, index) =>
      textSources
        .map((source) =>
          formatCellValue(source.accessor(row, index), source.meta),
        )
        .filter((part) => part !== '')
        .join(joiner),
    cell: (ctx) => (
      <MergedCell ctx={ctx} sources={sources} separator={merge.separator} />
    ),
    enableSorting: searchable,
    enableColumnFilter: searchable,
    enableGlobalFilter: searchable,
    // Grouping by a derived string is rarely what anyone wants and the
    // aggregate row has no source values to compose, so it stays off.
    enableGrouping: false,
    meta: { type: 'text' },
  }
}

/* -------------------------------------------------------- the tree rewrite */

// Document order of every leaf definition, used to decide where a combined
// column lands.
function indexLeaves<T>(
  defs: AnyDef<T>[],
  into = new Map<string, { def: AnyDef<T>; order: number }>(),
) {
  for (const def of defs) {
    if (isGroupDef(def)) {
      indexLeaves(childrenOf(def), into)
      continue
    }
    const id = defId(def)
    if (id && !into.has(id)) into.set(id, { def, order: into.size })
  }
  return into
}

function applyCombineMerges<T extends RowData>(
  base: AnyDef<T>[],
  merges: CombineMerge[],
): AnyDef<T>[] {
  const leaves = indexLeaves(base)

  // id -> merge it disappears into, and id -> merge it should be replaced by.
  const consumed = new Map<string, string>()
  const anchors = new Map<string, AnyDef<T>>()

  for (const merge of merges) {
    const ids = merge.columnIds.filter(
      (id) => leaves.has(id) && !consumed.has(id),
    )
    if (ids.length < 2) continue

    const sources = ids.map((id) => sourceOf(leaves.get(id)!.def))
    // The merged column takes the slot of whichever source came first in the
    // table, so merging keeps the surrounding order recognisable.
    const anchorId = ids.reduce((first, id) =>
      leaves.get(id)!.order < leaves.get(first)!.order ? id : first,
    )

    ids.forEach((id) => consumed.set(id, merge.id))
    anchors.set(anchorId, buildCombinedColumn(merge, sources))
  }

  if (!consumed.size) return base

  const rewrite = (defs: AnyDef<T>[]): AnyDef<T>[] => {
    const next: AnyDef<T>[] = []

    for (const def of defs) {
      if (isGroupDef(def)) {
        const children = rewrite(childrenOf(def))
        // A group whose every child was merged away elsewhere would render as
        // an empty header cell, so it goes too.
        if (children.length) next.push({ ...def, columns: children } as AnyDef<T>)
        continue
      }

      const id = defId(def)
      const anchor = anchors.get(id)
      if (anchor) {
        next.push(anchor)
        continue
      }
      if (consumed.has(id)) continue
      next.push(def)
    }

    return next
  }

  return rewrite(base)
}

function applyGroupMerges<T extends RowData>(
  base: AnyDef<T>[],
  merges: GroupMerge[],
): AnyDef<T>[] {
  if (!merges.length) return base

  const rewrite = (defs: AnyDef<T>[]): AnyDef<T>[] => {
    // Depth first, so a merge only ever sees settled sibling positions.
    let next: AnyDef<T>[] = defs.map((def) =>
      isGroupDef(def)
        ? ({ ...def, columns: rewrite(childrenOf(def)) } as AnyDef<T>)
        : def,
    )

    for (const merge of merges) {
      const positions = merge.columnIds.map((id) =>
        next.findIndex((def) => defId(def) === id),
      )
      // Not all here: the members live at some other level (or one of them was
      // combined away). Either way this is not the level to rewrite.
      if (positions.some((position) => position < 0)) continue

      const from = Math.min(...positions)
      const to = Math.max(...positions)
      // A spanning header only means anything over contiguous siblings. The UI
      // will not offer an invalid set, and if one arrives anyway it is dropped
      // rather than turned into a broken header tree.
      if (to - from + 1 !== positions.length) continue

      next = [
        ...next.slice(0, from),
        {
          id: merge.id,
          header: merge.header,
          footer: (props) => props.column.id,
          columns: next.slice(from, to + 1),
        } as AnyDef<T>,
        ...next.slice(to + 1),
      ]
    }

    return next
  }

  return rewrite(base)
}

/**
 * Base definitions + active merges -> the effective column tree. Combines run
 * first so a spanning header can be built over a column that a combine merge
 * produced.
 */
export function buildMergedColumns<T extends RowData>(
  base: AnyDef<T>[],
  merges: ColumnMerge[],
): AnyDef<T>[] {
  if (!merges.length) return base

  const combined = applyCombineMerges(
    base,
    merges.filter((merge): merge is CombineMerge => merge.mode === 'combine'),
  )

  return applyGroupMerges(
    combined,
    merges.filter((merge): merge is GroupMerge => merge.mode === 'group'),
  )
}

/** Every column id the effective tree still contains, for pruning table state. */
export function collectColumnIds<T>(defs: AnyDef<T>[], into = new Set<string>()) {
  for (const def of defs) {
    const id = defId(def)
    if (id) into.add(id)
    if (isGroupDef(def)) collectColumnIds(childrenOf(def), into)
  }
  return into
}

/* -------------------------------------------------------- picker meta-data */

// One selectable column in the merge dropdown, carrying enough of its position
// in the effective tree to police mode B's contiguity rule.
export type MergeCandidate = {
  id: string
  label: string
  // '' for a column that sits at the root of the tree.
  parentId: string
  parentLabel: string
  // Position among *all* of its siblings, groups included.
  index: number
}

const labelOfColumn = <T extends RowData>(column: Column<T, unknown>) => {
  const header = column.columnDef.header
  return typeof header === 'string' ? header : column.id
}

/**
 * The leaf columns the user may merge, read off the live table so the picker
 * always reflects the *effective* tree (merged columns included, columns that
 * were merged away excluded).
 */
export function mergeCandidates<T extends RowData>(
  table: Table<T>,
  skip: string[] = [],
): MergeCandidate[] {
  const skipped = new Set(skip)
  const out: MergeCandidate[] = []

  const walk = (
    columns: Column<T, unknown>[],
    parentId: string,
    parentLabel: string,
  ) => {
    columns.forEach((column, index) => {
      if (column.columns.length) {
        walk(column.columns, column.id, labelOfColumn(column))
        return
      }
      if (skipped.has(column.id)) return
      out.push({
        id: column.id,
        label: labelOfColumn(column),
        parentId,
        parentLabel,
        index,
      })
    })
  }

  walk(table.getAllColumns(), '', '')
  return out
}

/**
 * Mode B's rule: a spanning header may only cover 2+ columns that are siblings
 * of one another and occupy neighbouring slots under that parent.
 */
export function isSpannableSelection(selected: MergeCandidate[]): boolean {
  if (selected.length < 2) return false

  const parentId = selected[0]!.parentId
  if (selected.some((candidate) => candidate.parentId !== parentId))
    return false

  const positions = selected.map((candidate) => candidate.index)
  const from = Math.min(...positions)
  const to = Math.max(...positions)
  return to - from + 1 === positions.length
}
