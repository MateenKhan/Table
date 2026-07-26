import { RowData, Table } from '@tanstack/react-table'
import React from 'react'
import {
  evaluateFormula,
  formulaKey,
  FormulaMap,
  isFormula,
  translateFormula,
} from './formula'
import FillHandle from './components/FillHandle'
import ShortcutsHelp from './components/ShortcutsHelp'
import { TableMeta } from './tableModels'
import {
  acceptsInput,
  isAttachmentType,
  parseTypedValue,
  TypeOptions,
} from './columnTypes'
import { columnDeltaBetween } from './columnOrder'
import { isAttachment } from './attachments'
import { cellScopeKey, colScopeKey, rowScopeKey } from './formatting'
import {
  InternalCell,
  lastInternalCopy,
  parseTSV,
  readClipboardText,
  rememberInternalCopy,
  serializeTSV,
  takeInternalCopy,
  writeClipboardText,
} from './clipboard'
import { CellPatch, FormulaPatch, makeEntry } from './undo'
import { HistoryApi } from './useUndoHistory'

// Screen coordinates: `row` indexes `table.getRowModel().rows` (the sorted /
// filtered / paginated rows as rendered) and `col` indexes
// `table.getVisibleLeafColumns()`. They are deliberately NOT data indices -
// those are read off `row.index` only at the moment we write back.
export type CellPos = { row: number; col: number }

export type CellRect = {
  top: number
  bottom: number
  left: number
  right: number
}

// A description of what the current selection covers, in terms a formatting
// actions bar can act on without knowing anything about screen coordinates.
// `rowIndices` are DATA indices (stable across sort / filter) and `columnIds`
// are column ids — the same identifiers `tableFormatting` scopes are keyed on.
export type SelectionScope = {
  kind: 'none' | 'cell' | 'range' | 'rows' | 'columns' | 'all'
  rowIndices: number[]
  columnIds: string[]
}

export type CellSelectionApi = {
  editingKey: string | null
  // The anchor cell, in the same `${rowId}::${columnId}` form as `editingKey`.
  // Cells that own window-level interactions (paste-to-upload) use it to work
  // out whether the event is theirs.
  activeKey: string | null
  renderDecoration: (pos: CellPos) => React.ReactNode
  onCellMouseDown: (pos: CellPos, event: React.MouseEvent) => void
  onCellMouseEnter: (pos: CellPos) => void
  onCellDoubleClick: (pos: CellPos) => void
  // Excel-style whole-column selection off a header click (by column id).
  // `extend` (Shift) grows a contiguous column range from the anchor column;
  // `additive` (Ctrl) adds it as a separate region for non-contiguous select.
  onColumnHeaderClick: (
    columnId: string,
    mods?: { additive?: boolean; extend?: boolean },
  ) => void
  // Excel-style whole-row selection off a row-number click (by screen row).
  // Same `extend` / `additive` modifiers as `onColumnHeaderClick`.
  onRowHeaderClick: (
    screenRow: number,
    mods?: { additive?: boolean; extend?: boolean },
  ) => void
  // The corner "select all" gesture: the whole grid.
  onSelectAll: () => void
  // Open the formula editor on the first writable data cell of a column. Used by
  // the column context popup's "Enter formula" action. No-op for read-only /
  // unknown columns.
  beginEditColumn: (columnId: string) => void
  getFormula: (dataIndex: number, columnId: string) => string | undefined
  commitEdit: (dataIndex: number, columnId: string, raw: string) => void
  stopEditing: (move?: 'down' | 'right') => void
  takeInitialInput: () => string | null
  // True exactly once after an F2 edit is begun: the editor places the caret at
  // the end and leaves the value un-selected, rather than selecting all of it.
  takeEditCaret: () => boolean
  isReadOnlyColumn: (columnId: string) => boolean
  // Registers the scrollable grid container as the keyboard focus sink, and
  // moves DOM focus onto it. `focusGrid` is what a cell/header/gutter click
  // calls so arrow-key navigation runs off the grid (and the query input, which
  // would otherwise swallow the keys, blurs).
  registerScrollContainer: (el: HTMLElement | null) => void
  focusGrid: () => void
  // Bumped whenever the user presses Enter on an active attachment cell; the
  // active AttachmentCell watches it to open its image preview from the keyboard.
  previewNonce: number
  // What the current selection covers, for a formatting actions bar.
  selectionScope: SelectionScope
  // The `tableFormatting` scope keys the current selection should be formatted
  // through (column keys for a column selection, row keys for a row selection,
  // cell keys for a cell / range, etc.). Empty when nothing is selected.
  getFormatScopeKeys: () => string[]
  // Walk every distinct (dataIndex, columnId) the selection actually covers,
  // region by region (so non-contiguous selections never include the gaps of
  // their bounding box). Return `false` from the callback to stop early.
  forEachSelectedCell: (
    cb: (dataIndex: number, columnId: string) => void | boolean,
  ) => void
  // Clear the CONTENTS of whatever is currently selected — a cell, a range, a
  // whole row / column, or the whole grid — emptying every writable cell and
  // dropping its formula. No-op when nothing is selected. Undoable.
  clearSelection: () => void
}

const CellSelectionContext = React.createContext<CellSelectionApi | null>(null)

export const useCellSelection = () => React.useContext(CellSelectionContext)

// Selection is tier-1 identity, so it wears the brand accent (§2), not a
// generic blue. accent-500 solid edge + accent-500/10 fill.
const ACTIVE_COLOR = '#ff3b1d'
const RANGE_FILL = 'rgba(255, 59, 29, 0.10)'

// Rows a PageUp / PageDown moves the active cell by. A fixed step rather than a
// measured viewport height keeps the hook free of any layout reads.
const PAGE_ROWS = 10

const inRect = (pos: CellPos, rect: CellRect) =>
  pos.row >= rect.top &&
  pos.row <= rect.bottom &&
  pos.col >= rect.left &&
  pos.col <= rect.right

type Props<T extends RowData> = {
  table: Table<T>
  formulas: FormulaMap
  setFormulas: React.Dispatch<React.SetStateAction<FormulaMap>>
  // Columns that cannot be selected at all (e.g. the row-select checkbox).
  skipColumns?: string[]
  // Columns that can be selected but never written (e.g. derived `fullName`).
  readOnlyColumns?: string[]
  // Undo / redo stacks. Every write the grid makes is recorded through this.
  history?: HistoryApi
  children: React.ReactNode
}

