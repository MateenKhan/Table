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
import { alignmentFor } from '../columnTypes'
import {
  columnIndexForId,
  columnLetters,
  isKnownColumnId,
  lettersForColumnId,
  NON_DATA_COLUMN_IDS,
} from '../columnOrder'
import {
  Borders,
  resolveFormat,
  useFormatVersion,
} from '../formatting'
import { formulaRefs, useFormulaRefsVersion } from '../formulaRefs'
import CellContextStrip from './CellContextPopup'
import { Plus } from 'lucide-react'

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
 * The Excel coordinate letter shown above a leaf column. Known data columns use
 * the FORMULA engine's frozen letter (definition order, so `A` is whatever `=A1`
 * references, regardless of on-screen position); anything else - the `select`
 * checkbox, a runtime combined column - falls back to its positional index among
 * the data columns, or blanks out for non-data columns entirely.
 */
export function letterForColumn(
  columnId: string,
  positionalIndex: number,
): string {
  if (NON_DATA_COLUMN_IDS.includes(columnId)) return ''
  if (isKnownColumnId(columnId)) return columnLetters(columnIndexForId(columnId))
  return columnLetters(positionalIndex)
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
  if (!isPinned) {
    return { position: 'relative', width: cell.column.getSize() }
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
  const tableRef = React.useRef<HTMLTableElement>(null)
  // Column drag-and-drop. Everything it does between pick-up and drop is
  // imperative (see useColumnDrag), so a drag never re-renders this component.
  const drag = useColumnDrag(table, tableRef)
  // Records the pointer-down position on a header so the click that follows can
  // tell a plain click (select the whole column) from the tail of a drag
  // (reorder — no selection). Shared across headers: only one is ever active.
  const headerClickStart = React.useRef<{ x: number; y: number } | null>(null)
  // Inline header rename ("blank sheet"). The column id currently being renamed,
  // plus its draft text. Only ever one header edits at a time; null = none.
  const [renamingColumnId, setRenamingColumnId] = React.useState<string | null>(
    null,
  )
  const [renameDraft, setRenameDraft] = React.useState('')
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

  const gutterCell =
    'bg-slate-100 text-slate-500 text-2xs font-semibold text-center border border-slate-200'

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

  const [rowHeights, setRowHeights] = React.useState<Record<number, number>>({})

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
        // Lets the row-height measurer find this row by DATA index.
        data-data-index={dataRowIndex}
        style={{ height: rowHeight }}
      >
        {/* Row-number gutter cell, sticky to the left like a pinned column. Shows
            the 1-based screen position; a click selects the whole row, which the
            inline ops strip above the table then reflects. Its bottom edge is a
            resize grip (drag = set height, double-click = auto-fit). A frozen row
            also sticks vertically and sits above the scrolling gutter cells. */}
        <td
          className={`${gutterCell} select-none ${
            isFrozen ? 'bg-slate-200' : ''
          } ${
            dataRowIndex >= 0
              ? 'cursor-pointer transition-colors sm:hover:bg-slate-200'
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
            ...(frozen?.separatorBottom ? { borderBottom: separator } : {}),
            ...(frozen?.separatorTop ? { borderTop: separator } : {}),
          }}
          onClick={
            dataRowIndex >= 0
              ? () => selection?.onRowHeaderClick(rowIndex)
              : undefined
          }
        >
          {rowIndex + 1}
          {dataRowIndex >= 0 ? (
            <div
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
          const cellContent = flexRender(
            cell.column.columnDef.cell,
            cell.getContext(),
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
              className={`border border-slate-200 px-2 text-slate-700 ${
                isFrozen ? 'bg-slate-50' : 'bg-white'
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
  // Driven entirely by the current selection (no click-anchored popup state).
  // A single-column selection shows that column's ops; a single-row selection
  // shows that row's ops (height / freeze wired to the same helpers above); a
  // cell / range / whole-grid (or multi-column / multi-row) selection shows the
  // format-only cluster across every scope key the selection covers. Nothing
  // selected → no strip.
  const scope = selection?.selectionScope
  const stripScopeKeys = selection?.getFormatScopeKeys() ?? []

  let strip: React.ReactNode = null
  if (selection && scope && scope.kind !== 'none' && stripScopeKeys.length) {
    if (scope.kind === 'columns' && scope.columnIds.length === 1) {
      const columnId = scope.columnIds[0]
      strip = (
        <CellContextStrip
          scopeKeys={stripScopeKeys}
          title={`Column ${lettersForColumnId(columnId) || columnId}`}
          table={table}
          column={table.getColumn(columnId) ?? undefined}
          onEnterFormula={
            selection.isReadOnlyColumn(columnId)
              ? undefined
              : () => selection.beginEditColumn(columnId)
          }
          onInsertColumnLeft={
            onInsertColumn ? () => onInsertColumn(columnId, 'left') : undefined
          }
          onInsertColumnRight={
            onInsertColumn ? () => onInsertColumn(columnId, 'right') : undefined
          }
          onDeleteColumn={
            onDeleteColumn ? () => onDeleteColumn(columnId) : undefined
          }
        />
      )
    } else if (scope.kind === 'rows' && scope.rowIndices.length === 1) {
      const dataRowIndex = scope.rowIndices[0]
      const targetRow = rowByDataIndex.get(dataRowIndex)
      const display = targetRow
        ? (screenRowById.get(targetRow.id) ?? dataRowIndex) + 1
        : dataRowIndex + 1
      strip = (
        <CellContextStrip
          scopeKeys={stripScopeKeys}
          title={`Row ${display}`}
          rowHeight={rowHeights[dataRowIndex] ?? metrics.rowHeight}
          onSetRowHeight={(height) => applyRowHeight(dataRowIndex, height)}
          isRowPinned={targetRow?.getIsPinned() === 'top'}
          onToggleRowPin={
            targetRow ? () => toggleRowPin(targetRow) : undefined
          }
          onPromoteToHeader={
            onPromoteRowToHeader
              ? () => onPromoteRowToHeader(dataRowIndex)
              : undefined
          }
        />
      )
    } else {
      // cell / range / all / multi-column / multi-row → format-only.
      const stripTitle =
        scope.kind === 'cell'
          ? 'Cell'
          : scope.kind === 'all'
            ? 'All cells'
            : scope.kind === 'columns'
              ? `${scope.columnIds.length} columns`
              : scope.kind === 'rows'
                ? `${scope.rowIndices.length} rows`
                : 'Selection'
      strip = <CellContextStrip scopeKeys={stripScopeKeys} title={stripTitle} />
    }
  }

  // Commit the in-progress header rename: fall back to the current name when the
  // draft is blank, then leave edit mode. Escape cancels via `cancelRename`.
  const commitRename = (columnId: string, currentName: string) => {
    onRenameColumn?.(columnId, renameDraft.trim() || currentName)
    setRenamingColumnId(null)
  }
  const cancelRename = () => setRenamingColumnId(null)

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
        // tabIndex makes it focusable; the container owns both scroll axes so the
        // page never scrolls sideways (§8), with momentum + no scroll-chaining on
        // touch. The focus outline is suppressed here — the accent cell overlay is
        // the visible focus indicator, so a ring around the whole region would be
        // noise, not signal.
        tabIndex={0}
        style={{
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
        className="border-collapse text-sm text-slate-700"
      >
        <thead ref={theadRef}>
          {/* Coordinate-letter row + the corner "select all" cell. */}
          <tr>
            <th
              // Spans the full header height on the left, forming the corner
              // where the letter row meets the row-number column.
              rowSpan={headerRowCount + 1}
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
              return (
                <th
                  key={`letter-${col.id}`}
                  // Same anchor the drag layer / measurement use elsewhere, so
                  // the letters stay locked to their columns through drag,
                  // resize, pin and hide.
                  data-col-id={col.id}
                  className={`${gutterCell} px-1 ${
                    isData
                      ? 'cursor-pointer transition-colors sm:hover:bg-slate-200'
                      : ''
                  }`}
                  style={letterCellStyle(col)}
                  onClick={
                    isData
                      ? () => selection?.onColumnHeaderClick(col.id)
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
          </tr>
          {table.getHeaderGroups().map((headerGroup, headerRowIndex) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
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
                const isRenaming = renamingColumnId === header.column.id

                return (
                  <th
                    key={header.id}
                    // The drag layer finds and moves cells by column id, and it
                    // measures widths off the header cells.
                    data-col-id={header.column.id}
                    data-header-id={header.id}
                    className="bg-white border border-slate-200 px-2 py-1.5 text-left align-middle font-semibold text-slate-700"
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
                    {header.isPlaceholder ? null : isRenaming ? (
                      // Inline rename editor. Seeded with the current header text
                      // and selected-all; Enter / blur commit, Escape cancels.
                      // Pointer events are stopped so clicking / dragging inside
                      // the field never starts a column drag or a select.
                      <input
                        className="input-sm"
                        autoFocus
                        value={renameDraft}
                        onFocus={(event) => event.currentTarget.select()}
                        onChange={(event) => setRenameDraft(event.target.value)}
                        onPointerDown={(event) => event.stopPropagation()}
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            commitRename(
                              header.column.id,
                              headerLabel as string,
                            )
                          } else if (event.key === 'Escape') {
                            event.preventDefault()
                            cancelRename()
                          }
                        }}
                        onBlur={() =>
                          commitRename(header.column.id, headerLabel as string)
                        }
                      />
                    ) : (
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
                          selection?.onColumnHeaderClick(header.column.id)
                        }}
                      >
                        {/* Group / sort are now in the selection ops strip; the
                            header just shows subtle state indicators. A DOUBLE
                            click on a renamable header turns it into the editor
                            above; a single click still selects the column. */}
                        <span
                          className="flex-1 truncate"
                          style={canRename ? { cursor: 'text' } : undefined}
                          title={canRename ? 'Double-click to rename' : undefined}
                          onDoubleClick={
                            canRename
                              ? (event) => {
                                  event.preventDefault()
                                  event.stopPropagation()
                                  setRenameDraft(headerLabel as string)
                                  setRenamingColumnId(header.column.id)
                                }
                              : undefined
                          }
                        >
                          {canRename && headerLabel === '' ? (
                            // Empty user header: a faint, non-data hint that keeps
                            // the cell tall + double-clickable. Not a real value —
                            // it never enters the model, and typing replaces it.
                            <span className="italic text-slate-300">
                              Name…
                            </span>
                          ) : (
                            flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )
                          )}
                        </span>
                        {header.column.getIsGrouped() ? (
                          <span
                            aria-hidden="true"
                            title="Grouped"
                            className="shrink-0 text-2xs font-semibold text-accent-600"
                          >
                            ⊞
                          </span>
                        ) : null}
                        {header.column.getIsSorted() ? (
                          <span
                            aria-hidden="true"
                            title={`Sorted ${header.column.getIsSorted()}`}
                            className="shrink-0 text-xs text-accent-600"
                          >
                            {header.column.getIsSorted() === 'asc' ? '▲' : '▼'}
                          </span>
                        ) : null}
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
              {/* Add-column "+", on the LEAF header row only (the row that holds
                  the real column headers). It occupies one extra trailing column;
                  each body row gets a matching empty <td> below so the grid stays
                  aligned, and the coordinate-letter / group-parent rows simply
                  leave that last column empty. */}
              {onAddColumn && headerRowIndex === headerRowCount - 1 ? (
                <th
                  className="bg-white border border-slate-200 p-0 align-middle"
                  style={{
                    position: 'sticky',
                    top: headerRowTops[headerRowIndex + 1] ?? 0,
                    zIndex: 3,
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
      </div>
    </div>
  )
}

export default CustomTable
