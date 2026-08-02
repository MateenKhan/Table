import {
  Cell,
  Column,
  flexRender,
  Header,
  Row,
  RowData,
  Table,
} from '@tanstack/react-table'
import React from 'react'
import { createPortal } from 'react-dom'
import { useCellSelection } from '../useCellSelection'
import { useThumbnailMetrics } from '../thumbnailSize'
import useColumnDrag from '../useColumnDrag'
import useRowDrag, { buildRowPermutation } from '../useRowDrag'
import { alignmentFor } from '../columnTypes'
import {
  columnLetters,
  lettersForColumnId,
  observeLetterColumn,
  NON_DATA_COLUMN_IDS,
} from '../columnOrder'
import {
  Borders,
  resolveFormat,
  useFormatVersion,
} from '../formatting'
import { formulaRefs, useFormulaRefsVersion } from '../formulaRefs'
import { useFindHighlight, findKey } from '../tableFind'
import CellContextStrip from './CellContextPopup'
import { Lock, Plus } from 'lucide-react'

// Applied borders are rendered in TWO layers, because a `border-collapse` grid
// makes plain per-side `<td>` borders unreliable:
//
//  1. On the <td> itself we ONLY emit `none` for an explicitly-`null` side, to
//     punch an intentional gap in the hairline grid. We do NOT draw the user's
//     border here — under `border-collapse` a 1px applied border ties with the
//     neighbour's 1px `border-slate-200` and the CSS tie-break hands the shared
//     edge to the top/left-most cell, so an applied TOP or LEFT hairline would
//     silently lose to its neighbour and never paint (the "not visible" bug).
//
//  2. The drawn sides are painted on a non-collapsing absolute OVERLAY inside
//     the cell (`BorderOverlay`, rendered below). Being a normal positioned
//     box, it is exempt from border-collapse tie-breaking, so every side — all
//     four, at any width incl. hairline, in any style/colour — always shows.
const BORDER_SIDE_PROP = {
  top: 'borderTop',
  right: 'borderRight',
  bottom: 'borderBottom',
  left: 'borderLeft',
} as const

// <td>-layer CSS: clear the grid hairline only where a side is explicitly null.
// Drawn sides are left to the overlay so they don't fight the collapse tie.
function bordersToCellCss(borders?: Borders): React.CSSProperties {
  const css: React.CSSProperties = {}
  if (!borders) return css
  ;(['top', 'right', 'bottom', 'left'] as const).forEach((side) => {
    if (!(side in borders)) return
    if (borders[side] == null) css[BORDER_SIDE_PROP[side]] = 'none'
  })
  return css
}

// Overlay-layer CSS: the actual per-side border for each DRAWN side (skipping
// absent + explicit-null sides). This lands on an absolutely-positioned span, so
// it paints over the hairline grid regardless of border-collapse.
function bordersToOverlayCss(borders?: Borders): React.CSSProperties {
  const css: React.CSSProperties = {}
  if (!borders) return css
  ;(['top', 'right', 'bottom', 'left'] as const).forEach((side) => {
    const value = borders[side]
    if (value == null) return
    css[BORDER_SIDE_PROP[side]] = `${value.width}px ${value.style} ${value.color}`
  })
  return css
}

// True when any side is actually drawn (not just cleared) — gates the overlay.
function hasDrawnBorder(borders?: Borders): boolean {
  if (!borders) return false
  return (['top', 'right', 'bottom', 'left'] as const).some(
    (side) => borders[side] != null,
  )
}

// The per-cell border overlay. Sits at the cell's inner edge, above the content
// and hairline grid (zIndex 1) but BELOW the accent selection decoration
// (zIndex 2/3) so a live selection never hides an applied border for good, and
// `pointerEvents: none` keeps it clear of cell selection / editing.
function BorderOverlay({ borders }: { borders: Borders }) {
  return (
    <span
      aria-hidden="true"
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        zIndex: 1,
        pointerEvents: 'none',
        ...bordersToOverlayCss(borders),
      }}
    />
  )
}

// Width of the leftmost row-number gutter. It lives OUTSIDE TanStack's column
// model, so every left-pinned column has to be pushed right by exactly this much
// (see `shiftedHeaderStyle` / `shiftedCellStyle`) to sit beside it rather than
// under it.
const ROW_NUMBER_WIDTH = 48

/**
 * The Excel coordinate letter shown above a leaf column.
 *
 * This function is BOTH the display rule and the registration point for the
 * formula engine's letter space, and that is the whole point. It used to be
 * only the display rule, with its own fallback: columns the engine knew about
 * got the engine's letter, and everything else — a blank sheet's `col1..colN`,
 * a column added at runtime — got its positional index instead. So the header
 * drew `A B C D E F` over columns `=C2` had never heard of, `=C2+C3` resolved
 * to demo columns that were not there, and the sheet answered 0 with no error.
 *
 * Now the ids stream through `observeLetterColumn` (see `columnOrder.ts`) as
 * they are drawn, which IS how the letter space is built — so what the header
 * shows and what a formula binds cannot disagree; they are the same lookup.
 * `select` and friends carry no data, so they claim no letter and register
 * nothing; `positionalIndex` counts data columns only and survives as a
 * belt-and-braces fallback for a column that somehow reaches here unregistered.
 */
export function letterForColumn(
  columnId: string,
  positionalIndex: number,
): string {
  if (NON_DATA_COLUMN_IDS.includes(columnId)) return ''
  observeLetterColumn(columnId, positionalIndex)
  return lettersForColumnId(columnId) || columnLetters(positionalIndex)
}

// Sticky offsets for a header cell. Headers are used rather than columns so the
// math stays correct for the grouped header rows, where a single cell spans
// several leaf columns.
function getHeaderPinningStyles<T extends RowData>(
  table: Table<T>,
  header: Header<T, unknown>,
  // Omitted for footer cells, which stick horizontally but not vertically.
  top?: number,
): React.CSSProperties {
  const isPinned = header.column.getIsPinned()

  // Header cells are always sticky so they survive vertical scrolling; pinned
  // ones are sticky on both axes at once. Sticky still acts as the containing
  // block for the absolutely positioned resize handle inside.
  return {
    position: 'sticky',
    top,
    left: isPinned === 'left' ? `${header.getStart('left')}px` : undefined,
    right:
      isPinned === 'right'
        ? `${
            table.getRightTotalSize() -
            header.getStart('right') -
            header.getSize()
          }px`
        : undefined,
    width: header.getSize(),
    // Pinned headers must win against both plain headers and pinned body cells.
    zIndex: isPinned ? 4 : 3,
    // Background comes from the `bg-white` class on the <th>. Only the pinned
    // edge shadow stays inline (it depends on which side is pinned); it is a
    // hairline slate, never the old heavy `gray`.
    boxShadow: isPinned
      ? isPinned === 'left'
        ? '-4px 0 4px -4px rgba(148, 163, 184, 0.6) inset'
        : '4px 0 4px -4px rgba(148, 163, 184, 0.6) inset'
      : undefined,
  }
}

// Body cells are always leaf columns, so the column helpers are enough here.
function getCellPinningStyles<T extends RowData>(
  cell: Cell<T, unknown>,
): React.CSSProperties {
  const isPinned = cell.column.getIsPinned()

  // `relative` (and `sticky`, below) make the cell a containing block so the
  // selection overlay and fill handle can be absolutely positioned inside it.
  // `zIndex: 0` also makes the cell its OWN stacking context, which TRAPS the
  // selection decoration (z 2/3) inside the cell — otherwise, with `z-index:
  // auto`, that absolutely-positioned overlay escapes into the shared context
  // and paints OVER the sticky header (z 3) when you scroll a selection up under
  // it. A plain cell then sits at z 0, safely below every sticky header row.
  if (!isPinned) {
    return { position: 'relative', zIndex: 0, width: cell.column.getSize() }
  }

  return {
    position: 'sticky',
    left:
      isPinned === 'left' ? `${cell.column.getStart('left')}px` : undefined,
    right:
      isPinned === 'right' ? `${cell.column.getAfter('right')}px` : undefined,
    width: cell.column.getSize(),
    zIndex: 1,
    // Background comes from the `bg-white` class on the <td>; only the pinned
    // edge shadow (side-dependent) stays inline, recoloured to a hairline slate.
    boxShadow:
      isPinned === 'left'
        ? '-4px 0 4px -4px rgba(148, 163, 184, 0.6) inset'
        : '4px 0 4px -4px rgba(148, 163, 184, 0.6) inset',
  }
}

