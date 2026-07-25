import {
  ColumnFiltersState,
  ColumnOrderState,
  ColumnPinningState,
  RowPinningState,
  getCoreRowModel,
  getFacetedMinMaxValues,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getGroupedRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  GroupingState,
  useReactTable,
} from '@tanstack/react-table'
import React from 'react'
import type { Person } from './makeData'

import { useSkipper } from './hooks'
import {
  columns as baseColumns,
  defaultColumn,
  getTableMeta,
  READ_ONLY_COLUMNS,
  SKIP_COLUMNS,
} from './tableModels'
import {
  buildMergedColumns,
  collectColumnIds,
  ColumnMerge,
  loadStoredMerges,
  mergeIdFor,
  storeMerges,
} from './columnMerge'
import {
  emptyGlobalSearch,
  GlobalSearchValue,
  globalSearchFilter,
  isGlobalSearchEmpty,
} from './globalSearch'
import { customFunctions, FormulaMap, recalcFormulas } from './formula'
import { buildRowPermutation } from './useRowDrag'
import {
  columnTypeOverrides,
  resolveColumnMeta,
  useColumnTypeOverridesVersion,
} from './columnTypeOverrides'
import {
  tableFormatting,
  FONT_SIZE_OPTIONS,
  FONT_FAMILY_OPTIONS,
} from './formatting'
import { useColumnTypeRegistryVersion } from './columnTypeRegistry'
import CustomFunctionsDropdown, {
  loadStoredFunctions,
} from './components/CustomFunctionsDropdown'
import ControlGroup from './components/ControlGroup'
import ActionsRow from './components/ActionsRow'
import PeekActions from './components/PeekActions'

// Restore saved definitions before the first recalculation runs.
loadStoredFunctions()
import CellSelectionProvider from './useCellSelection'
import useUndoHistory from './useUndoHistory'
import GlobalSearch from './components/GlobalSearch'
import PaginationControls from './components/PaginationControls'
import CustomTable from './components/CustomTable'
import DangerActions from './components/DangerActions'
import ClearButton from './components/ClearButton'
import StatsBar from './components/StatsBar'
import FindReplaceDialog from './components/FindReplaceDialog'
import SettingsDialog from './components/SettingsDialog'
import { readSharedSnapshotFromUrl, type AppSnapshot } from './snapshot'
import { HelpCircle, Replace, Settings } from 'lucide-react'
import ThumbnailSizeProvider, { ThumbnailSize } from './thumbnailSize'
import { releaseAllAttachments } from './attachments'
import { blankColumns, blankRow, blankRows } from './blankSheet'
import {
  loadCustomSheet,
  saveCustomSheet,
  clearCustomSheet,
} from './sheetPersistence'

// ── Profiles / templates (optional, lazily-loaded site verticals) ──────
// Behind a lazy boundary so a build that drops src/templates/* still works, and
// so the default sheet never pays for this code.
import { resolveVertical } from './templates/resolveTemplate'
import { composeProfiles } from './templates/registry'
const TemplateSelector = React.lazy(
  () => import('./components/TemplateSelector'),
)

// Fold each column's user-chosen datatype (columnTypeOverrides) into its `meta`,
// walking group columns recursively. Once applied, the whole app (formatting,
// editing, query operators, the type picker's own display) sees the chosen type.
function applyTypeOverrides<T>(defs: T[]): T[] {
  return defs.map((raw) => {
    const def = raw as Record<string, unknown>
    if (Array.isArray(def.columns)) {
      return { ...def, columns: applyTypeOverrides(def.columns) } as T
    }
    const colId = (def.id ?? def.accessorKey) as string | undefined
    if (typeof colId !== 'string') return raw
    const meta = resolveColumnMeta(colId, def.meta as never)
    return meta === def.meta ? raw : ({ ...def, meta } as T)
  })
}

type AppProps = {
  // Consumer schema (library embed) — used as the base columns when provided.
  columns?: typeof baseColumns
  // Consumer initial rows (library embed).
  data?: Person[]
  // true = the standalone demo app (default); false = embedded via the library
  // entry, which gates OFF all app-only machinery: URL/template routing,
  // localStorage persistence, and shared-view-on-load.
  standalone?: boolean
  // Injected by the DEMO entry (main.tsx) to seed/regenerate the random sample
  // rows. Kept out of App's static import graph on purpose: `makeData` pulls in
  // `@faker-js/faker` (~3 MB), which must NEVER ship inside the published
  // library bundle — only the demo build includes it. Absent → no sample data.
  makeDemoData?: () => Person[]
}