export function CellSelectionProvider<T extends RowData>({
  table,
  formulas,
  setFormulas,
  skipColumns = [],
  readOnlyColumns = [],
  history,
  children,
}: Props<T>) {
  const [anchor, setAnchor] = React.useState<CellPos | null>(null)
  const [focus, setFocus] = React.useState<CellPos | null>(null)
  const [editing, setEditing] = React.useState<CellPos | null>(null)
  // The cell the fill handle is currently dragged over - both axes, so the
  // handle fills sideways and diagonally as well as down.
  const [fillTarget, setFillTarget] = React.useState<CellPos | null>(null)
  // Banked (Ctrl-added) selection rectangles for non-contiguous multi-select.
  // The LIVE region is always the anchor/focus rect; a Ctrl gesture "banks" the
  // current live rect here and opens a fresh one, so the full selection is
  // `[...regions, rect]`. Excel-style: Shift extends the live region into a
  // contiguous range, Ctrl adds a separate one (cells, rows or columns).
  const [regions, setRegions] = React.useState<CellRect[]>([])

  // Whether the shortcuts help popup is open (opened with `?`).
  const [helpOpen, setHelpOpen] = React.useState(false)
  // Bumped to ask the active attachment cell to open its preview (Enter on it).
  const [previewNonce, setPreviewNonce] = React.useState(0)

  const dragMode = React.useRef<'none' | 'select' | 'fill'>('none')
  const initialInput = React.useRef<string | null>(null)
  // Set when an edit is begun via F2, so the editor keeps the value un-selected.
  const editCaret = React.useRef(false)
  // The scrollable grid container, used as the DOM focus sink so keyboard
  // navigation has somewhere to live that is not an <input>.
  const scrollRef = React.useRef<HTMLElement | null>(null)

  const skip = React.useMemo(() => new Set(skipColumns), [skipColumns])
  const readOnly = React.useMemo(
    () => new Set([...skipColumns, ...readOnlyColumns]),
    [skipColumns, readOnlyColumns],
  )

  const rect: CellRect | null =
    anchor && focus
      ? {
          top: Math.min(anchor.row, focus.row),
          bottom: Math.max(anchor.row, focus.row),
          left: Math.min(anchor.col, focus.col),
          right: Math.max(anchor.col, focus.col),
        }
      : null

  // Every rectangle the selection covers: the banked Ctrl-regions plus the live
  // anchor/focus rect. The single source of truth for rendering, scope, copy,
  // clear and formatting once multi-select is in play.
  const allRegions = (): CellRect[] => (rect ? [...regions, rect] : [...regions])

  /* ------------------------------------------------------- grid accessors */

  // Read straight off the (stable) table instance so event handlers always see
  // the current row model rather than a stale closure.
  const rows = () => table.getRowModel().rows
  // Must match `row.getVisibleCells()`, which renders left-pinned, then centre,
  // then right-pinned. `getVisibleLeafColumns()` is NOT in that order once
  // anything is pinned, so column indices would silently shift.
  const columnIds = () => [
    ...table.getLeftVisibleLeafColumns(),
    ...table.getCenterVisibleLeafColumns(),
    ...table.getRightVisibleLeafColumns(),
  ].map((c) => c.id)
  const dataRows = () =>
    table.options.data as unknown as Record<string, unknown>[]
  const meta = () => table.options.meta as TableMeta | undefined

  const columnIdAt = (col: number) => columnIds()[col] as string | undefined

  // The column's declared type, which decides how a typed value is parsed and
  // which keystrokes are allowed to open the editor at all.
  const columnOptions = (columnId: string): TypeOptions | undefined =>
    table.getColumn(columnId)?.columnDef.meta

  // Screen row -> underlying `data` index. Grouped (aggregate) rows have no
  // backing data row, so they report -1 and are skipped everywhere.
  const dataIndexAt = (row: number) => {
    const target = rows()[row]
    if (!target || target.getIsGrouped()) return -1
    return target.index
  }

  const isSelectable = (pos: CellPos) => {
    const columnId = columnIdAt(pos.col)
    if (!columnId || skip.has(columnId)) return false
    return dataIndexAt(pos.row) >= 0
  }

  /* --------------------------------------------------------- the focus sink */

  const registerScrollContainer = React.useCallback(
    (el: HTMLElement | null) => {
      scrollRef.current = el
    },
    [],
  )

  // Pull DOM focus onto the grid container. A cell / header / gutter click calls
  // this so (a) arrow-key navigation runs off the grid rather than whatever was
  // focused before, and (b) the global-search query input blurs — which is what
  // dismisses its suggestions, without this file ever touching GlobalSearch.
  const focusGrid = React.useCallback(() => {
    const el = scrollRef.current
    if (el && document.activeElement !== el) el.focus({ preventScroll: true })
  }, [])

  // Whether keyboard navigation is allowed to act on this event. It is, when
  // nothing is focused, the body is, or focus lives inside the grid container —
  // but NOT when a toolbar control or the query input holds focus (those own
  // their own keys). Editing inputs are already filtered out separately.
  const navAllowed = () => {
    const active = document.activeElement
    if (!active || active === document.body) return true
    const sink = scrollRef.current
    return !!sink && (active === sink || sink.contains(active))
  }

  const evalContext = (dataIndex: number) => ({
    currentRow: dataIndex,
    getCell: (rowIndex: number, columnId: string) =>
      dataRows()[rowIndex]?.[columnId],
  })

  /* -------------------------------------------------------- formula store */

  const formulasRef = React.useRef(formulas)
  formulasRef.current = formulas

  const getFormula = (dataIndex: number, columnId: string) =>
    formulasRef.current[formulaKey(dataIndex, columnId)]

  /* ----------------------------------------------------------- write path */

  const historyRef = React.useRef(history)
  historyRef.current = history

  // Every write the grid makes goes through here: one call is one undoable
  // step, however many cells it touches. The patch carries the previous value
  // of each cell *and* of each formula source, which is what lets undo put
  // `data` and `formulas` back in step with each other.
  const commitPatch = (
    label: string,
    cells: CellPatch[],
    formulaPatches: FormulaPatch[] = [],
  ) => {
    const entry = makeEntry(label, cells, formulaPatches)
    if (!entry.cells.length && !entry.formulas.length) return

    if (entry.formulas.length) {
      setFormulas((prev) => {
        const next = { ...prev }
        for (const patch of entry.formulas) {
          if (patch.after === undefined) delete next[patch.key]
          else next[patch.key] = patch.after
        }
        return next
      })
    }

    if (entry.cells.length) {
      meta()?.updateCells(
        entry.cells.map((patch) => ({
          rowIndex: patch.rowIndex,
          columnId: patch.columnId,
          value: patch.after,
        })),
      )
    }

    historyRef.current?.record(entry)
  }

  // A cell patch, read against the current data / formula state.
  const cellPatch = (
    dataIndex: number,
    columnId: string,
    value: unknown,
  ): CellPatch => ({
    rowIndex: dataIndex,
    columnId,
    before: dataRows()[dataIndex]?.[columnId],
    after: value,
  })

  const formulaPatch = (
    dataIndex: number,
    columnId: string,
    text: string | undefined,
  ): FormulaPatch => {
    const key = formulaKey(dataIndex, columnId)
    return { key, before: formulasRef.current[key], after: text }
  }

  const commitEdit = (dataIndex: number, columnId: string, raw: string) => {
    if (readOnly.has(columnId) || dataIndex < 0) return

    if (isFormula(raw)) {
      const text = raw.trim()
      const result = evaluateFormula(text, evalContext(dataIndex))
      commitPatch(
        'edit',
        [
          cellPatch(
            dataIndex,
            columnId,
            result.ok ? result.value : result.error,
          ),
        ],
        [formulaPatch(dataIndex, columnId, text)],
      )
      return
    }

    const previous = dataRows()[dataIndex]?.[columnId]
    commitPatch(
      'edit',
      [
        cellPatch(
          dataIndex,
          columnId,
          parseTypedValue(raw, columnOptions(columnId), previous),
        ),
      ],
      [formulaPatch(dataIndex, columnId, undefined)],
    )
  }

  // Clear the CONTENTS of every cell across one or more rectangles in a single
  // undoable step. Cells shared by overlapping regions are patched once.
  const clearRegions = (targets: CellRect[]) => {
    const cells: CellPatch[] = []
    const formulaPatches: FormulaPatch[] = []
    const seen = new Set<string>()

    for (const target of targets) {
      for (let r = target.top; r <= target.bottom; r++) {
        const dataIndex = dataIndexAt(r)
        if (dataIndex < 0) continue
        for (let c = target.left; c <= target.right; c++) {
          const columnId = columnIdAt(c)
          if (!columnId) continue
          const dedup = `${dataIndex}::${columnId}`
          if (seen.has(dedup)) continue
          // Read-only columns are skipped from clearing EXCEPT image/file
          // (attachment) columns: "read-only" there only means "you can't type
          // into it", not "you can't empty it". Clearing removes the image/file
          // (the AttachmentCell releases its blob when the value changes).
          // Derived columns (fullName, combined) stay skipped since they
          // recompute.
          const metaType = (
            table.getColumn(columnId)?.columnDef.meta as
              | { type?: string }
              | undefined
          )?.type
          const isAttachmentCol = metaType === 'image' || metaType === 'file'
          if (readOnly.has(columnId) && !isAttachmentCol) continue
          seen.add(dedup)
          cells.push(cellPatch(dataIndex, columnId, ''))
          formulaPatches.push(formulaPatch(dataIndex, columnId, undefined))
        }
      }
    }

    commitPatch('clear', cells, formulaPatches)
  }

  // Cut / fill operate on a single rectangle; delegate to the multi-region path.
  const clearCells = (target: CellRect) => clearRegions([target])

  /* ----------------------------------------------------------------- fill */

  // Which cell of the source block feeds `index`, as an offset inside the
  // block. Inside the block it is the identity; outside it repeats the block
  // cyclically in either direction, the way Excel does.
  const fillOffset = (index: number, start: number, end: number) => {
    const span = end - start + 1
    if (index >= start && index <= end) return index - start
    if (index > end) return (index - end - 1) % span
    return span - 1 - ((start - 1 - index) % span)
  }

  // Copy one source cell onto one target cell, appending to the patch.
  const fillCell = (
    sourceIndex: number,
    sourceColumnId: string,
    targetIndex: number,
    targetColumnId: string,
    cells: CellPatch[],
    formulaPatches: FormulaPatch[],
  ) => {
    const sourceFormula =
      formulasRef.current[formulaKey(sourceIndex, sourceColumnId)]

    if (sourceFormula) {
      // Rows shift by the distance travelled *in data-index space* (what the
      // formula's row refs are expressed in); columns shift in A1 letter space
      // (what its column refs are expressed in), which is definition order and
      // not the on-screen order. Bare column-name refs (`age`, `age[3]`) have
      // no column axis at all and are deliberately left alone - see the note on
      // `translateFormula`.
      const translated = translateFormula(
        sourceFormula,
        targetIndex - sourceIndex,
        columnDeltaBetween(sourceColumnId, targetColumnId),
      )
      const result = evaluateFormula(translated, evalContext(targetIndex))
      cells.push(
        cellPatch(
          targetIndex,
          targetColumnId,
          result.ok ? result.value : result.error,
        ),
      )
      formulaPatches.push(formulaPatch(targetIndex, targetColumnId, translated))
      return
    }

    const raw = dataRows()[sourceIndex]?.[sourceColumnId]
    // Attachments (and any other object value) belong to the cell that owns
    // them; there is no sensible way to carry one into a scalar column, so
    // filling out of one is a no-op rather than a stringified `[object]`.
    if (raw !== null && typeof raw === 'object') return

    // Across columns the value has to be re-read through the target column's
    // type, so a number filled into a currency column becomes a currency
    // number rather than a string. Within one column it is already the right
    // shape and is copied verbatim.
    const after =
      sourceColumnId === targetColumnId
        ? (raw ?? '')
        : parseTypedValue(
            raw === null || raw === undefined ? '' : String(raw),
            columnOptions(targetColumnId),
            dataRows()[targetIndex]?.[targetColumnId],
          )

    cells.push(cellPatch(targetIndex, targetColumnId, after))
    formulaPatches.push(formulaPatch(targetIndex, targetColumnId, undefined))
  }

  // Fill from the selection to wherever the handle was dragged. The filled
  // area is the bounding box of the selection and the drag target, so dragging
  // sideways fills across, and dragging diagonally fills both axes at once.
  const applyFill = (target: CellPos | null, source: CellRect | null) => {
    if (!source || !target) return

    const area: CellRect = {
      top: Math.min(source.top, target.row),
      bottom: Math.max(source.bottom, target.row),
      left: Math.min(source.left, target.col),
      right: Math.max(source.right, target.col),
    }

    const grew =
      area.top !== source.top ||
      area.bottom !== source.bottom ||
      area.left !== source.left ||
      area.right !== source.right
    if (!grew) return

    const cells: CellPatch[] = []
    const formulaPatches: FormulaPatch[] = []

    for (let r = area.top; r <= area.bottom; r++) {
      const targetIndex = dataIndexAt(r)
      // Grouped (aggregate) rows have no backing data row.
      if (targetIndex < 0) continue
      const sourceIndex = dataIndexAt(
        source.top + fillOffset(r, source.top, source.bottom),
      )
      if (sourceIndex < 0) continue
      const sourceRowIsTarget = r >= source.top && r <= source.bottom

      for (let c = area.left; c <= area.right; c++) {
        // The selection itself is never rewritten.
        if (sourceRowIsTarget && c >= source.left && c <= source.right) continue

        const targetColumnId = columnIdAt(c)
        if (!targetColumnId || readOnly.has(targetColumnId)) continue
        const sourceColumnId = columnIdAt(
          source.left + fillOffset(c, source.left, source.right),
        )
        if (!sourceColumnId) continue

        fillCell(
          sourceIndex,
          sourceColumnId,
          targetIndex,
          targetColumnId,
          cells,
          formulaPatches,
        )
      }
    }

    commitPatch('fill', cells, formulaPatches)
    // Excel leaves the whole filled block selected.
    setAnchor({ row: area.top, col: area.left })
    setFocus({ row: area.bottom, col: area.right })
  }

  /* --------------------------------------------------------- interactions */

  const rectRef = React.useRef(rect)
  rectRef.current = rect
  const regionsRef = React.useRef(regions)
  regionsRef.current = regions
  // The cell a Ctrl+Space / Ctrl+click last added, i.e. the anchor a following
  // Shift+Space extends its contiguous range from. Cleared on a fresh (plain)
  // selection.
  const multiAnchorRef = React.useRef<CellPos | null>(null)
  const anchorRef = React.useRef(anchor)
  anchorRef.current = anchor
  const fillTargetRef = React.useRef(fillTarget)
  fillTargetRef.current = fillTarget
  const editingRef = React.useRef(editing)
  editingRef.current = editing
  // The window listeners below are installed once, so they must not close over
  // a first-render `applyFill` (which would hold a stale `readOnly` set).
  const applyFillRef = React.useRef(applyFill)
  applyFillRef.current = applyFill

  React.useEffect(() => {
    const onMouseUp = () => {
      const mode = dragMode.current
      dragMode.current = 'none'
      if (mode !== 'fill') return
      applyFillRef.current(fillTargetRef.current, rectRef.current)
      setFillTarget(null)
    }

    window.addEventListener('mouseup', onMouseUp)
    return () => window.removeEventListener('mouseup', onMouseUp)
  }, [])

  /* ------------------------------------------------------------ clipboard */

  // What a cell contributes to the TSV. Formulas contribute their *result* -
  // the value stored in `data` - so the text is useful in Excel; the source is
  // carried separately in the internal payload below.
  const clipboardText = (value: unknown): string => {
    if (value === null || value === undefined) return ''
    if (typeof value === 'object') {
      return isAttachment(value) ? value.name : ''
    }
    return String(value)
  }

  const copyRange = (cut: boolean) => {
    const source = rectRef.current
    if (!source) return

    const grid: string[][] = []
    const internal: InternalCell[] = []

    for (let r = source.top; r <= source.bottom; r++) {
      const dataIndex = dataIndexAt(r)
      const line: string[] = []
      for (let c = source.left; c <= source.right; c++) {
        const columnId = columnIdAt(c)
        if (!columnId || skip.has(columnId) || dataIndex < 0) {
          // Grouped rows and the checkbox column keep the rectangle's shape
          // but carry nothing.
          line.push('')
          continue
        }
        const value = dataRows()[dataIndex]?.[columnId]
        line.push(clipboardText(value))
        internal.push({
          rowOffset: r - source.top,
          colOffset: c - source.left,
          dataIndex,
          columnId,
          value,
          formula: formulasRef.current[formulaKey(dataIndex, columnId)],
        })
      }
      grid.push(line)
    }

    const text = serializeTSV(grid)
    rememberInternalCopy({
      text,
      height: source.bottom - source.top + 1,
      width: source.right - source.left + 1,
      cells: internal,
      cut,
    })

    // Fire and forget: a refused clipboard permission must not break the grid,
    // and an in-app paste still works off the internal payload.
    void writeClipboardText(text)

    // Cut is copy-then-clear, so it is one undoable step and the pasted cells
    // are translated exactly as a copy would be.
    if (cut) clearCells(source)
  }

  const pasteAt = (target: CellPos, text: string) => {
    const grid = parseTSV(text)
    if (!grid.length) return

    // Byte-identical to what we last copied => it is ours, so formula sources
    // come along. Anything else is plain TSV from another application.
    const internal = takeInternalCopy(text)
    const sourceCells = new Map<string, InternalCell>()
    if (internal) {
      for (const cell of internal.cells) {
        sourceCells.set(`${cell.rowOffset}:${cell.colOffset}`, cell)
      }
    }

    const height = internal?.height ?? grid.length
    const width =
      internal?.width ?? grid.reduce((max, line) => Math.max(max, line.length), 0)
    if (!height || !width) return

    const cells: CellPatch[] = []
    const formulaPatches: FormulaPatch[] = []
    const rowCount = rows().length
    const colCount = columnIds().length
    // Clamped at the grid edges rather than wrapping or growing the table.
    const lastRow = Math.min(target.row + height - 1, rowCount - 1)
    const lastCol = Math.min(target.col + width - 1, colCount - 1)

    for (let i = 0; i < height; i++) {
      const screenRow = target.row + i
      if (screenRow >= rowCount) break
      const targetIndex = dataIndexAt(screenRow)
      // Grouped rows are skipped, keeping the block aligned with what is on
      // screen rather than shifting everything below them up by one.
      if (targetIndex < 0) continue

      for (let j = 0; j < width; j++) {
        const screenCol = target.col + j
        if (screenCol >= colCount) break
        const columnId = columnIdAt(screenCol)
        // Read-only / skip columns no-op per cell; the rest of the paste lands.
        if (!columnId || readOnly.has(columnId)) continue

        const source = sourceCells.get(`${i}:${j}`)

        if (source?.formula) {
          const translated = translateFormula(
            source.formula,
            targetIndex - source.dataIndex,
            columnDeltaBetween(source.columnId, columnId),
          )
          const result = evaluateFormula(translated, evalContext(targetIndex))
          cells.push(
            cellPatch(
              targetIndex,
              columnId,
              result.ok ? result.value : result.error,
            ),
          )
          formulaPatches.push(formulaPatch(targetIndex, columnId, translated))
          continue
        }

        const raw = grid[i]?.[j] ?? ''
        cells.push(
          cellPatch(
            targetIndex,
            columnId,
            parseTypedValue(
              raw,
              columnOptions(columnId),
              dataRows()[targetIndex]?.[columnId],
            ),
          ),
        )
        formulaPatches.push(formulaPatch(targetIndex, columnId, undefined))
      }
    }

    commitPatch('paste', cells, formulaPatches)
    setAnchor(target)
    setFocus({ row: lastRow, col: lastCol })
  }

  const pasteAtRef = React.useRef(pasteAt)
  pasteAtRef.current = pasteAt
  // Set by the native `paste` event so the Ctrl+V fallback below knows it does
  // not need to read the clipboard itself.
  const pasteEventSeen = React.useRef(false)

  React.useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (editingRef.current || event.defaultPrevented) return

      const at = anchorRef.current
      if (!at) return

      // Another control (global search, a filter box) owns the paste.
      const tag = (event.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      // A pasted file belongs to the attachment cell, which has its own
      // window listener.
      if (event.clipboardData?.files?.length) return

      const text = event.clipboardData?.getData('text/plain') ?? ''
      // No text on the event: leave `pasteEventSeen` alone so the Ctrl+V
      // fallback below still gets its turn.
      if (!text) return

      pasteEventSeen.current = true
      event.preventDefault()
      pasteAtRef.current(at, text)
    }

    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  // Ctrl+V when the native paste event does not arrive, or arrives with an
  // empty `clipboardData` (which is what a browser hands over when the page is
  // not allowed to see the clipboard): read it asynchronously instead, and
  // fall back to the payload of the last in-app copy when that is refused too.
  // `readText` can hang indefinitely behind a permission prompt, so it races a
  // timer rather than being awaited on its own.
  const pasteFromClipboard = (at: CellPos) => {
    pasteEventSeen.current = false
    window.setTimeout(() => {
      if (pasteEventSeen.current) return
      const timeout = new Promise<string | null>((resolve) => {
        window.setTimeout(() => resolve(null), 1200)
      })
      void Promise.race([readClipboardText(), timeout]).then((text) => {
        if (pasteEventSeen.current) return
        if (text) {
          pasteAtRef.current(at, text)
          return
        }
        const fallback = lastInternalCopy()
        if (fallback) pasteAtRef.current(at, fallback.text)
      })
    }, 60)
  }

  const onCellMouseDown = (pos: CellPos, event: React.MouseEvent) => {
    if (event.button !== 0) return
    if (!isSelectable(pos)) return
    // Clicks inside the cell currently being edited belong to the input.
    if (
      editing &&
      editing.row === pos.row &&
      editing.col === pos.col
    )
      return

    // Suppresses native text selection while dragging across cells, and keeps
    // the read-only inputs from stealing focus.
    event.preventDefault()
    setEditing(null)
    // preventDefault stops the browser moving focus for us, so do it by hand:
    // this is what makes keyboard nav take over and blurs the query input.
    focusGrid()

    // Ctrl / Cmd (without Shift) banks the current region and opens a fresh
    // one — non-contiguous multi-select. Shift extends the live region.
    const additive = (event.ctrlKey || event.metaKey) && !event.shiftKey
    if (event.shiftKey && anchor) {
      setFocus(pos)
    } else if (additive && rect) {
      setRegions((prev) => [...prev, rect])
      multiAnchorRef.current = pos
      setAnchor(pos)
      setFocus(pos)
    } else {
      setRegions([])
      multiAnchorRef.current = null
      setAnchor(pos)
      setFocus(pos)
    }
    dragMode.current = 'select'
  }

  const onCellMouseEnter = (pos: CellPos) => {
    if (dragMode.current === 'select') {
      if (isSelectable(pos)) setFocus(pos)
    } else if (dragMode.current === 'fill') {
      // Rows are taken as they come (grouped rows are skipped when the fill is
      // applied), but a skip column is never a legal edge, so the column half
      // stays where it was.
      setFillTarget((prev) => {
        const columnId = columnIdAt(pos.col)
        const col =
          !columnId || skip.has(columnId) ? (prev?.col ?? pos.col) : pos.col
        return { row: pos.row, col }
      })
    }
  }

  const onCellDoubleClick = (pos: CellPos) => {
    if (!isSelectable(pos)) return
    const columnId = columnIdAt(pos.col)
    if (!columnId || readOnly.has(columnId)) return
    setRegions([])
    multiAnchorRef.current = null
    setAnchor(pos)
    setFocus(pos)
    beginEdit(pos)
  }

  // Excel-style whole-column selection: clicking a data column's header spans
  // the selection from the first to the last row for that one column, reusing
  // the same anchor/focus range everything else already renders and copies
  // from. Skip columns (the row-select checkbox) opt out entirely.
  const onColumnHeaderClick = (
    columnId: string,
    mods: { additive?: boolean; extend?: boolean } = {},
  ) => {
    if (skip.has(columnId)) return
    const col = columnIds().indexOf(columnId)
    if (col < 0) return
    const lastRow = rows().length - 1
    if (lastRow < 0) return
    setEditing(null)
    dragMode.current = 'none'
    focusGrid()
    // Shift: contiguous column range from the anchor column to this one.
    if (mods.extend && anchor) {
      setAnchor({ row: 0, col: anchor.col })
      setFocus({ row: lastRow, col })
      return
    }
    // Ctrl: bank the live region and add this column as a separate one.
    if (mods.additive && rect) setRegions((prev) => [...prev, rect])
    else setRegions([])
    setAnchor({ row: 0, col })
    setFocus({ row: lastRow, col })
  }

  // Excel-style whole-row selection: clicking a row-number gutter cell spans the
  // selection across every column of that one row. Grouped (aggregate) rows have
  // no backing data and opt out.
  const onRowHeaderClick = (
    screenRow: number,
    mods: { additive?: boolean; extend?: boolean } = {},
  ) => {
    if (dataIndexAt(screenRow) < 0) return
    const lastCol = columnIds().length - 1
    if (lastCol < 0) return
    setEditing(null)
    dragMode.current = 'none'
    focusGrid()
    // Shift: contiguous row range from the anchor row to this one.
    if (mods.extend && anchor) {
      setAnchor({ row: anchor.row, col: 0 })
      setFocus({ row: screenRow, col: lastCol })
      return
    }
    // Ctrl: bank the live region and add this row as a separate one.
    if (mods.additive && rect) setRegions((prev) => [...prev, rect])
    else setRegions([])
    setAnchor({ row: screenRow, col: 0 })
    setFocus({ row: screenRow, col: lastCol })
  }

  // The top-left corner gesture: select the whole grid, reusing the same
  // anchor/focus rectangle everything else renders and copies from.
  const onSelectAll = () => {
    const lastRow = rows().length - 1
    const lastCol = columnIds().length - 1
    if (lastRow < 0 || lastCol < 0) return
    setEditing(null)
    dragMode.current = 'none'
    focusGrid()
    setRegions([])
    multiAnchorRef.current = null
    setAnchor({ row: 0, col: 0 })
    setFocus({ row: lastRow, col: lastCol })
  }

  // Drop straight into the formula editor on a column's first writable data
  // cell. Read-only / unknown columns (or a sheet with no data rows) no-op, so
  // the popup can surface the action as disabled.
  const beginEditColumn = (columnId: string) => {
    if (readOnly.has(columnId)) return
    const col = columnIds().indexOf(columnId)
    if (col < 0) return
    const rowCount = rows().length
    for (let r = 0; r < rowCount; r++) {
      if (dataIndexAt(r) < 0) continue
      const pos = { row: r, col }
      setAnchor(pos)
      setFocus(pos)
      focusGrid()
      beginEdit(pos)
      return
    }
  }

  const startFill = (event: React.MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (!rect) return
    dragMode.current = 'fill'
    setFillTarget({ row: rect.bottom, col: rect.right })
  }

  const fillToBottom = () => {
    const current = rectRef.current
    if (!current) return
    const last = rows().length - 1
    if (last > current.bottom) {
      applyFill({ row: last, col: current.right }, current)
    }
  }

  const stopEditing = (move?: 'down' | 'right') => {
    const at = editingRef.current
    setEditing(null)
    if (!move || !at) return

    const step = move === 'down' ? { row: at.row + 1, col: at.col } : null
    const next = step ?? nextSelectableColumn(at, 1)
    if (next && isSelectable(next)) {
      setAnchor(next)
      setFocus(next)
    }
  }

  const takeInitialInput = () => {
    const value = initialInput.current
    initialInput.current = null
    return value
  }

  const takeEditCaret = () => {
    const value = editCaret.current
    editCaret.current = false
    return value
  }

  // Begin editing a cell. `caret` (F2) keeps the value un-selected; otherwise
  // (Enter, double-click, formula jump) the editor selects all.
  const beginEdit = (pos: CellPos, caret = false) => {
    editCaret.current = caret
    setEditing(pos)
  }

  /* -------------------------------------------------------- keyboard nav */

  const selectableColumns = () =>
    columnIds()
      .map((id, index) => (skip.has(id) ? -1 : index))
      .filter((index) => index >= 0)

  const nextSelectableColumn = (pos: CellPos, delta: number): CellPos | null => {
    const cols = selectableColumns()
    const at = cols.indexOf(pos.col)
    const next = cols[Math.min(Math.max(at + delta, 0), cols.length - 1)]
    return next === undefined ? null : { row: pos.row, col: next }
  }

  // The first / last column a cell may live in (Home / End, grid corners).
  const edgeColumn = (which: 'first' | 'last'): number | undefined => {
    const cols = selectableColumns()
    return which === 'first' ? cols[0] : cols[cols.length - 1]
  }

  // The first / last screen row that backs a real data row (grouped rows skip).
  const edgeRow = (which: 'first' | 'last'): number => {
    const count = rows().length
    if (which === 'first') {
      for (let r = 0; r < count; r++) if (dataIndexAt(r) >= 0) return r
      return 0
    }
    for (let r = count - 1; r >= 0; r--) if (dataIndexAt(r) >= 0) return r
    return count - 1
  }

  // Jump the selection straight to `target`. Extends the range from the anchor
  // when `extend`, otherwise collapses onto the new cell.
  const moveTo = (target: CellPos, extend: boolean) => {
    if (!isSelectable(target)) return
    // The live cell moves; banked (Ctrl+Space / Ctrl+click) regions persist so
    // a multi-selection can be built entirely from the keyboard.
    setFocus(target)
    if (!extend) setAnchor(target)
  }

  const move = (rowDelta: number, colDelta: number, extend: boolean) => {
    const from = extend ? focus : anchor
    if (!from) return

    let next: CellPos = { row: from.row, col: from.col }
    if (colDelta) next = nextSelectableColumn(next, colDelta) ?? next
    if (rowDelta) {
      const candidate = Math.min(
        Math.max(next.row + rowDelta, 0),
        rows().length - 1,
      )
      next = { row: candidate, col: next.col }
    }
    if (!isSelectable(next)) return

    setFocus(next)
    if (!extend) setAnchor(next)
  }

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (editingRef.current) return

      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return

      // `?` (Shift+/) toggles the shortcuts help. Handled before everything else
      // so it works with or without a selection, and never starts a cell edit.
      if (event.key === '?') {
        event.preventDefault()
        setHelpOpen((open) => !open)
        return
      }

      const accel = event.ctrlKey || event.metaKey
      const key = event.key.toLowerCase()

      if (accel && !event.altKey) {
        // Undo / redo need no selection at all.
        if (key === 'z' || key === 'y') {
          event.preventDefault()
          if (key === 'y' || event.shiftKey) historyRef.current?.redo()
          else historyRef.current?.undo()
          return
        }
        if ((key === 'c' || key === 'x') && rectRef.current) {
          event.preventDefault()
          copyRange(key === 'x')
          return
        }
        if (key === 'v' && anchor) {
          // Deliberately no preventDefault: the native `paste` event is the
          // path that needs no clipboard permission.
          pasteFromClipboard(anchor)
          return
        }
        // Select-all the grid — but only when the grid, not a toolbar control,
        // owns focus, so a page-wide Ctrl+A elsewhere is left alone.
        if (key === 'a' && navAllowed()) {
          event.preventDefault()
          onSelectAll()
          return
        }
      }

      if (!anchor || !focus) return

      // Everything below drives the active cell, so it must not fire while a
      // toolbar control or the query input holds focus (those own their keys).
      if (!navAllowed()) return

      const extend = event.shiftKey
      const base = extend ? focus : anchor

      switch (event.key) {
        case 'ArrowUp':
          event.preventDefault()
          return move(-1, 0, extend)
        case 'ArrowDown':
          event.preventDefault()
          return move(1, 0, extend)
        case 'ArrowLeft':
          event.preventDefault()
          return move(0, -1, extend)
        case 'ArrowRight':
          event.preventDefault()
          return move(0, 1, extend)
        case 'Tab':
          // Tab / Shift+Tab step right / left. It collapses the range (never
          // extends), matching a spreadsheet, and stays inside the grid rather
          // than tabbing out to the next DOM control.
          event.preventDefault()
          return move(0, extend ? -1 : 1, false)
        case 'Home': {
          event.preventDefault()
          const col = edgeColumn('first')
          if (col === undefined) return
          // Ctrl+Home jumps to the grid's first cell; plain Home to row start.
          return moveTo({ row: accel ? edgeRow('first') : base.row, col }, extend)
        }
        case 'End': {
          event.preventDefault()
          const col = edgeColumn('last')
          if (col === undefined) return
          return moveTo({ row: accel ? edgeRow('last') : base.row, col }, extend)
        }
        case 'PageUp':
          event.preventDefault()
          return move(-PAGE_ROWS, 0, extend)
        case 'PageDown':
          event.preventDefault()
          return move(PAGE_ROWS, 0, extend)
        case ' ':
          // Space acts like a click. Ctrl+Space is the keyboard twin of
          // Ctrl+click: it banks the live cell/range as a separate region so a
          // non-contiguous selection can be grown with the arrow keys.
          // Shift+Space is Shift+click: it extends the last-added region from
          // its anchor to the active cell. Plain space starts an edit.
          if (accel && rectRef.current && anchorRef.current) {
            event.preventDefault()
            const live = rectRef.current
            setRegions((prev) => [...prev, live])
            multiAnchorRef.current = anchorRef.current
            return
          }
          if (event.shiftKey && anchorRef.current) {
            event.preventDefault()
            const from = multiAnchorRef.current ?? anchorRef.current
            const to = anchorRef.current
            const ext: CellRect = {
              top: Math.min(from.row, to.row),
              bottom: Math.max(from.row, to.row),
              left: Math.min(from.col, to.col),
              right: Math.max(from.col, to.col),
            }
            // Replace the region the anchor opened with its extended range;
            // with no prior Ctrl+Space, add the active cell as a new region.
            setRegions((prev) =>
              multiAnchorRef.current && prev.length
                ? [...prev.slice(0, -1), ext]
                : [...prev, ext],
            )
            return
          }
          break
        case 'Escape':
          event.preventDefault()
          setRegions([])
          multiAnchorRef.current = null
          setAnchor(null)
          setFocus(null)
          return
        case 'Enter':
        case 'F2': {
          const columnId = columnIdAt(anchor.col)
          if (!columnId) return
          const type = columnOptions(columnId)?.type
          // Enter on an image / attachment cell opens the preview rather than
          // an editor there is no sensible text editor for. F2 is a no-op there.
          if (isAttachmentType(type)) {
            if (event.key === 'Enter') {
              event.preventDefault()
              setPreviewNonce((nonce) => nonce + 1)
            }
            return
          }
          if (readOnly.has(columnId)) return
          event.preventDefault()
          // F2 keeps the value un-selected (caret at end); Enter selects all.
          beginEdit(anchor, event.key === 'F2')
          return
        }
        case 'Delete':
        case 'Backspace':
          event.preventDefault()
          if (rectRef.current)
            clearRegions(
              regionsRef.current.length
                ? [...regionsRef.current, rectRef.current]
                : [rectRef.current],
            )
          return
        default:
          break
      }

      if (
        event.key.length === 1 &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey
      ) {
        const columnId = columnIdAt(anchor.col)
        if (!columnId || readOnly.has(columnId)) return
        // Typing a letter into a numeric column must not open the editor with
        // a value the column could never hold.
        if (!acceptsInput(event.key, columnOptions(columnId)?.type)) return
        event.preventDefault()
        initialInput.current = event.key
        beginEdit(anchor)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  /* --------------------------------------------------- view invalidation */

  // Selection is expressed in screen coordinates, so it stops meaning anything
  // as soon as the rendered row/column set changes. Editing and filling only
  // touch `data`, which is not part of this signature.
  const state = table.getState()
  const viewSignature = JSON.stringify([
    state.pagination?.pageIndex,
    state.pagination?.pageSize,
    state.sorting,
    state.grouping,
    state.columnFilters,
    state.globalFilter,
    state.columnOrder,
    state.columnVisibility,
    state.columnPinning,
  ])

  React.useEffect(() => {
    dragMode.current = 'none'
    setAnchor(null)
    setFocus(null)
    setEditing(null)
    setFillTarget(null)
    setRegions([])
    multiAnchorRef.current = null
  }, [viewSignature])

  /* ------------------------------------------------------------ rendering */

  const fillPreview: CellRect | null = (() => {
    if (!rect || !fillTarget) return null
    const preview: CellRect = {
      top: Math.min(fillTarget.row, rect.top),
      bottom: Math.max(fillTarget.row, rect.bottom),
      left: Math.min(fillTarget.col, rect.left),
      right: Math.max(fillTarget.col, rect.right),
    }
    const grew =
      preview.top !== rect.top ||
      preview.bottom !== rect.bottom ||
      preview.left !== rect.left ||
      preview.right !== rect.right
    return grew ? preview : null
  })()

  const renderDecoration = (pos: CellPos): React.ReactNode => {
    if (!rect) return null

    const regs = regions.length ? [...regions, rect] : [rect]
    // A cell belongs to the selection if ANY region covers it. Membership drives
    // both the fill and, per-side, whether an accent edge is drawn (an edge is
    // painted only where the neighbouring cell is OUTSIDE the selection), so
    // each region — contiguous or not — gets a clean outline.
    const inSelection = (r: number, c: number) =>
      regs.some((rg) => inRect({ row: r, col: c }, rg))

    const selected = inSelection(pos.row, pos.col)
    const previewed = !!fillPreview && !selected && inRect(pos, fillPreview)
    if (!selected && !previewed) return null

    const isActive = !!anchor && anchor.row === pos.row && anchor.col === pos.col
    // The fill handle rides the bottom-right of the LIVE region only.
    const isHandleCell = pos.row === rect.bottom && pos.col === rect.right

    const edge = (on: boolean) => (on ? `2px solid ${ACTIVE_COLOR}` : '0')

    const style: React.CSSProperties = previewed
      ? {
          position: 'absolute',
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          zIndex: 2,
          pointerEvents: 'none',
          background: 'rgba(255, 59, 29, 0.06)',
          borderTop: pos.row === fillPreview!.top ? '1px dashed #94a3b8' : '0',
          borderBottom:
            pos.row === fillPreview!.bottom ? '1px dashed #94a3b8' : '0',
          borderLeft:
            pos.col === fillPreview!.left ? '1px dashed #94a3b8' : '0',
          borderRight:
            pos.col === fillPreview!.right ? '1px dashed #94a3b8' : '0',
        }
      : isActive
        ? {
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            zIndex: 3,
            pointerEvents: 'none',
            border: `2px solid ${ACTIVE_COLOR}`,
          }
        : {
            position: 'absolute',
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            zIndex: 2,
            pointerEvents: 'none',
            background: RANGE_FILL,
            borderTop: edge(!inSelection(pos.row - 1, pos.col)),
            borderBottom: edge(!inSelection(pos.row + 1, pos.col)),
            borderLeft: edge(!inSelection(pos.row, pos.col - 1)),
            borderRight: edge(!inSelection(pos.row, pos.col + 1)),
          }

    return (
      <>
        <div style={style} />
        {selected && isHandleCell && !editing ? (
          <FillHandle onFillStart={startFill} onFillToBottom={fillToBottom} />
        ) : null}
      </>
    )
  }

  const editingKey = (() => {
    if (!editing) return null
    const row = rows()[editing.row]
    const columnId = columnIdAt(editing.col)
    if (!row || !columnId) return null
    return `${row.id}::${columnId}`
  })()

  const activeKey = (() => {
    if (!anchor) return null
    const row = rows()[anchor.row]
    const columnId = columnIdAt(anchor.col)
    if (!row || !columnId) return null
    return `${row.id}::${columnId}`
  })()

  /* ---------------------------------------------------- selection scope API */

  // A stable, coordinate-free description of what the selection covers, plus the
  // exact formatting scope keys it maps to. A future actions bar reads these to
  // call `tableFormatting.update(scope, …)` without touching screen geometry.
  const selectionScope: SelectionScope = (() => {
    const regs = allRegions()
    if (!regs.length) return { kind: 'none', rowIndices: [], columnIds: [] }

    // Union of selected data-row indices and column ids across every region
    // (grouped rows and skip columns drop out), de-duplicated but order-stable.
    const rowSeen = new Set<number>()
    const colSeen = new Set<string>()
    const rowIndices: number[] = []
    const columnIds: string[] = []
    for (const rg of regs) {
      for (let r = rg.top; r <= rg.bottom; r++) {
        const dataIndex = dataIndexAt(r)
        if (dataIndex >= 0 && !rowSeen.has(dataIndex)) {
          rowSeen.add(dataIndex)
          rowIndices.push(dataIndex)
        }
      }
      for (let c = rg.left; c <= rg.right; c++) {
        const columnId = columnIdAt(c)
        if (columnId && !skip.has(columnId) && !colSeen.has(columnId)) {
          colSeen.add(columnId)
          columnIds.push(columnId)
        }
      }
    }

    const selectable = selectableColumns()
    const firstCol = selectable[0]
    const lastCol = selectable[selectable.length - 1]
    const lastRow = rows().length - 1
    const isFullWidth = (rg: CellRect) =>
      firstCol !== undefined &&
      lastCol !== undefined &&
      rg.left <= firstCol &&
      rg.right >= lastCol
    const isFullHeight = (rg: CellRect) => rg.top <= 0 && rg.bottom >= lastRow

    // A whole-column / whole-row selection stays that "kind" even when several
    // are Ctrl-added, so column/row formatting and header highlighting apply.
    const everyFullWidth = regs.every(isFullWidth)
    const everyFullHeight = regs.every(isFullHeight)
    const singleCell =
      regs.length === 1 &&
      regs[0].top === regs[0].bottom &&
      regs[0].left === regs[0].right

    const kind: SelectionScope['kind'] =
      everyFullWidth && everyFullHeight
        ? 'all'
        : everyFullWidth
          ? 'rows'
          : everyFullHeight
            ? 'columns'
            : singleCell
              ? 'cell'
              : 'range'

    return { kind, rowIndices, columnIds }
  })()

  // Visit every distinct (dataIndex, columnId) the selection actually covers,
  // walking each region so non-contiguous multi-select never spills into the
  // gaps of its bounding box. Skip columns and grouped rows drop out. A callback
  // that returns `false` stops the walk (used to honour a scan cap).
  const forEachSelectedCell = (
    cb: (dataIndex: number, columnId: string) => void | boolean,
  ) => {
    const seen = new Set<string>()
    for (const rg of allRegions()) {
      for (let r = rg.top; r <= rg.bottom; r++) {
        const dataIndex = dataIndexAt(r)
        if (dataIndex < 0) continue
        for (let c = rg.left; c <= rg.right; c++) {
          const columnId = columnIdAt(c)
          if (!columnId || skip.has(columnId)) continue
          const key = `${dataIndex}::${columnId}`
          if (seen.has(key)) continue
          seen.add(key)
          if (cb(dataIndex, columnId) === false) return
        }
      }
    }
  }

  // The `tableFormatting` scope keys the selection should be written through:
  // column keys for a column / whole-grid selection (fewest keys that cover it),
  // row keys for a row selection, cell keys for a cell or free range.
  const getFormatScopeKeys = (): string[] => {
    const { kind, rowIndices, columnIds } = selectionScope
    switch (kind) {
      case 'none':
        return []
      case 'columns':
      case 'all':
        return columnIds.map(colScopeKey)
      case 'rows':
        return rowIndices.map(rowScopeKey)
      case 'cell':
      case 'range': {
        const keys: string[] = []
        forEachSelectedCell((rowIndex, columnId) => {
          keys.push(cellScopeKey(rowIndex, columnId))
        })
        return keys
      }
    }
  }

  const api: CellSelectionApi = {
    editingKey,
    activeKey,
    renderDecoration,
    onCellMouseDown,
    onCellMouseEnter,
    onCellDoubleClick,
    onColumnHeaderClick,
    onRowHeaderClick,
    onSelectAll,
    beginEditColumn,
    getFormula,
    commitEdit,
    stopEditing,
    takeInitialInput,
    takeEditCaret,
    isReadOnlyColumn: (columnId: string) => readOnly.has(columnId),
    registerScrollContainer,
    focusGrid,
    previewNonce,
    selectionScope,
    getFormatScopeKeys,
    // One unified clear for any selection — the rect already spans a cell, a
    // range, a full row / column, or the whole grid, so clearing it empties
    // exactly what the user picked.
    clearSelection: () => {
      const regs = allRegions()
      if (regs.length) clearRegions(regs)
    },
    forEachSelectedCell,
  }

  return (
    <CellSelectionContext.Provider value={api}>
      {children}
      {helpOpen ? <ShortcutsHelp onClose={() => setHelpOpen(false)} /> : null}
    </CellSelectionContext.Provider>
  )
}

export default CellSelectionProvider