type Props<T extends RowData> = {
  table: Table<T>
  // When provided, the contextual ops strip is portaled INTO this element (a slot
  // in the actions div) instead of rendered in the table region — so no actions
  // live inside the table. Falls back to an inline strip if absent.
  opsSlot?: HTMLElement | null
  // "Blank sheet" building blocks. Each is optional — its affordance renders only
  // when App wires the handler, so an ordinary (non-blank) table is unchanged.
  onAddRow?: () => void
  onAddColumn?: () => void
  onRenameColumn?: (columnId: string, name: string) => void
  // Selection ops threaded into the contextual strip. Each renders its strip
  // button only when wired: promote a single row to the header, insert a column
  // beside a single selected column, or delete a single selected column.
  onPromoteRowToHeader?: (dataRowIndex: number) => void
  onInsertColumn?: (columnId: string, side: 'left' | 'right') => void
  onDeleteColumn?: (columnId: string) => void
  // Insert a blank row above / below a single selected row.
  onInsertRow?: (dataRowIndex: number, side: 'above' | 'below') => void
  // Remove a single selected row entirely (distinct from clearing its contents).
  onDeleteRow?: (dataRowIndex: number) => void
  // Per-row heights (keyed by data-row index). Controlled: when both are wired
  // the parent owns the map (so it can be exported/cloned); otherwise the table
  // keeps them in local state as before.
  rowHeights?: Record<number, number>
  onRowHeightsChange?: (next: Record<number, number>) => void
  // Font presets threaded into the contextual strip's FORMAT cluster: the size
  // options and the family options. Passed to every strip so any selection can
  // set them.
  fontSizes?: string[]
  fontFamilies?: { label: string; value: string }[]
  // Merge a multi-column selection into one column. Wired into the format-only
  // strip only when two or more columns are selected.
  onMergeColumns?: (columnIds: string[]) => void
  // Reorder the underlying data by dragging a row's number-gutter cell: move the
  // row at `fromDataIndex` to sit before `toDataIndex` (== row count → append).
  // Absent → the gutter stays a plain click-to-select with no drag.
  onReorderRows?: (fromDataIndex: number, toDataIndex: number) => void
}