export const App = ({
  columns: columnsProp,
  data: dataProp,
  standalone = true,
  makeDemoData,
}: AppProps = {}) => {
  const generateDemoRows = makeDemoData ?? ((): Person[] => [])
  // Which vertical the URL selected (null = default; never in library mode).
  const activeVertical = React.useMemo(
    () => (standalone ? resolveVertical() : null),
    [standalone],
  )

  // A sheet the user previously built (Delete-all → filled in) survives reloads;
  // read it once at mount. When present it takes priority over the demo / profile
  // seed, so the user's own data is what comes back — not the sample rows.
  const persistedSheetRef = React.useRef(
    standalone ? loadCustomSheet() : null,
  )
  const persistedSheet = persistedSheetRef.current
  const [selectedProfileIds, setSelectedProfileIds] = React.useState<string[]>(
    () => activeVertical?.defaultSelected ?? [],
  )
  // The composed sheet for the current selection. null → fall back to the
  // default table (no vertical, or a vertical with nothing selected).
  const composed = React.useMemo(
    () =>
      activeVertical && selectedProfileIds.length
        ? composeProfiles(activeVertical, selectedProfileIds)
        : null,
    [activeVertical, selectedProfileIds],
  )

  const [data, setData] = React.useState<Person[]>(() => {
    // A consumer's `data` prop always wins; a library embed with no data starts
    // empty. Otherwise the standalone demo restores a saved sheet / profile /
    // random sample as before.
    if (dataProp) return dataProp
    if (!standalone) return []
    if (persistedSheet) return persistedSheet.data as unknown as Person[]
    if (activeVertical && activeVertical.defaultSelected?.length) {
      return composeProfiles(activeVertical, activeVertical.defaultSelected)
        .data as unknown as Person[]
    }
    return generateDemoRows()
  })
  // Formula sources live beside the data, keyed by `${dataRowIndex}:${columnId}`.
  // `data` still holds the computed result, so sorting / filtering / search all
  // keep working against real values.
  const [formulas, setFormulas] = React.useState<FormulaMap>(
    () => (persistedSheet ? (persistedSheet.formulas as FormulaMap) : {}),
  )

  const [autoResetPageIndex, skipAutoResetPageIndex] = useSkipper()

  // One instance for the life of the table: the undo stacks are keyed to the
  // rows currently in `data`, and `updateCells` is how a patch is replayed.
  const tableMeta = React.useMemo(
    () => getTableMeta(setData, skipAutoResetPageIndex),
    [skipAutoResetPageIndex],
  )

  const history = useUndoHistory({
    applyCells: tableMeta.updateCells,
    setFormulas,
  })

  const refreshData = () => {
    setFormulas({})
    // Every row index the history points at is about to mean something else,
    // so the stacks go with the data rather than being replayed onto rows
    // that no longer exist.
    history.clear()
    // Every uploaded blob is about to become unreachable, so hand it back to
    // the browser rather than leaking it for the life of the tab.
    releaseAllAttachments()
    // Restore discards the user's saved sheet and returns to the built-in demo
    // schema + data (this is the "bring the data back" action).
    if (standalone) clearCustomSheet()
    setCustomColumns(null)
    // Regenerate from the active profiles when a vertical is loaded, else the
    // demo's random data — or, in a library embed, the caller's initial rows.
    setData(
      composed
        ? (composed.data as unknown as Person[])
        : standalone
          ? generateDemoRows()
          : (dataProp ?? []),
    )
  }

  // Re-seed the sheet whenever the profile selection changes (but not on first
  // mount — the useState initializer already seeded it).
  // Re-seed only when the profile selection ACTUALLY changes. We compare the
  // previous `composed` value rather than using a "skip first mount" flag: under
  // React StrictMode the effect double-invokes on mount, and a flag-based guard
  // would let the second pass fire and wipe a restored blank sheet. A value
  // compare is inert on mount (and on the StrictMode remount) and runs only on a
  // genuine profile change.
  const prevComposedRef = React.useRef(composed)
  React.useEffect(() => {
    if (prevComposedRef.current === composed) return
    prevComposedRef.current = composed
    setFormulas({})
    history.clear()
    releaseAllAttachments()
    // Switching profiles adopts that profile's schema, so a user's blank sheet
    // (if any) is discarded — including its saved copy.
    clearCustomSheet()
    setCustomColumns(null)
    // A vertical with nothing selected shows an empty sheet rather than the
    // random demo data — the demo only belongs to the default (no-vertical) site.
    setData(
      composed
        ? (composed.data as unknown as Person[])
        : activeVertical
          ? []
          : generateDemoRows(),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composed])

  // Global row/thumbnail size is M for the media-heavy demo; per-row height is
  // set via the row popup / gutter drag. A user-built blank sheet is text-only,
  // so it defaults to the compact S rows (see the provider below).
  const [thumbnailSize] = React.useState<ThumbnailSize>('M')

  // Last line of defence against leaked object URLs.
  React.useEffect(() => releaseAllAttachments, [])

  const [columnVisibility, setColumnVisibility] = React.useState({})
  const [grouping, setGrouping] = React.useState<GroupingState>([])
  const [rowSelection, setRowSelection] = React.useState({})
  const [columnPinning, setColumnPinning] =
    React.useState<ColumnPinningState>({})
  // Frozen rows — pinned to the top so they stay put while the rest scrolls
  // (two-tables-in-one).
  const [rowPinning, setRowPinning] = React.useState<RowPinningState>({
    top: [],
    bottom: [],
  })
  // Flat leaf order, written by the header drag. Empty means "definition
  // order"; every commit from the drag layer is a full permutation.
  const [columnOrder, setColumnOrder] = React.useState<ColumnOrderState>([])
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    [],
  )
  const [globalFilter, setGlobalFilter] =
    React.useState<GlobalSearchValue>(emptyGlobalSearch)

  // A user-authored schema. `null` means "use the built-in schema" (the demo /
  // profile columns); once the user wipes the table with Delete-all they get a
  // blank sheet of generic `col1..colN` columns held here, which they can then
  // rename, extend (add column), and fill (add row) to store their own data.
  const [customColumns, setCustomColumns] = React.useState<
    typeof baseColumns | null
  >(() =>
    persistedSheet
      ? (persistedSheet.customColumns as unknown as typeof baseColumns)
      : null,
  )
  const isCustomSchema = customColumns !== null

  // Persist the user's own sheet (debounced) whenever it changes — but ONLY the
  // custom schema. The demo / profile sheet is intentionally never saved, so a
  // plain reload re-seeds the sample data while a sheet the user actually built
  // (rows + headers + formulas) survives the reload.
  React.useEffect(() => {
    if (!standalone || !isCustomSchema || !customColumns) return
    const id = window.setTimeout(() => {
      saveCustomSheet({
        customColumns: customColumns as unknown as unknown[],
        data: data as unknown as unknown[],
        formulas,
      })
    }, 400)
    return () => window.clearTimeout(id)
  }, [standalone, isCustomSchema, customColumns, data, formulas])

  // ── Actions-bar data operations ────────────────────────────────────────────
  // "Delete all" is a full wipe → a blank sheet. Unlike deleting rows, this also
  // clears the HEADERS: the schema is replaced with generic `Column 1..N` columns
  // the user renames + fills to store their own data. Everything scoped to the
  // old schema (formulas, merges, per-cell formatting, type overrides, uploaded
  // blobs) is dropped so nothing bleeds across.
  const deleteAllTable = React.useCallback(() => {
    const cols = blankColumns(6)
    const ids = cols.map((c) => String(c.id))
    setFormulas({})
    history.clear()
    releaseAllAttachments()
    setMerges([])
    tableFormatting.restore(null)
    columnTypeOverrides.restore(null)
    setCustomColumns(cols as unknown as typeof baseColumns)
    setData(blankRows(20, ids) as unknown as Person[])
  }, [history])

  // The next free `colN` id for the blank sheet, so added columns never collide.
  const nextBlankColumnId = (cols: typeof baseColumns) => {
    let max = 0
    for (const c of cols) {
      const m = /^col(\d+)$/.exec(String(c.id ?? ''))
      if (m) max = Math.max(max, parseInt(m[1], 10))
    }
    return max + 1
  }

  // A fresh generic column def (empty header — the user names it by double-click).
  const makeBlankColumn = (id: string): (typeof baseColumns)[number] =>
    ({
      id,
      accessorKey: id,
      header: '',
      meta: { type: 'text' },
    }) as unknown as (typeof baseColumns)[number]

  // Append a new blank column (blank-sheet mode only). Also seed the key on every
  // existing row so the new cells are addressable immediately.
  const addColumn = React.useCallback(() => {
    setCustomColumns((prev) => {
      if (!prev) return prev
      const id = `col${nextBlankColumnId(prev)}`
      setData((rows) =>
        rows.map((r) => ({ ...(r as object), [id]: '' }) as unknown as Person),
      )
      return [...prev, makeBlankColumn(id)]
    })
  }, [])

  // Insert a blank column immediately left / right of the given one.
  const insertColumn = React.useCallback(
    (columnId: string, side: 'left' | 'right') => {
      setCustomColumns((prev) => {
        if (!prev) return prev
        const pos = prev.findIndex((c) => String(c.id) === columnId)
        if (pos < 0) return prev
        const id = `col${nextBlankColumnId(prev)}`
        setData((rows) =>
          rows.map(
            (r) => ({ ...(r as object), [id]: '' }) as unknown as Person,
          ),
        )
        const at = side === 'left' ? pos : pos + 1
        return [...prev.slice(0, at), makeBlankColumn(id), ...prev.slice(at)]
      })
    },
    [],
  )

  // Remove a column from the blank sheet (its type override goes with it).
  const deleteColumn = React.useCallback((columnId: string) => {
    columnTypeOverrides.clear(columnId)
    setCustomColumns((prev) =>
      prev ? prev.filter((c) => String(c.id) !== columnId) : prev,
    )
  }, [])

  // Rename a blank-sheet column's header in place.
  const renameColumn = React.useCallback((columnId: string, name: string) => {
    setCustomColumns((prev) =>
      prev
        ? prev.map((c) =>
            String(c.id) === columnId ? { ...c, header: name } : c,
          )
        : prev,
    )
  }, [])

  // Append one empty row. In blank-sheet mode it carries every custom column id;
  // otherwise an empty object reads as blank cells against the default schema.
  const addRow = React.useCallback(() => {
    setData((rows) => {
      const row = customColumns
        ? blankRow(customColumns.map((c) => String(c.id)))
        : {}
      return [...rows, row as unknown as Person]
    })
  }, [customColumns])

  const deleteRows = React.useCallback(
    (rowIndices: number[]) => {
      const drop = new Set(rowIndices)
      // Row indices are about to shift, so the formula/undo state that pointed
      // at them can no longer be replayed onto the right rows.
      setFormulas({})
      history.clear()
      setData((prev) => prev.filter((_, i) => !drop.has(i)))
    },
    [history],
  )

  // Drag-to-reorder a row: move the row at `from` to sit before original index
  // `to` (== data.length → append at the end). Only ever called when the visible
  // order equals the data order (CustomTable gates the drag on that), so a splice
  // on the raw array is exactly what the user sees.
  const reorderRows = React.useCallback(
    (from: number, to: number) => {
      const n = data.length
      if (from < 0 || from >= n || to < 0 || to > n) return
      const oldToNew = buildRowPermutation(n, from, to)

      setData((prev) => {
        const next = [...prev]
        const [moved] = next.splice(from, 1)
        const insertAt = to > from ? to - 1 : to
        next.splice(insertAt, 0, moved)
        return next
      })

      // Formulas are keyed `${dataRowIndex}:${columnId}`, so each key's row index
      // is rewritten through the same permutation — the formula follows its row.
      setFormulas((prev) => {
        const keys = Object.keys(prev)
        if (!keys.length) return prev
        const next: FormulaMap = {}
        for (const key of keys) {
          const sep = key.indexOf(':')
          const rowIndex = Number(key.slice(0, sep))
          const columnId = key.slice(sep + 1)
          const mapped = oldToNew[rowIndex] ?? rowIndex
          next[`${mapped}:${columnId}`] = prev[key]
        }
        return next
      })

      // The undo stacks are keyed to the old row indices, so they can no longer
      // be replayed onto the right rows once the order changes.
      history.clear()
    },
    [data.length, history],
  )

  // Promote a selected row to the header row: copy its cell values into the
  // column headers, then delete the row. Blank-sheet only (needs custom columns).
  const promoteRowToHeader = React.useCallback(
    (dataRowIndex: number) => {
      const rowVals = data[dataRowIndex] as Record<string, unknown> | undefined
      if (!rowVals) return
      setCustomColumns((prev) =>
        prev
          ? prev.map((c) => {
              const v = rowVals[String(c.id)]
              return { ...c, header: v == null ? '' : String(v) }
            })
          : prev,
      )
      deleteRows([dataRowIndex])
    },
    [data, deleteRows],
  )

  const mergeColumns = React.useCallback((columnIds: string[]) => {
    if (columnIds.length < 2) return
    const claimed = new Set(columnIds)
    setMerges((prev) => [
      // A column can only belong to one merge, so drop any that overlap.
      ...prev.filter((m) => !m.columnIds.some((c) => claimed.has(c))),
      { id: mergeIdFor('group', columnIds), mode: 'group', header: 'Merged', columnIds },
    ])
  }, [])

  // Settings (format profiles + saved queries + export/share) and Find dialogs.
  const [settingsOpen, setSettingsOpen] = React.useState(false)
  const [findOpen, setFindOpen] = React.useState(false)
  // The element the contextual ops strip portals into — a slot in the actions
  // div, so no actions live inside the table.
  const [opsSlot, setOpsSlot] = React.useState<HTMLElement | null>(null)

  // Ctrl+H opens Find & replace (unless typing in a field).
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.key === 'h' || e.key === 'H') || !(e.ctrlKey || e.metaKey)) return
      e.preventDefault()
      setFindOpen(true)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])
  const queryRef = React.useRef<HTMLDivElement>(null)
  const openHelp = React.useCallback(() => {
    // The grid's keyboard layer owns the shortcuts modal and toggles it on '?'.
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: '?', shiftKey: true, bubbles: true }),
    )
  }, [])

  // `q` (when not typing in a field) opens the Query builder and focuses it.
  // Capture phase + stopPropagation so it wins over the grid's type-to-edit.
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.key !== 'q' && e.key !== 'Q') || e.ctrlKey || e.metaKey || e.altKey)
        return
      const el = document.activeElement as HTMLElement | null
      const tag = el?.tagName
      if (
        tag === 'INPUT' ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT' ||
        el?.isContentEditable
      )
        return
      e.preventDefault()
      e.stopPropagation()
      requestAnimationFrame(() => {
        queryRef.current
          ?.querySelector<HTMLElement>('input, [role="combobox"]')
          ?.focus()
      })
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  // Bumped whenever a custom function is defined, edited or removed.
  const customFunctionsVersion = React.useSyncExternalStore(
    React.useCallback(
      (listener: () => void) => customFunctions.subscribe(listener),
      [],
    ),
    () => customFunctions.version,
  )

  // Rebuild the columns whenever a column's chosen datatype (or a custom unit)
  // changes, so the new type flows into meta.
  const typeOverridesVersion = useColumnTypeOverridesVersion()
  const typeRegistryVersion = useColumnTypeRegistryVersion()

  // The column definitions are derived state: `baseColumns` stays the source of
  // truth and every merge the user makes is a descriptor folded over it. The
  // memo is what keeps `columns` referentially stable between renders, which
  // useReactTable needs to avoid rebuilding the whole column model.
  // A loaded vertical brings its own schema, so it starts with no merges and
  // does not read/write the default sheet's persisted merges (keeping the two
  // from contaminating each other).
  const [merges, setMerges] = React.useState<ColumnMerge[]>(() =>
    activeVertical || !standalone ? [] : loadStoredMerges(),
  )
  // `baseColumns` is the default schema; a user's blank sheet, if any, wins over
  // everything; otherwise a composed profile sheet replaces the default.
  const effectiveBaseColumns = customColumns
    ? customColumns
    : composed
      ? (composed.columns as unknown as typeof baseColumns)
      : (columnsProp ?? baseColumns)
  const columns = React.useMemo(
    () =>
      applyTypeOverrides(buildMergedColumns(effectiveBaseColumns, merges)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [effectiveBaseColumns, merges, typeOverridesVersion, typeRegistryVersion],
  )

  // Merges are plain descriptors, so they survive a reload like custom
  // functions do — but only for the default sheet (see above).
  React.useEffect(() => {
    if (!activeVertical && standalone) storeMerges(merges)
  }, [merges, activeVertical, standalone])

  const readOnlyColumns = React.useMemo(
    () => [
      ...READ_ONLY_COLUMNS,
      // A combined column is derived from its sources, exactly like `fullName`,
      // so the editor, the fill handle and Delete all leave it alone.
      ...merges
        .filter((merge) => merge.mode === 'combine')
        .map((merge) => merge.id),
    ],
    [merges],
  )

  const table = useReactTable({
    data,
    columns,
    defaultColumn,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getGroupedRowModel: getGroupedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    getFacetedMinMaxValues: getFacetedMinMaxValues(),
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    globalFilterFn: globalSearchFilter,
    autoResetPageIndex,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    onColumnVisibilityChange: setColumnVisibility,
    onGroupingChange: setGrouping,
    onColumnPinningChange: setColumnPinning,
    onColumnOrderChange: setColumnOrder,
    onRowSelectionChange: setRowSelection,
    // Frozen rows: keep them rendered even when filtered/paged out.
    enableRowPinning: true,
    keepPinnedRows: true,
    onRowPinningChange: setRowPinning,
    // The 'reorder' default yanks grouped columns to the front of the flat
    // order, which would silently undo whatever the drag just committed.
    groupedColumnMode: false,
    // Provide our updateData function to our table meta
    meta: tableMeta,
    state: {
      grouping,
      columnFilters,
      // undefined switches global filtering off entirely; an empty object
      // would otherwise filter every row out.
      globalFilter: isGlobalSearchEmpty(globalFilter) ? undefined : globalFilter,
      columnVisibility,
      columnPinning,
      columnOrder,
      rowSelection,
      rowPinning,
    },
    debugTable: true,
    debugHeaders: true,
    debugColumns: true,
  })

  // Columns Find & replace may target (skip / read-only columns excluded from
  // being replaced into).
  const findReplaceColumns = React.useMemo(
    () =>
      table.getAllLeafColumns().map((col) => {
        const header = col.columnDef.header
        return {
          id: col.id,
          label: typeof header === 'string' ? header : col.id,
          readOnly:
            readOnlyColumns.includes(col.id) || SKIP_COLUMNS.includes(col.id),
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columns, readOnlyColumns],
  )

  // ── View snapshot: the whole thing (data + non-data view) for export/share ──
  const buildSnapshot = React.useCallback(
    (): AppSnapshot => ({
      version: 1,
      data: data as unknown as Record<string, unknown>[],
      formulas,
      formatting: tableFormatting.snapshot(),
      columnTypes: columnTypeOverrides.snapshot(),
      query: globalFilter,
      tableState: {
        columnOrder,
        columnSizing: table.getState().columnSizing,
        columnPinning,
        columnVisibility,
        rowPinning,
      },
      merges,
      // A wiped-to-blank sheet ships its generic schema so the shared view keeps
      // the user's headers; the built-in schema is left implicit.
      ...(customColumns
        ? { customColumns: customColumns as unknown as unknown[] }
        : {}),
    }),
    [
      data,
      formulas,
      globalFilter,
      columnOrder,
      columnPinning,
      columnVisibility,
      rowPinning,
      merges,
      customColumns,
      table,
    ],
  )

  const importSnapshot = React.useCallback(
    (s: AppSnapshot) => {
      releaseAllAttachments()
      history.clear()
      setFormulas((s.formulas ?? {}) as FormulaMap)
      setData((s.data ?? []) as unknown as Person[])
      tableFormatting.restore((s.formatting ?? {}) as never)
      columnTypeOverrides.restore((s.columnTypes ?? {}) as never)
      setGlobalFilter((s.query as GlobalSearchValue) ?? emptyGlobalSearch)
      const ts = (s.tableState ?? {}) as {
        columnOrder?: ColumnOrderState
        columnSizing?: Record<string, number>
        columnPinning?: ColumnPinningState
        columnVisibility?: Record<string, boolean>
        rowPinning?: RowPinningState
      }
      if (ts.columnOrder) setColumnOrder(ts.columnOrder)
      if (ts.columnPinning) setColumnPinning(ts.columnPinning)
      if (ts.columnVisibility) setColumnVisibility(ts.columnVisibility)
      if (ts.rowPinning) setRowPinning(ts.rowPinning)
      if (ts.columnSizing) table.setColumnSizing(ts.columnSizing)
      setMerges((s.merges ?? []) as ColumnMerge[])
      // Restore a shared blank-sheet schema, or fall back to the built-in one.
      setCustomColumns(
        Array.isArray(s.customColumns) && s.customColumns.length
          ? (s.customColumns as unknown as typeof baseColumns)
          : null,
      )
    },
    [history, table],
  )

  // Open a shared view file → the URL carries the snapshot; restore it on load.
  // Standalone demo only — a library embed must not read the host page's URL.
  React.useEffect(() => {
    if (!standalone) return
    const shared = readSharedSnapshotFromUrl()
    if (shared) importSnapshot(shared)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // A merged-away column keeps its identity in `data` but no longer exists on
  // the table, so every piece of state that pointed at it is dropped rather
  // than left to sort / filter / pin against a column that cannot be resolved.
  React.useEffect(() => {
    const live = collectColumnIds(columns)

    setGrouping((prev) => {
      const next = prev.filter((id) => live.has(id))
      return next.length === prev.length ? prev : next
    })
    setColumnFilters((prev) => {
      const next = prev.filter((filter) => live.has(filter.id))
      return next.length === prev.length ? prev : next
    })
    // A stale id in columnOrder is not fatal - TanStack ignores it - but it
    // would make the drag layer's flat order disagree with the tree.
    setColumnOrder((prev) => {
      const next = prev.filter((id) => live.has(id))
      return next.length === prev.length ? prev : next
    })
    setColumnPinning((prev) => {
      const left = (prev.left ?? []).filter((id) => live.has(id))
      const right = (prev.right ?? []).filter((id) => live.has(id))
      return left.length === (prev.left ?? []).length &&
        right.length === (prev.right ?? []).length
        ? prev
        : { left, right }
    })
    // Sorting is uncontrolled, so it is pruned through the table instance.
    table.setSorting((prev) => {
      const next = prev.filter((sort) => live.has(sort.id))
      return next.length === prev.length ? prev : next
    })
    setGlobalFilter((prev) => {
      const values = prev.values.filter((value) => live.has(value.columnId))
      const scoped = prev.columns.filter((id) => live.has(id))
      return values.length === prev.values.length &&
        scoped.length === prev.columns.length
        ? prev
        : { ...prev, values, columns: scoped }
    })
  }, [columns])

  // Keep every formula cell in sync with its inputs. `recalcFormulas` hands the
  // same array back when nothing changed, so React bails out and this settles
  // after one pass instead of looping.
  React.useEffect(() => {
    if (!Object.keys(formulas).length) return
    setData((old) => {
      const next = recalcFormulas(old, formulas)
      if (next !== old) skipAutoResetPageIndex()
      return next
    })
    // `customFunctionsVersion` is in the deps so that editing or deleting a
    // custom function re-runs every dependent formula.
  }, [data, formulas, customFunctionsVersion])

  React.useEffect(() => {
    if (table.getState().columnFilters[0]?.id === 'fullName') {
      if (table.getState().sorting[0]?.id !== 'fullName') {
        table.setSorting([{ id: 'fullName', desc: false }])
      }
    }
  }, [table.getState().columnFilters[0]?.id])

  return (
    // One viewport: the toolbar keeps its natural height, the table region takes
    // the rest and scrolls on its own (§8 — only the table scrolls, not the page).
    <div className="h-screen w-full max-w-full overflow-hidden box-border p-2 sm:p-4 flex flex-col gap-2">
      <div className="table-region min-w-0 flex-1 min-h-0">
        <ThumbnailSizeProvider size={isCustomSchema ? 'S' : thumbnailSize}>
          <CellSelectionProvider
            table={table}
            formulas={formulas}
            setFormulas={setFormulas}
            skipColumns={SKIP_COLUMNS}
            readOnlyColumns={readOnlyColumns}
            history={history}
          >
            <div className="flex h-full flex-col gap-2">
              {/* The actions div: the query on the left, a contextual peek of
                  quick actions + a toggle on the right; the full captioned action
                  groups are revealed on expand. Collapsed by default. */}
              <ActionsRow
                className="shrink-0"
                query={
                  <div ref={queryRef}>
                    <GlobalSearch
                      table={table}
                      value={globalFilter}
                      onChange={setGlobalFilter}
                    />
                  </div>
                }
                ops={
                  <div ref={setOpsSlot} className="min-w-0 empty:hidden" />
                }
                peek={
                  <>
                    <PeekActions
                      onReload={refreshData}
                      onDeleteAll={deleteAllTable}
                    />
                    <span
                      aria-hidden="true"
                      className="mx-0.5 h-6 border-l border-slate-200"
                    />
                    <button
                      type="button"
                      className="icon-btn-sm border border-amber-200 text-amber-600 sm:hover:bg-amber-50"
                      onClick={() => setFindOpen(true)}
                      title="Find & replace (Ctrl+H)"
                      aria-label="Find and replace"
                    >
                      <Replace size={16} />
                    </button>
                    <CustomFunctionsDropdown />
                    <button
                      type="button"
                      className="icon-btn-sm border border-slate-300 text-slate-600 sm:hover:bg-slate-100"
                      onClick={() => setSettingsOpen(true)}
                      title="Settings — profiles, saved queries, export & share"
                      aria-label="Settings"
                    >
                      <Settings size={16} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn-sm border border-sky-200 text-sky-600 sm:hover:bg-sky-50"
                      onClick={openHelp}
                      title="Keyboard shortcuts (?)"
                      aria-label="Keyboard shortcuts"
                    >
                      <HelpCircle size={16} />
                    </button>
                  </>
                }
              >
                {/* Selection formatting/merge lives entirely in the contextual
                    strip now (no duplicate FORMAT bar). */}
                {activeVertical && (
                  <React.Suspense fallback={null}>
                    <ControlGroup label="Profiles" tone="violet">
                      <TemplateSelector
                        vertical={activeVertical}
                        selectedIds={selectedProfileIds}
                        onChange={setSelectedProfileIds}
                      />
                    </ControlGroup>
                  </React.Suspense>
                )}

                <ControlGroup label="Pagination" tone="sky">
                  <PaginationControls
                    hasNextPage={table.getCanNextPage()}
                    hasPreviousPage={table.getCanPreviousPage()}
                    nextPage={table.nextPage}
                    pageCount={table.getPageCount()}
                    pageIndex={table.getState().pagination.pageIndex}
                    pageSize={table.getState().pagination.pageSize}
                    previousPage={table.previousPage}
                    setPageIndex={table.setPageIndex}
                    setPageSize={table.setPageSize}
                  />
                </ControlGroup>

                <ControlGroup label="Tools" tone="emerald">
                  <button
                    type="button"
                    className="icon-btn-sm border border-amber-200 text-amber-600 sm:hover:bg-amber-50"
                    onClick={() => setFindOpen(true)}
                    title="Find & replace (Ctrl+H)"
                    aria-label="Find and replace"
                  >
                    <Replace size={16} />
                  </button>
                  <CustomFunctionsDropdown />
                  <button
                    type="button"
                    className="icon-btn-sm border border-slate-300 text-slate-600 sm:hover:bg-slate-100"
                    onClick={() => setSettingsOpen(true)}
                    title="Settings — profiles, saved queries, export & share"
                    aria-label="Settings"
                  >
                    <Settings size={16} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn-sm border border-sky-200 text-sky-600 sm:hover:bg-sky-50"
                    onClick={openHelp}
                    title="Keyboard shortcuts (?)"
                    aria-label="Keyboard shortcuts"
                  >
                    <HelpCircle size={16} />
                  </button>
                </ControlGroup>

                {/* Danger zone — Clear the selection's contents (shown only when
                    something is selected, before Restore), then the two heavy
                    whole-table actions, red-bordered so they read as dangerous. */}
                <ControlGroup label="Danger" tone="rose">
                  <ClearButton />
                  <DangerActions
                    onDeleteAllTable={deleteAllTable}
                    onRestoreTable={refreshData}
                  />
                </ControlGroup>
              </ActionsRow>
              <div className="min-h-0 flex-1">
                <CustomTable
                  table={table}
                  opsSlot={opsSlot}
                  onAddRow={addRow}
                  onAddColumn={isCustomSchema ? addColumn : undefined}
                  onRenameColumn={isCustomSchema ? renameColumn : undefined}
                  onPromoteRowToHeader={
                    isCustomSchema ? promoteRowToHeader : undefined
                  }
                  onInsertColumn={isCustomSchema ? insertColumn : undefined}
                  onDeleteColumn={isCustomSchema ? deleteColumn : undefined}
                  onDeleteRow={(dataRowIndex) => deleteRows([dataRowIndex])}
                  fontSizes={[...FONT_SIZE_OPTIONS]}
                  fontFamilies={[...FONT_FAMILY_OPTIONS]}
                  onMergeColumns={mergeColumns}
                  onReorderRows={reorderRows}
                />
              </div>
              {/* Excel-style aggregates of the current selection. */}
              <StatsBar table={table} />
            </div>
          </CellSelectionProvider>
        </ThumbnailSizeProvider>
      </div>

      <FindReplaceDialog
        open={findOpen}
        onClose={() => setFindOpen(false)}
        rows={data}
        columns={findReplaceColumns}
        onApply={(updates) => tableMeta.updateCells(updates)}
      />

      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        buildSnapshot={buildSnapshot}
        onImportSnapshot={importSnapshot}
        currentQuery={globalFilter}
        onLoadQuery={(value) => {
          setGlobalFilter(value as GlobalSearchValue)
          setSettingsOpen(false)
        }}
      />
    </div>
  )
}

export default App