export function CustomTable<T extends RowData>({
  table,
  opsSlot,
  onAddRow,
  onAddColumn,
  onRenameColumn,
  onPromoteRowToHeader,
  onInsertColumn,
  onDeleteColumn,
  onInsertRow,
  onDeleteRow,
  rowHeights: controlledRowHeights,
  onRowHeightsChange,
  fontSizes,
  fontFamilies,
  onMergeColumns,
  onReorderRows,
}: Props<T>) {
  const selection = useCellSelection()
  // Re-render whenever any scope's colour / alignment changes.
  useFormatVersion()
  // Re-render as the cells referenced by an in-progress formula draft change, so
  // the live reference highlight follows what is being typed.
  useFormulaRefsVersion()
  // Row height follows the thumbnail size control, so image rows can be
  // scanned at L or packed tight at S. Only body cells are touched - header
  // heights are unchanged, so the measured sticky offsets below stay valid.
  const metrics = useThumbnailMetrics()
  // Browser-style find highlight (App owns the query + matches; cells paint).
  const findHl = useFindHighlight()
  const tableRef = React.useRef<HTMLTableElement>(null)
  // Column drag-and-drop. Everything it does between pick-up and drop is
  // imperative (see useColumnDrag), so a drag never re-renders this component.
  const drag = useColumnDrag(table, tableRef)
  // Records the pointer-down position on a header so the click that follows can
  // tell a plain click (select the whole column) from the tail of a drag
  // (reorder — no selection). Shared across headers: only one is ever active.
  const headerClickStart = React.useRef<{ x: number; y: number } | null>(null)
  const theadRef = React.useRef<HTMLTableSectionElement>(null)
  const [headerRowTops, setHeaderRowTops] = React.useState<number[]>([])
  // The full height of the header block (letter row + every grouped header row).
  // Frozen (top-pinned) rows stick just below it, so they need this exact value
  // to avoid a gap / overlap with the last sticky header row.
  const [headerBlockHeight, setHeaderBlockHeight] = React.useState(0)
  // Merging columns can add or remove a whole header row. The ResizeObserver
  // below normally catches that, but re-running on the row count makes the
  // re-measure unconditional rather than dependent on the height happening to
  // change.
  const headerRowCount = table.getHeaderGroups().length

  // Each header row sticks below the ones above it, so the offsets depend on
  // the rendered heights (filters and pin buttons make them uneven). Measure
  // rather than guess, and re-measure when anything resizes. The coordinate
  // letter row is thead row 0, so `headerRowTops[0]` is it and the grouped
  // header rows read `headerRowTops[i + 1]`.
  React.useLayoutEffect(() => {
    const thead = theadRef.current
    if (!thead) return

    const measure = () => {
      const rows = Array.from(thead.rows)
      const base = rows[0]?.offsetTop ?? 0
      const next = rows.map((row) => row.offsetTop - base)
      setHeaderRowTops((prev) =>
        prev.length === next.length && prev.every((v, i) => v === next[i])
          ? prev
          : next,
      )
      // Bottom edge of the header block = last header row's top (relative to the
      // first) + its own height. Measured, not `thead.offsetHeight`, so it stays
      // exact across browsers that render section boxes loosely.
      const last = rows[rows.length - 1]
      const height = last ? last.offsetTop - base + last.offsetHeight : 0
      setHeaderBlockHeight((prev) => (prev === height ? prev : height))
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(thead)
    return () => observer.disconnect()
  }, [headerRowCount])

  // Leaf columns in the exact order the body renders them (left-pinned, centre,
  // right-pinned) — the letter row must line up cell-for-cell with the cells
  // below it.
  const leafColumns = [
    ...table.getLeftVisibleLeafColumns(),
    ...table.getCenterVisibleLeafColumns(),
    ...table.getRightVisibleLeafColumns(),
  ] as Column<T, unknown>[]

  // Letter per leaf column, advancing the positional counter only for data
  // columns so the fallback index ignores the `select` gutter.
  const columnLetterList = (() => {
    let dataPos = 0
    return leafColumns.map((col) => {
      const isData = !NON_DATA_COLUMN_IDS.includes(col.id)
      const letter = letterForColumn(col.id, dataPos)
      if (isData) dataPos++
      return letter
    })
  })()

  /**
   * Click-to-sort, shared by the letter row, the group bands and the leaf
   * headers so all three behave identically.
   *
   * Resolution rules:
   *  - a leaf header sorts its own column
   *  - a GROUP band has no values of its own, so it sorts by its first
   *    sortable leaf — clicking "Name" sorts by whatever column starts it
   *  - an UNNAMED column sorts nothing. A blank sheet's placeholder headers
   *    would otherwise reorder rows against a column the user can't identify,
   *    which looks like data loss rather than a sort.
   *
   * Three states, cycling: unsorted → ascending → descending → unsorted.
   * Getting back to the original row order matters — without it the only way
   * to undo a sort is to reload.
   */
  /**
   * Does this column carry a header a user could point at?
   *
   * A blank-sheet column renders an empty header until it's named. Sorting by
   * one would silently reorder every row against a column nobody can identify
   * — indistinguishable from the data scrambling itself. A function header
   * counts as labelled: it renders *something*.
   */
  const hasHeaderLabel = (column: Column<T, unknown>): boolean => {
    const header = column.columnDef.header
    if (typeof header === 'string') return header.trim().length > 0
    return header != null
  }

  const sortTargetFor = (column: Column<T, unknown>): Column<T, unknown> | null => {
    const candidates = column.getLeafColumns().length
      ? (column.getLeafColumns() as Column<T, unknown>[])
      : [column]
    return (
      candidates.find(
        (c) => c.getCanSort() && !NON_DATA_COLUMN_IDS.includes(c.id) && hasHeaderLabel(c),
      ) ?? null
    )
  }

  // The column that just changed sort, held briefly so the header can flash.
  // Purely cosmetic: a sort can reorder hundreds of rows off-screen, and
  // without a cue the only thing that visibly changed is a small glyph.
  const [justSortedId, setJustSortedId] = React.useState<string | null>(null)
  const justSortedTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  React.useEffect(
    () => () => {
      if (justSortedTimer.current) clearTimeout(justSortedTimer.current)
    },
    [],
  )

  const toggleSortFor = (column: Column<T, unknown>) => {
    const target = sortTargetFor(column)
    if (!target) return

    // getIsSorted() is 'asc' | 'desc' | false.
    const dir = target.getIsSorted()
    if (!dir) target.toggleSorting(false) // → ascending
    else if (dir === 'asc') target.toggleSorting(true) // → descending
    else target.clearSorting() // → back to the original order

    setJustSortedId(column.id)
    if (justSortedTimer.current) clearTimeout(justSortedTimer.current)
    justSortedTimer.current = setTimeout(() => setJustSortedId(null), 650)
  }

  // "Blank sheet" mode is signalled by App wiring the header-rename handler —
  // it is only passed for the user's custom (renamable) schema.
  const customHeaderMode = !!onRenameColumn
  // Has the user named ANY column yet? True once at least one leaf column has a
  // non-empty string header. In blank-sheet mode every header starts as ''.
  const someNamed = leafColumns.some((col) => {
    const header = col.columnDef.header
    return typeof header === 'string' && header !== ''
  })
  // The leaf column-NAME header row (with inline rename) is suppressed only in a
  // brand-new blank sheet — no column named yet. Once any name exists (or this
  // is an ordinary table) it renders exactly as before, so row 1 stays the first
  // data row until the user actually names a column.
  const showNameHeaderRow = !customHeaderMode || someNamed

  // Left-pinned columns must clear the row-number gutter; everything else is
  // untouched.
  const shiftedHeaderStyle = (
    header: Header<T, unknown>,
    top?: number,
  ): React.CSSProperties => {
    const style = getHeaderPinningStyles(table, header, top)
    if (header.column.getIsPinned() === 'left') {
      style.left = `${header.getStart('left') + ROW_NUMBER_WIDTH}px`
    }
    return style
  }

  const shiftedCellStyle = (cell: Cell<T, unknown>): React.CSSProperties => {
    const style = getCellPinningStyles(cell)
    if (cell.column.getIsPinned() === 'left') {
      style.left = `${cell.column.getStart('left') + ROW_NUMBER_WIDTH}px`
    }
    return style
  }

  // Sticky style for a coordinate-letter cell (same pinning rules as the header
  // below it, but it lives in the top row so it sticks at top 0).
  const letterCellStyle = (col: Column<T, unknown>): React.CSSProperties => {
    const pinned = col.getIsPinned()
    const style: React.CSSProperties = {
      position: 'sticky',
      top: headerRowTops[0] ?? 0,
      width: col.getSize(),
      zIndex: pinned ? 6 : 5,
    }
    if (pinned === 'left') {
      style.left = `${col.getStart('left') + ROW_NUMBER_WIDTH}px`
    } else if (pinned === 'right') {
      style.right = `${
        table.getRightTotalSize() - col.getStart('right') - col.getSize()
      }px`
    }
    return style
  }

  // The coordinate letters (A, B, C…) and row numbers (1, 2, 3…): a distinct
  // header-grey with DARKER, BOLDER text and a heavier border so the grid frame
  // reads clearly against the alternating body rows.
  const gutterCell =
    'bg-slate-200 text-slate-800 text-2xs font-bold text-center border border-slate-400'

  // The scroll container doubles as the keyboard focus sink (a tabIndex=0
  // element that can hold DOM focus), so arrow-key navigation has somewhere to
  // live that is not an <input>. Registering it (once — `register` is stable)
  // lets the selection layer focus it on a cell/header/gutter click.
  const scrollContainerRef = React.useRef<HTMLDivElement>(null)
  const register = selection?.registerScrollContainer
  React.useEffect(() => {
    if (!register) return
    register(scrollContainerRef.current)
    return () => register(null)
  }, [register])

  // ── Gutter resize + auto-fit ────────────────────────────────────────────────
  // Column width reuses TanStack's column resize: a letter-row grip borrows the
  // exact leaf-header resize handler its header grip uses. Row height has no
  // TanStack equivalent, so it lives in a small per-DATA-index store here — keyed
  // like formatting, so a height follows its row through sort / filter.
  const COL_MIN_WIDTH = 48
  const COL_MAX_WIDTH = 480
  const ROW_MIN_HEIGHT = 24
  const ROW_MAX_HEIGHT = 480

  // Controlled when the parent wires both props (so heights can be exported /
  // cloned); otherwise the table owns them locally, unchanged from before. The
  // `setRowHeights` wrapper accepts the same value|updater shape either way, so
  // every existing call site keeps working.
  const [internalRowHeights, setInternalRowHeights] = React.useState<
    Record<number, number>
  >({})
  const isControlledHeights =
    controlledRowHeights !== undefined && onRowHeightsChange !== undefined
  const rowHeights = isControlledHeights
    ? controlledRowHeights
    : internalRowHeights
  const setRowHeights = React.useCallback(
    (
      updater:
        | Record<number, number>
        | ((prev: Record<number, number>) => Record<number, number>),
    ) => {
      if (isControlledHeights) {
        const next =
          typeof updater === 'function'
            ? updater(controlledRowHeights as Record<number, number>)
            : updater
        onRowHeightsChange!(next)
      } else {
        setInternalRowHeights(updater)
      }
    },
    [isControlledHeights, controlledRowHeights, onRowHeightsChange],
  )

  // ── Row drag-to-reorder ─────────────────────────────────────────────────────
  // Reordering the underlying array only lines up with what the user sees when
  // the visible order IS the data order — so it is switched off the moment any
  // sort / group / filter / global-search is active or the rows span more than
  // one page. When off, the gutter is a plain click-to-select with no drag.
  const dragState = table.getState()
  const rowDragEnabled =
    !!onReorderRows &&
    dragState.sorting.length === 0 &&
    dragState.grouping.length === 0 &&
    dragState.columnFilters.length === 0 &&
    !dragState.globalFilter &&
    table.getPageCount() <= 1

  // A committed reorder permutes the data indices, so the per-DATA-index row
  // heights are remapped through the SAME splice (via the shared helper) before
  // the data itself moves — otherwise a height would be left on the wrong row.
  const handleReorderRows = (from: number, to: number) => {
    const n = table.getCoreRowModel().rows.length
    const oldToNew = buildRowPermutation(n, from, to)
    setRowHeights((prev) => {
      const entries = Object.entries(prev)
      if (!entries.length) return prev
      const next: Record<number, number> = {}
      for (const [key, value] of entries) {
        const oldIndex = Number(key)
        next[oldToNew[oldIndex] ?? oldIndex] = value
      }
      return next
    })
    onReorderRows?.(from, to)
  }

  const rowDrag = useRowDrag({
    enabled: rowDragEnabled,
    onReorder: handleReorderRows,
  })

  // Records the gutter pointer-down position so the click that follows can tell a
  // plain click (select the whole row) from the tail of a drag-reorder — the
  // same click-vs-drag guard the header uses.
  const rowGutterClickStart = React.useRef<{ x: number; y: number } | null>(null)

  // Leaf header per column id, so a letter-row grip drives the very same resize
  // interaction as the header grip above it.
  const leafHeaderByColumnId = new Map(
    table.getLeafHeaders().map((h) => [h.column.id, h] as const),
  )

  // Widest rendered content in a column → a width. Text is measured off a hidden
  // span (the w-full editor input can't report its own content width); the
  // header label adds an allowance for the sort / group controls beside it.
  const measureColumnWidth = (columnId: string): number => {
    const root = tableRef.current
    if (!root) return COL_MIN_WIDTH
    const escaped = CSS.escape(columnId)
    const span = document.createElement('span')
    span.style.cssText =
      'position:absolute;top:-9999px;left:-9999px;visibility:hidden;white-space:pre;pointer-events:none;'
    document.body.appendChild(span)

    const widthOf = (text: string, fontSource: HTMLElement): number => {
      const trimmed = text.trim()
      if (!trimmed) return 0
      const cs = getComputedStyle(fontSource)
      span.style.fontFamily = cs.fontFamily
      span.style.fontSize = cs.fontSize
      span.style.fontWeight = cs.fontWeight
      span.style.fontStyle = cs.fontStyle
      span.style.letterSpacing = cs.letterSpacing
      span.textContent = trimmed
      return span.offsetWidth
    }

    let bodyMax = 0
    root
      .querySelectorAll<HTMLElement>(`td[data-col-id=${escaped}]`)
      .forEach((td) => {
        const input = td.querySelector('input')
        const width = input
          ? widthOf(input.value, input)
          : widthOf(td.innerText, td)
        if (width > bodyMax) bodyMax = width
      })

    let headerMax = 0
    const label = root.querySelector<HTMLElement>(
      `th[data-col-id=${escaped}] span.truncate`,
    )
    if (label) {
      const column = table.getColumn(columnId)
      const controls = 28 + (column?.getCanGroup() ? 28 : 0)
      headerMax = widthOf(label.innerText, label) + controls
    }

    document.body.removeChild(span)

    const type = table.getColumn(columnId)?.columnDef.meta?.type
    // +20 covers the cell's px-2 padding and a little breathing room.
    let width = Math.ceil(Math.max(bodyMax, headerMax)) + 20
    // Image columns hold a fixed-size thumbnail, not text, so floor to it.
    if (type === 'image') width = Math.max(width, metrics.thumb + 72)
    return Math.max(COL_MIN_WIDTH, Math.min(COL_MAX_WIDTH, width))
  }

  // Tallest content in a row → a height. The cell's child is measured, not the
  // <td> (whose scrollHeight is pinned to the current row height and so could
  // never shrink); the cell's vertical padding is added back on.
  const measureRowHeight = (dataRowIndex: number): number => {
    const root = tableRef.current
    if (!root) return metrics.rowHeight
    const tr = root.querySelector<HTMLTableRowElement>(
      `tr[data-data-index="${dataRowIndex}"]`,
    )
    if (!tr) return metrics.rowHeight
    let max = 0
    tr.querySelectorAll<HTMLElement>('td').forEach((td) => {
      const cs = getComputedStyle(td)
      const padV =
        parseFloat(cs.paddingTop || '0') + parseFloat(cs.paddingBottom || '0')
      const child = td.firstElementChild as HTMLElement | null
      const inner = child ? child.offsetHeight : parseFloat(cs.lineHeight) || 18
      if (inner + padV > max) max = inner + padV
    })
    return Math.max(ROW_MIN_HEIGHT, Math.min(ROW_MAX_HEIGHT, Math.ceil(max)))
  }

  // Single vs batch is decided straight off the selection scope the hook
  // exposes: a multi-column selection (or a Ctrl+A "all") fits every selected
  // column; otherwise just the one whose resize line was double-clicked.
  const autoFitColumns = (primaryColumnId: string) => {
    const scope = selection?.selectionScope
    const batch =
      !!scope &&
      (scope.kind === 'all' ||
        (scope.kind === 'columns' && scope.columnIds.length > 1))
    const ids = batch ? scope!.columnIds : [primaryColumnId]
    const sizing: Record<string, number> = {}
    for (const id of ids) sizing[id] = measureColumnWidth(id)
    table.setColumnSizing((prev) => ({ ...prev, ...sizing }))
  }

  const autoFitRows = (primaryDataIndex: number) => {
    const scope = selection?.selectionScope
    const batch =
      !!scope &&
      (scope.kind === 'all' ||
        (scope.kind === 'rows' && scope.rowIndices.length > 1))
    const indices = batch ? scope!.rowIndices : [primaryDataIndex]
    setRowHeights((prev) => {
      const next = { ...prev }
      for (const index of indices) next[index] = measureRowHeight(index)
      return next
    })
  }

  // Apply an explicit height (from the row strip's Short / Medium / Tall preset)
  // to the target row, and to every selected row when a multi-row / whole-grid
  // selection is active — same single-vs-batch rule the auto-fit paths use.
  const applyRowHeight = (primaryDataIndex: number, height: number) => {
    const scope = selection?.selectionScope
    const batch =
      !!scope &&
      (scope.kind === 'all' ||
        (scope.kind === 'rows' && scope.rowIndices.length > 1))
    const indices = batch ? scope!.rowIndices : [primaryDataIndex]
    setRowHeights((prev) => {
      const next = { ...prev }
      for (const index of indices) next[index] = height
      return next
    })
  }

  // Row-height drag off a row-number grip. Pointer events unify mouse + touch;
  // touch-action:none on the grip keeps a touch-drag resizing, not scrolling.
  const startRowResize = (dataRowIndex: number, event: React.PointerEvent) => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const startY = event.clientY
    const startHeight = rowHeights[dataRowIndex] ?? metrics.rowHeight
    const onMove = (moveEvent: PointerEvent) => {
      const next = Math.max(
        ROW_MIN_HEIGHT,
        Math.min(ROW_MAX_HEIGHT, startHeight + (moveEvent.clientY - startY)),
      )
      setRowHeights((prev) => ({ ...prev, [dataRowIndex]: next }))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Finger-sized on touch, hairline on sm+ (mirrors the header grip). touch-none
  // keeps a drag here resizing rather than scrolling.
  const colGripClass =
    'absolute right-0 top-0 z-10 h-full w-4 sm:w-1.5 select-none touch-none cursor-col-resize sm:hover:bg-slate-300'
  const rowGripClass =
    'absolute bottom-0 left-0 z-10 h-3 sm:h-1 w-full select-none touch-none cursor-row-resize sm:hover:bg-slate-300'

  // ── Row freeze / pin ────────────────────────────────────────────────────────
  // TanStack splits the row model into three groups once rows are pinned. The
  // body renders them stacked: frozen-top rows first (sticky just below the
  // header block), then the scrolling centre, then frozen-bottom rows (sticky to
  // the container floor). The screen-index `pos.row` every cell reports must stay
  // an index into `table.getRowModel().rows` — that is the exact array
  // `useCellSelection` maps back onto data — so it is read from this id→index map
  // rather than the visual order, keeping selection / copy / fill correct even
  // though frozen rows are lifted out of their natural position on screen.
  const rowModelRows = table.getRowModel().rows
  const screenRowById = new Map<string, number>()
  const rowByDataIndex = new Map<number, Row<T>>()
  rowModelRows.forEach((row, index) => {
    screenRowById.set(row.id, index)
    if (!row.getIsGrouped()) rowByDataIndex.set(row.index, row)
  })

  const topRows = table.getTopRows()
  const centerRows = table.getCenterRows()
  const bottomRows = table.getBottomRows()

  const rowHeightOf = (row: Row<T>): number => {
    const dataRowIndex = row.getIsGrouped() ? -1 : row.index
    return dataRowIndex >= 0
      ? (rowHeights[dataRowIndex] ?? metrics.rowHeight)
      : metrics.rowHeight
  }

  // First frozen-top row sticks at the header block's bottom edge; each further
  // one stacks by the measured heights of the frozen rows above it.
  const topOffsets: number[] = []
  {
    let acc = headerBlockHeight
    for (const row of topRows) {
      topOffsets.push(acc)
      acc += rowHeightOf(row)
    }
  }
  // Frozen-bottom rows mirror it from the floor: the last sticks at bottom 0,
  // earlier ones are lifted by the heights of the frozen rows below them.
  const bottomOffsets: number[] = bottomRows.map((_, i) => {
    let sum = 0
    for (let j = i + 1; j < bottomRows.length; j++) sum += rowHeightOf(bottomRows[j])
    return sum
  })

  // Freeze / unfreeze from the row strip. Toggles the selected row, or every row
  // of an active multi-row / whole-grid selection (same batch rule the row-height
  // presets use), driving off the clicked row's current state so the whole batch
  // moves together.
  const toggleRowPin = (row: Row<T>) => {
    const target: 'top' | false = row.getIsPinned() ? false : 'top'
    const scope = selection?.selectionScope
    const batch =
      !!scope &&
      (scope.kind === 'all' ||
        (scope.kind === 'rows' && scope.rowIndices.length > 1))
    if (batch && scope!.rowIndices.includes(row.index)) {
      for (const dataIndex of scope!.rowIndices) {
        rowByDataIndex.get(dataIndex)?.pin(target)
      }
    } else {
      row.pin(target)
    }
  }

  // Renders one body `<tr>`. `frozen` is set for a pinned row and carries the
  // sticky offset for its group plus whether it is the group's boundary row (so a
  // hairline separator marks where the frozen "table" meets the scrolling body).
  const renderBodyRow = (
    row: Row<T>,
    frozen?: {
      stickyTop?: number
      stickyBottom?: number
      separatorBottom?: boolean
      separatorTop?: boolean
    },
  ) => {
    // Screen index into getRowModel().rows — the coordinate space selection uses.
    const rowIndex = screenRowById.get(row.id) ?? 0
    // Grouped (aggregate) rows have no backing data row, so row-scope and
    // cell-scope formatting (both keyed on the data index) don't apply to them -
    // only column scope does.
    const dataRowIndex = row.getIsGrouped() ? -1 : row.index

    // Highlight the row-number gutter when this row is selected (Excel-style —
    // the 1/2/3 lights up, not just the cells). `scope` is the outer render's
    // selection scope, resolved at call time.
    const rowSelected =
      dataRowIndex >= 0 &&
      (scope?.kind === 'rows' || scope?.kind === 'all') &&
      !!scope?.rowIndices.includes(dataRowIndex)

    // A manually-set height (from a gutter drag / auto-fit) overrides the
    // thumbnail-size default; grouped rows keep the default.
    const rowHeight =
      dataRowIndex >= 0
        ? (rowHeights[dataRowIndex] ?? metrics.rowHeight)
        : metrics.rowHeight

    const isFrozen = !!frozen
    // Hairline that separates the frozen block from the scrolling body: a 2px
    // slate edge (wins the border-collapse tie against the 1px grid, so it
    // actually paints) under the last top row / above the first bottom row.
    const separator = '2px solid rgb(148 163 184)'

    return (
      <tr
        key={row.id}
        // Lets the row-height measurer + the row-drag layer find this row by
        // DATA index.
        data-data-index={dataRowIndex}
        style={{
          height: rowHeight,
          // Subtly fade the row being dragged so the drop line reads as "where
          // it will go" rather than "where it is".
          opacity:
            dataRowIndex >= 0 && dataRowIndex === rowDrag.draggingIndex
              ? 0.6
              : undefined,
        }}
      >
        {/* Row-number gutter cell, sticky to the left like a pinned column. Shows
            the 1-based screen position; a click selects the whole row, which the
            inline ops strip above the table then reflects. Its bottom edge is a
            resize grip (drag = set height, double-click = auto-fit). A frozen row
            also sticks vertically and sits above the scrolling gutter cells. */}
        <td
          className={`${gutterCell} select-none transition-colors ${
            rowSelected
              ? 'bg-accent-100 font-semibold text-accent-700'
              : isFrozen
                ? 'bg-slate-200'
                : dataRowIndex >= 0
                  ? 'cursor-pointer sm:hover:bg-slate-200'
                  : ''
          }`}
          style={{
            position: 'sticky',
            left: 0,
            top: frozen?.stickyTop,
            bottom: frozen?.stickyBottom,
            width: ROW_NUMBER_WIDTH,
            minWidth: ROW_NUMBER_WIDTH,
            zIndex: isFrozen ? 4 : 3,
            // Grab-to-reorder affordance; touch-none keeps a touch-drag from
            // scrolling the table instead of moving the row.
            ...(rowDragEnabled && dataRowIndex >= 0
              ? { cursor: 'grab', touchAction: 'none' }
              : {}),
            ...(frozen?.separatorBottom ? { borderBottom: separator } : {}),
            ...(frozen?.separatorTop ? { borderTop: separator } : {}),
          }}
          // Pick the row up by its number. Drag only actually begins past a small
          // threshold (see useRowDrag), so a plain click still falls through to
          // the select handler below.
          onPointerDown={
            rowDragEnabled && dataRowIndex >= 0
              ? (event) => {
                  rowGutterClickStart.current = {
                    x: event.clientX,
                    y: event.clientY,
                  }
                  rowDrag.onRowPointerDown(dataRowIndex, event)
                }
              : undefined
          }
          onClick={
            dataRowIndex >= 0
              ? (event) => {
                  // Swallow the click that ends a real drag so it does not also
                  // select; a click that never moved still selects the row.
                  const start = rowGutterClickStart.current
                  rowGutterClickStart.current = null
                  if (start) {
                    const moved =
                      Math.abs(event.clientX - start.x) > 4 ||
                      Math.abs(event.clientY - start.y) > 4
                    if (moved) return
                  }
                  selection?.onRowHeaderClick(
                    rowIndex,
                    {
                      additive: event.ctrlKey || event.metaKey,
                      extend: event.shiftKey,
                    },
                    event,
                  )
                }
              : undefined
          }
        >
          <span className="inline-flex items-center justify-center gap-0.5">
            {rowIndex + 1}
            {/* A locked (frozen/pinned) row shows a small muted lock glyph
                beside its number; unpinned rows show just the number. */}
            {row.getIsPinned() ? (
              <span
                title="Locked"
                aria-label="Locked"
                className="inline-flex text-slate-400"
              >
                <Lock size={11} aria-hidden="true" />
              </span>
            ) : null}
          </span>
          {dataRowIndex >= 0 ? (
            <div
              data-resize-handle="true"
              className={rowGripClass}
              title="Drag to resize · double-click to fit"
              onPointerDown={(event) => startRowResize(dataRowIndex, event)}
              onClick={(event) => event.stopPropagation()}
              onDoubleClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                autoFitRows(dataRowIndex)
              }}
            />
          ) : null}
        </td>
        {row.getVisibleCells().map((cell, colIndex) => {
          // Screen coordinates - see useCellSelection for how these map back
          // onto the underlying data indices.
          const pos = { row: rowIndex, col: colIndex }
          // Effective colour / alignment for this cell (column < row < cell).
          const fmt = resolveFormat(cell.column.id, dataRowIndex)
          // Resolved horizontal alignment for the cell. The <td>'s `textAlign`
          // aligns text-node and <input> content, but it does NOT move
          // flex/block cell bodies (attachment thumbnails, file chips, mixed
          // media, the empty-attachment placeholder) — text-align has no effect
          // on flex items. So when a column/row/cell is EXPLICITLY aligned
          // centre/right, wrap the rendered content in a flex box that maps the
          // alignment to `justifyContent`, making every cell type — editable or
          // not, frozen or not — honour it uniformly. An explicit `left` (and
          // the unset default) is left unwrapped so full-width children keep
          // their intrinsic layout (e.g. file-name truncation).
          const justify =
            fmt.align === 'right'
              ? 'flex-end'
              : fmt.align === 'center'
                ? 'center'
                : null
          // Live highlight: this cell is read by the formula draft being typed.
          const referenced =
            dataRowIndex >= 0 && formulaRefs.has(cell.column.id, dataRowIndex)
          // Find-in-table highlight: 'current' (the stepped-to match) paints
          // amber, any other 'match' paints yellow. Overrides the cell fill only
          // while searching.
          const fk = findKey(cell.row.id, cell.column.id)
          const findState: 'current' | 'match' | null =
            findHl.current === fk
              ? 'current'
              : findHl.matches.has(fk)
                ? 'match'
                : null
          /*
           * A grouped cell is a heading, not a value.
           *
           * It needs three things the plain renderer cannot give it: something
           * to click, a count so the group states its own size, and a triangle
           * that says which way it will go. Without them a grouped sheet is a
           * list of headings with the data sealed inside — the rows exist in
           * the model and there is no way to reach them.
           */
          const cellContent = cell.getIsGrouped() ? (
            <button
              type="button"
              className="jt-group-toggle"
              aria-expanded={cell.row.getIsExpanded()}
              onClick={cell.row.getToggleExpandedHandler()}
              title={cell.row.getIsExpanded() ? 'Collapse this group' : 'Expand this group'}
            >
              <span className="jt-group-caret" aria-hidden="true">
                {cell.row.getIsExpanded() ? '▾' : '▸'}
              </span>
              {flexRender(cell.column.columnDef.cell, cell.getContext())}
              <span className="jt-group-count">{cell.row.subRows.length}</span>
            </button>
          ) : cell.getIsAggregated() ? null : cell.getIsPlaceholder() ? null : (
            flexRender(cell.column.columnDef.cell, cell.getContext())
          )

          // Base structural style, then — for a frozen row — lift the cell to
          // sticky on the vertical axis too and above the scrolling body.
          const cellStyle = shiftedCellStyle(cell)
          if (isFrozen) {
            cellStyle.position = 'sticky'
            cellStyle.top = frozen?.stickyTop
            cellStyle.bottom = frozen?.stickyBottom
            // Pinned cells already carry zIndex 1; bump so frozen cells win
            // against the scrolling rows (and pinned+frozen wins the corner).
            cellStyle.zIndex = ((cellStyle.zIndex as number | undefined) ?? 0) + 2
          }

          return (
            <td
              key={cell.id}
              data-col-id={cell.column.id}
              data-find-key={findState ? fk : undefined}
              className={`border border-slate-200 px-2 text-slate-700 ${
                isFrozen
                  ? 'bg-slate-100'
                  : rowIndex % 2 === 1
                    ? 'bg-slate-50'
                    : 'bg-white'
              }`}
              style={{
                ...cellStyle,
                verticalAlign: 'middle',
                paddingTop: metrics.cellPaddingY,
                paddingBottom: metrics.cellPaddingY,
                textAlign:
                  fmt.align ??
                  alignmentFor(cell.column.columnDef.meta?.type),
                ...(fmt.bg ? { backgroundColor: fmt.bg } : {}),
                ...(fmt.fg ? { color: fmt.fg } : {}),
                // Find highlight wins over the cell fill while searching.
                ...(findState === 'current'
                  ? { backgroundColor: '#fb923c', color: '#0f172a' }
                  : findState === 'match'
                    ? { backgroundColor: '#fde68a', color: '#0f172a' }
                    : {}),
                ...(fmt.fontSize ? { fontSize: fmt.fontSize } : {}),
                ...(fmt.fontFamily ? { fontFamily: fmt.fontFamily } : {}),
                // The frozen/scrolling boundary hairline. Placed before the
                // per-cell border rules so an explicit user border still wins.
                ...(frozen?.separatorBottom
                  ? { borderBottom: separator }
                  : {}),
                ...(frozen?.separatorTop ? { borderTop: separator } : {}),
                // A `null` side clears the hairline grid here; DRAWN sides are
                // painted by the overlay below (they'd lose the border-collapse
                // tie if set on the <td> directly).
                ...bordersToCellCss(fmt.borders),
              }}
              onMouseDown={(event) => selection?.onCellMouseDown(pos, event)}
              onMouseEnter={() => selection?.onCellMouseEnter(pos)}
              onDoubleClick={() => selection?.onCellDoubleClick(pos)}
            >
              {justify ? (
                <div
                  style={{
                    display: 'flex',
                    width: '100%',
                    minWidth: 0,
                    alignItems: 'center',
                    justifyContent: justify,
                  }}
                >
                  {cellContent}
                </div>
              ) : (
                cellContent
              )}
              {/* Applied borders paint on a non-collapsing overlay so every side
                  shows over the hairline grid. */}
              {hasDrawnBorder(fmt.borders) ? (
                <BorderOverlay borders={fmt.borders!} />
              ) : null}
              {/* Live highlight for a cell referenced by the formula being
                  typed. A DASHED accent border (+ faint accent tint) keeps it
                  distinct from the solid-bordered selection decoration. Sits
                  below the selection overlay (zIndex 2) and never intercepts
                  pointer events. */}
              {referenced ? (
                <span
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    zIndex: 2,
                    pointerEvents: 'none',
                    border: '2px dashed #ff3b1d',
                    background: 'rgba(255, 59, 29, 0.06)',
                  }}
                />
              ) : null}
              {selection?.renderDecoration(pos)}
            </td>
          )
        })}
        {/* Trailing spacer cell that pairs with the add-column "+" header, so the
            body grid keeps the same column count as the leaf header row. */}
        {onAddColumn ? (
          <td
            aria-hidden="true"
            className={`border border-slate-200 ${
              isFrozen ? 'bg-slate-50' : 'bg-white'
            }`}
            style={{ width: 40, minWidth: 40 }}
          />
        ) : null}
      </tr>
    )
  }

  // ── Inline contextual ops strip ─────────────────────────────────────────────
  // ONE strip, handed the REAL `SelectionScope`. This used to be three mutually
  // exclusive branches gated on `length === 1`, which is why a multi-row or
  // multi-column selection silently fell through to a format-only strip with no
  // structural ops at all — and why the scope, computed right here, was thrown
  // away before the strip ever saw it. The strip now filters and orders its own
  // actions from that scope (see CellContextPopup), so this only binds callbacks.
  //
  // Bulk shape, per callback:
  //   • the two INSERTS are single inserts anchored at the edge of the selection
  //     (left of the first / right of the last column, above the first / below
  //     the last row). The strip calls them once per selected line, which stacks
  //     into N — App's insert handlers use functional state updates, so repeated
  //     calls inside one event compose instead of clobbering each other.
  //   • the two DELETES take the WHOLE selection in one call: column ids are
  //     named directly, and rows are removed HIGHEST-INDEX-FIRST so dropping one
  //     never shifts the index of another still to be dropped.
  //   • row height / freeze already batch across a multi-row selection
  //     internally (see `applyRowHeight` / `toggleRowPin`), so they are anchored
  //     on the first selected row and simply passed through — which is also what
  //     finally makes that batching reachable.
  const scope = selection?.selectionScope
  const stripScopeKeys = selection?.getFormatScopeKeys() ?? []

  let strip: React.ReactNode = null
  if (selection && scope && scope.kind !== 'none' && stripScopeKeys.length) {
    const { columnIds, rowIndices } = scope
    const isColumns = scope.kind === 'columns'
    const isRows = scope.kind === 'rows'
    // Type / hide / arrange / enter-formula are inherently single-column ops.
    const soleColumnId =
      isColumns && columnIds.length === 1 ? columnIds[0] : undefined
    const firstRowIndex = isRows ? Math.min(...rowIndices) : -1
    const lastRowIndex = isRows ? Math.max(...rowIndices) : -1
    const anchorRow = isRows ? rowByDataIndex.get(firstRowIndex) : undefined

    const stripTitle = isColumns
      ? columnIds.length === 1
        ? `Column ${lettersForColumnId(columnIds[0]) || columnIds[0]}`
        : `${columnIds.length} columns`
      : isRows
        ? rowIndices.length === 1
          ? `Row ${
              (anchorRow
                ? (screenRowById.get(anchorRow.id) ?? firstRowIndex)
                : firstRowIndex) + 1
            }`
          : `${rowIndices.length} rows`
        : scope.kind === 'cell'
          ? 'Cell'
          : scope.kind === 'all'
            ? 'All cells'
            : 'Selection'

    strip = (
      <CellContextStrip
        scopeKeys={stripScopeKeys}
        scope={scope}
        title={stripTitle}
        // Passed for EVERY selection now, not just a single column: the strip
        // reads the row count off `options.data` to work out whether an autosum
        // total has anywhere to land, and the hidden-columns menu needs it too.
        table={table}
        column={
          soleColumnId ? (table.getColumn(soleColumnId) ?? undefined) : undefined
        }
        onEnterFormula={
          soleColumnId && !selection.isReadOnlyColumn(soleColumnId)
            ? () => selection.beginEditColumn(soleColumnId)
            : undefined
        }
        onInsertColumnLeft={
          isColumns && onInsertColumn
            ? () => onInsertColumn(columnIds[0], 'left')
            : undefined
        }
        onInsertColumnRight={
          isColumns && onInsertColumn
            ? () => onInsertColumn(columnIds[columnIds.length - 1], 'right')
            : undefined
        }
        onDeleteColumn={
          isColumns && onDeleteColumn
            ? () => columnIds.forEach((id) => onDeleteColumn(id))
            : undefined
        }
        rowHeight={
          isRows ? (rowHeights[firstRowIndex] ?? metrics.rowHeight) : undefined
        }
        onSetRowHeight={
          isRows ? (height) => applyRowHeight(firstRowIndex, height) : undefined
        }
        isRowPinned={anchorRow ? anchorRow.getIsPinned() === 'top' : undefined}
        onToggleRowPin={anchorRow ? () => toggleRowPin(anchorRow) : undefined}
        onPromoteToHeader={
          isRows && rowIndices.length === 1 && onPromoteRowToHeader
            ? () => onPromoteRowToHeader(firstRowIndex)
            : undefined
        }
        onInsertRowAbove={
          isRows && onInsertRow
            ? () => onInsertRow(firstRowIndex, 'above')
            : undefined
        }
        onInsertRowBelow={
          isRows && onInsertRow
            ? () => onInsertRow(lastRowIndex, 'below')
            : undefined
        }
        onDeleteRow={
          isRows && onDeleteRow
            ? () =>
                [...rowIndices]
                  .sort((a, b) => b - a)
                  .forEach((index) => onDeleteRow(index))
            : undefined
        }
        fontSizes={fontSizes}
        fontFamilies={fontFamilies}
        onMergeColumns={
          isColumns && columnIds.length >= 2 && onMergeColumns
            ? () => onMergeColumns(columnIds)
            : undefined
        }
      />
    )
  }

  // Full width of the body grid in column-slots: the row-number gutter (1) + one
  // per visible leaf column + the trailing add-column slot when it exists. Drives
  // the add-row bar's colSpan so it spans the whole table.
  const totalColSpan =
    1 + leafColumns.length + (onAddColumn ? 1 : 0)

  return (
    <div className="flex h-full w-full min-h-0 flex-col">
      {/* Contextual ops strip. When App provides a slot it is portaled into the
          actions div (no actions in the table); otherwise it docks inline above
          the table as a fallback. Hidden when nothing is selected. */}
      {strip && opsSlot
        ? createPortal(strip, opsSlot)
        : strip
          ? (
              <div className="shrink-0 border-b border-slate-200 bg-white">
                {strip}
              </div>
            )
          : null}
      <div
        ref={scrollContainerRef}
        className="custom-scrollbar bg-white"
        // The row-drag layer finds this scroller (to position the drop line in
        // its content coordinates) via this attribute.
        data-row-drag-scroll=""
        // tabIndex makes it focusable; the container owns both scroll axes so the
        // page never scrolls sideways (§8), with momentum + no scroll-chaining on
        // touch. The focus outline is suppressed here — the accent cell overlay is
        // the visible focus indicator, so a ring around the whole region would be
        // noise, not signal.
        tabIndex={0}
        style={{
          // `relative` makes this the containing block for the absolutely
          // positioned row-drop line below (sticky children are unaffected —
          // this element is still their scroll context).
          position: 'relative',
          flex: '1 1 auto',
          minHeight: 0,
          overflow: 'auto',
          width: '100%',
          maxWidth: '100%',
          outline: 'none',
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
        }}
      >
      <table
        ref={tableRef}
        // `border-separate` (not `collapse`) with zero spacing: each hairline is
        // then drawn by BOTH adjacent cells at the same position, so the grid
        // line survives even when fractional zoom / low DPR rounds one side away
        // (the "missing borders on mobile" bug). The applied-border overlay is
        // absolute, so it is unaffected by the collapse-mode change.
        //
        // `table-fixed` makes the widths we already set from `column.getSize()`
        // authoritative. Under the default `auto` layout the browser re-measures
        // content on every render, so sorting — which changes *which* rows are
        // visible — silently resized every column and the grid jumped under the
        // cursor.
        className="table-fixed border-separate border-spacing-0 text-sm text-slate-700"
      >
        <thead ref={theadRef}>
          {/* Coordinate-letter row + the corner "select all" cell. */}
          <tr>
            <th
              // Spans the full header height on the left, forming the corner
              // where the letter row meets the row-number column. When the
              // name-header rows are hidden (fresh blank sheet) only the letter
              // row exists, so the corner spans just that one row.
              rowSpan={showNameHeaderRow ? headerRowCount + 1 : 1}
              className={`${gutterCell} cursor-pointer select-none transition-colors sm:hover:bg-slate-200`}
              style={{
                position: 'sticky',
                top: headerRowTops[0] ?? 0,
                left: 0,
                width: ROW_NUMBER_WIDTH,
                minWidth: ROW_NUMBER_WIDTH,
                zIndex: 7,
              }}
              title="Select all"
              aria-label="Select all"
              onClick={() => selection?.onSelectAll()}
            />
            {leafColumns.map((col, index) => {
              const isData = !NON_DATA_COLUMN_IDS.includes(col.id)
              // The row-selection checkbox column: its coordinate cell is a
              // "select all rows" control — clicking it toggles every row's
              // checkbox (mirrors the checkbox that lives in its leaf header).
              const isSelectCol = col.id === 'select'
              const allRowsSelected = isSelectCol && table.getIsAllRowsSelected()
              // Highlight the coordinate letter when its column is selected
              // (Excel-style — the header/letter lights up, not just the cells).
              const colSelected =
                isData &&
                (scope?.kind === 'columns' || scope?.kind === 'all') &&
                !!scope?.columnIds.includes(col.id)
              return (
                <th
                  key={`letter-${col.id}`}
                  // Same anchor the drag layer / measurement use elsewhere, so
                  // the letters stay locked to their columns through drag,
                  // resize, pin and hide.
                  data-col-id={col.id}
                  title={isSelectCol ? 'Select all rows' : undefined}
                  className={`${gutterCell} px-1 transition-colors ${
                    colSelected || allRowsSelected
                      ? 'bg-accent-100 font-semibold text-accent-700'
                      : isData || isSelectCol
                        ? 'cursor-pointer sm:hover:bg-slate-200'
                        : ''
                  }`}
                  style={letterCellStyle(col)}
                  onClick={
                    isData
                      ? (e) =>
                          selection?.onColumnHeaderClick(
                            col.id,
                            {
                              additive: e.ctrlKey || e.metaKey,
                              extend: e.shiftKey,
                            },
                            e,
                          )
                      : isSelectCol
                        ? () => table.toggleAllRowsSelected()
                        : undefined
                  }
                >
                  {columnLetterList[index]}
                  {/* Resize the column from the coordinate row too. Reuses the
                      leaf header's TanStack resize handler so it behaves exactly
                      like the header grip; double-click auto-fits (batched over a
                      multi-column / all selection). */}
                  {isData ? (
                    <div
                      data-resize-handle="true"
                      className={colGripClass}
                      title="Drag to resize · double-click to fit"
                      onMouseDown={leafHeaderByColumnId
                        .get(col.id)
                        ?.getResizeHandler()}
                      onTouchStart={leafHeaderByColumnId
                        .get(col.id)
                        ?.getResizeHandler()}
                      onClick={(event) => event.stopPropagation()}
                      onDoubleClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        autoFitColumns(col.id)
                      }}
                    />
                  ) : null}
                </th>
              )
            })}
            {/* Add-column "+", now the trailing cell of the coordinate-letter
                row so it is ALWAYS visible — even when the name-header row is
                hidden on a fresh blank sheet. Each body row carries a matching
                trailing spacer <td>, and the name-header row (when shown) an
                empty trailing <th>, so the grid stays aligned. */}
            {onAddColumn ? (
              <th
                className="bg-white border border-slate-200 p-0 align-middle"
                style={{
                  position: 'sticky',
                  top: headerRowTops[0] ?? 0,
                  zIndex: 5,
                  width: 40,
                  minWidth: 40,
                }}
              >
                <button
                  type="button"
                  className="icon-btn-sm icon-btn-plain"
                  title="Add column"
                  aria-label="Add column"
                  onClick={onAddColumn}
                >
                  <Plus size={16} aria-hidden="true" />
                </button>
              </th>
            ) : null}
          </tr>
          {showNameHeaderRow && table.getHeaderGroups().map((headerGroup, headerRowIndex) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header, hIdx) => {
                // A placeholder is the empty continuation of a header that
                // already appeared higher up, so it is never the grab handle.
                const draggable =
                  !header.isPlaceholder && drag.canDrag(header.column.id)

                // Header rename is offered only for a renamable DATA leaf: App
                // wired `onRenameColumn`, this is a real leaf column (no child
                // columns — never a group parent), and its header is a plain
                // string (so the `select` gutter and render-fn headers are out).
                const headerLabel = header.column.columnDef.header
                const canRename =
                  !!onRenameColumn &&
                  !header.isPlaceholder &&
                  header.column.columns.length === 0 &&
                  typeof headerLabel === 'string'

                // Highlight the header when its column (or, for a group header,
                // any column beneath it) is selected.
                const headerSelected =
                  (scope?.kind === 'columns' || scope?.kind === 'all') &&
                  header.column
                    .getLeafColumns()
                    .some((c) => scope?.columnIds.includes(c.id))

                return (
                  <th
                    key={header.id}
                    // The drag layer finds and moves cells by column id, and it
                    // measures widths off the header cells.
                    data-col-id={header.column.id}
                    data-header-id={header.id}
                    // Darker, BOLDER header text + a heavier border, and a simple
                    // per-column alternating grey so columns are easy to tell
                    // apart. Selection tint (opaque accent) wins over the stripe.
                    className={`border border-slate-400 px-2 py-1.5 text-left align-middle font-bold transition-colors ${
                      headerSelected
                        ? 'bg-accent-100 text-accent-800'
                        : hIdx % 2 === 1
                          ? 'bg-slate-100 text-slate-800'
                          : 'bg-slate-200 text-slate-800'
                    }`}
                    style={{
                      ...shiftedHeaderStyle(
                        header,
                        headerRowTops[headerRowIndex + 1] ?? 0,
                      ),
                      cursor: draggable ? 'grab' : undefined,
                      // Stops a touch drag from scrolling the table instead.
                      touchAction: draggable ? 'none' : undefined,
                    }}
                    colSpan={header.colSpan}
                    onPointerDown={
                      draggable
                        ? (event) =>
                            drag.onHeaderPointerDown(header.column.id, event)
                        : undefined
                    }
                  >
                    {header.isPlaceholder ? null : (
                      <div
                        className="flex items-center gap-1"
                        // A plain click on the header selects the whole column
                        // (Excel-style); the inline ops strip above the table
                        // then reflects that selection. Record where the pointer
                        // went down so the click can be ignored when it is really
                        // the tail of a drag-reorder (the drag itself is wired on
                        // the <th> via drag.onHeaderPointerDown, untouched here).
                        onPointerDown={(event) => {
                          headerClickStart.current = {
                            x: event.clientX,
                            y: event.clientY,
                          }
                        }}
                        onClick={(event) => {
                          const start = headerClickStart.current
                          headerClickStart.current = null
                          if (start) {
                            const moved =
                              Math.abs(event.clientX - start.x) > 4 ||
                              Math.abs(event.clientY - start.y) > 4
                            if (moved) return
                          }
                          // Selection only. Sorting lives on its own control
                          // (the ⇅ button below) so selecting a column can
                          // never reorder rows you were only trying to look at.
                          selection?.onColumnHeaderClick(
                            header.column.id,
                            {
                              additive: event.ctrlKey || event.metaKey,
                              extend: event.shiftKey,
                            },
                            event,
                          )
                        }}
                      >
                        {/* Group / sort are now in the selection ops strip; the
                            header just shows subtle state indicators. A DOUBLE
                            click on a renamable header turns it into the editor
                            above; a single click still selects the column. */}
                        {canRename ? (
                          /*
                           * A header you can name is just a text field — the
                           * same as every data cell in the grid.
                           *
                           * It used to be a span that swapped into an editor on
                           * double-click. That failed in two ways at once: an
                           * empty header rendered a 0px-tall box with nothing
                           * to hit, and even when there was text, needing a
                           * double-click on a header is not a convention
                           * anybody expects in a spreadsheet. Click and type.
                           *
                           * Uncontrolled, keyed on the committed label, so the
                           * field remounts when the name changes from outside
                           * (promoting a row to the header) without fighting
                           * the user mid-edit.
                           */
                          <input
                            key={`${header.column.id}:${headerLabel as string}`}
                            defaultValue={headerLabel as string}
                            placeholder="Name column"
                            aria-label={`Column name${
                              headerLabel ? `: ${headerLabel}` : ''
                            }`}
                            // It was editable before this, but silently: no
                            // caret colour, no hover, `outline-none` plus
                            // `focus:ring-0` — a field that looked exactly like
                            // static text and gave no sign it had focus. Being
                            // editable is worth nothing if it does not LOOK
                            // editable. Now it shows a text cursor and a hint
                            // of a box on hover, and a solid ring with a strong
                            // caret once focused. `-mx-1 px-1` grows the hit box
                            // outward without shifting the label off its column.
                            className="w-full min-w-0 flex-1 -mx-1 rounded border border-transparent bg-transparent px-1 py-0.5 font-bold text-inherit caret-accent-600 outline-none transition-colors cursor-text placeholder:font-normal placeholder:italic placeholder:text-slate-400 sm:hover:border-slate-300 sm:hover:bg-white/70 focus:border-accent-400 focus:bg-white focus:ring-2 focus:ring-accent-100"
                            // Typing here must never reach the column drag,
                            // the column selection or the cell grid.
                            onPointerDown={(event) => event.stopPropagation()}
                            onMouseDown={(event) => event.stopPropagation()}
                            onClick={(event) => event.stopPropagation()}
                            onDoubleClick={(event) => event.stopPropagation()}
                            onKeyDown={(event) => {
                              event.stopPropagation()
                              if (event.key === 'Enter') {
                                event.preventDefault()
                                event.currentTarget.blur()
                              } else if (event.key === 'Escape') {
                                event.preventDefault()
                                event.currentTarget.value = headerLabel as string
                                event.currentTarget.blur()
                              }
                            }}
                            onBlur={(event) => {
                              const next = event.target.value
                              if (next !== headerLabel) {
                                onRenameColumn?.(header.column.id, next)
                              }
                            }}
                          />
                        ) : (
                          <span className="flex-1 truncate min-h-[1.25rem] leading-5">
                            {flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )}
                          </span>
                        )}
                        {header.column.getIsGrouped() ? (
                          <span
                            aria-hidden="true"
                            title="Grouped"
                            className="shrink-0 text-2xs font-semibold text-accent-600"
                          >
                            ⊞
                          </span>
                        ) : null}
                        {(() => {
                          // Sorting is its own control, never the header
                          // click — selecting a column must not reorder rows.
                          //
                          // Three states, always visible so the affordance is
                          // discoverable rather than hover-only:
                          //   ⇅  unsorted (default)
                          //   ▲  ascending
                          //   ▼  descending
                          //
                          // A group band has no values of its own, so it
                          // delegates to its first labelled leaf and shows
                          // that leaf's state.
                          const sortedBy = sortTargetFor(
                            header.column as Column<T, unknown>,
                          )
                          if (!sortedBy) return null

                          const dir = sortedBy.getIsSorted()
                          const own = sortedBy.id === header.column.id
                          const glyph = dir === 'asc' ? '▲' : dir === 'desc' ? '▼' : '⇅'
                          const what = own ? '' : ` by ${sortedBy.id}`

                          // Replay the animation only for the column just
                          // clicked. `key` forces a remount so the keyframes
                          // restart even when the class is unchanged (asc →
                          // asc on a different column).
                          const flashing = justSortedId === header.column.id
                          const arrowAnim = !flashing
                            ? ''
                            : dir === 'asc'
                              ? 'jt-sort-arrow--asc'
                              : dir === 'desc'
                                ? 'jt-sort-arrow--desc'
                                : ''

                          return (
                            <button
                              type="button"
                              data-sort-handle="true"
                              aria-label={
                                dir
                                  ? `Sorted ${dir}${what} — click to cycle`
                                  : `Sort${what}`
                              }
                              title={
                                dir === 'asc'
                                  ? `Sorted ascending${what} · click for descending`
                                  : dir === 'desc'
                                    ? `Sorted descending${what} · click to clear`
                                    : `Click to sort${what}`
                              }
                              className={`shrink-0 rounded px-0.5 text-xs leading-none transition-colors sm:hover:bg-slate-300 ${
                                flashing ? 'jt-sort-flash' : ''
                              } ${
                                dir
                                  ? own
                                    ? 'text-accent-600'
                                    : 'text-accent-400'
                                  : 'text-slate-400'
                              }`}
                              // The header beneath selects the column, and the
                              // <th> starts a drag-reorder — this button must
                              // do neither.
                              onPointerDown={(event) => event.stopPropagation()}
                              onClick={(event) => {
                                event.preventDefault()
                                event.stopPropagation()
                                toggleSortFor(header.column as Column<T, unknown>)
                              }}
                            >
                              <span key={`${dir}-${flashing}`} className={arrowAnim}>
                                {glyph}
                              </span>
                            </button>
                          )
                        })()}
                      </div>
                    )}
                    {/* Resize grip: invisible until hovered, so the column edge
                        stays clean but is still draggable. `data-resize-handle`
                        is what tells the column drag layer to keep its hands
                        off - a pointerdown here must resize, never reorder. */}
                    <div
                      data-resize-handle="true"
                      // Finger-sized hit area on touch (16px), trimmed to a
                      // hairline on sm+ where a cursor makes the bulk needless
                      // (§7). touch-none keeps a drag here resizing, not
                      // scrolling; sm:hover paints it only under a cursor.
                      className="absolute right-0 top-0 h-full w-4 sm:w-1.5 select-none touch-none cursor-col-resize sm:hover:bg-slate-300"
                      title="Drag to resize · double-click to fit"
                      onMouseDown={header.getResizeHandler()}
                      onTouchStart={header.getResizeHandler()}
                      // Double-click the resize line to auto-fit (Excel). Batches
                      // across the selection when several columns are selected.
                      onDoubleClick={(event) => {
                        event.preventDefault()
                        event.stopPropagation()
                        autoFitColumns(header.column.id)
                      }}
                    />
                  </th>
                )
              })}
              {/* Trailing spacer cell on the LEAF header row, aligning it with
                  the coordinate row's "+" and each body row's spacer <td>. The
                  add-column "+" itself now lives in the coordinate-letter row so
                  it stays reachable even when this name-header row is hidden. */}
              {onAddColumn && headerRowIndex === headerRowCount - 1 ? (
                <th
                  aria-hidden="true"
                  className="bg-white border border-slate-200 align-middle"
                  style={{
                    position: 'sticky',
                    top: headerRowTops[headerRowIndex + 1] ?? 0,
                    zIndex: 3,
                    width: 40,
                    minWidth: 40,
                  }}
                />
              ) : null}
            </tr>
          ))}
        </thead>
        <tbody>
          {/* Frozen (top-pinned) rows — the "top table". Rendered first, each
              sticky just below the header block and stacked by height, so they
              stay put while the centre scrolls beneath them. */}
          {topRows.map((row, i) =>
            renderBodyRow(row, {
              stickyTop: topOffsets[i],
              separatorBottom: i === topRows.length - 1,
            }),
          )}
          {/* Centre rows — the normal scrolling body (pinned rows excluded). */}
          {centerRows.map((row) => renderBodyRow(row))}
          {/* Frozen-bottom rows — symmetric, sticky to the container floor. */}
          {bottomRows.map((row, i) =>
            renderBodyRow(row, {
              stickyBottom: bottomOffsets[i],
              separatorTop: i === 0,
            }),
          )}
          {/* Full-width "+ Add row" bar, spanning the whole grid (gutter + every
              leaf column + the add-column slot). The button sticks to the left
              edge so it stays reachable while the table scrolls sideways. */}
          {onAddRow ? (
            <tr>
              <td
                colSpan={totalColSpan}
                className="border border-slate-200 bg-white p-0"
              >
                <button
                  type="button"
                  className="btn-ghost-sm"
                  title="Add row"
                  aria-label="Add row"
                  onClick={onAddRow}
                  style={{
                    position: 'sticky',
                    left: 0,
                    border: 'none',
                    background: 'transparent',
                  }}
                >
                  <Plus size={16} aria-hidden="true" />
                  Add row
                </button>
              </td>
            </tr>
          ) : null}
        </tbody>
        {/* No <tfoot>: the old footer just echoed column ids and read as a
            duplicate header row, confusing when the data was empty. */}
      </table>
      {/* Row-drop indicator: a crisp 2px accent line spanning the table at the
          boundary the dragged row would land on. Absolutely positioned in the
          scroller's content coordinates so it rides with vertical scroll; it
          only tweens when reduced motion is off. */}
      {rowDrag.indicator ? (
        <div
          aria-hidden="true"
          className="bg-accent-500"
          style={{
            position: 'absolute',
            left: 0,
            top: rowDrag.indicator.top,
            width: rowDrag.indicator.width,
            height: 2,
            zIndex: 8,
            pointerEvents: 'none',
            ...(rowDrag.reduceMotion ? {} : { transition: 'top 60ms linear' }),
          }}
        />
      ) : null}
      </div>
    </div>
  )
}

export default CustomTable
