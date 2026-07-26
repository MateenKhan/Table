// Public library entry for `@jugaaadi/table`. Exports a single, batteries-
// included <SpreadsheetTable /> that mounts the same providers the demo app uses
// (main.tsx) and embeds the table in LIBRARY mode (standalone=false) — so it
// never reads the host page's URL or touches localStorage.
//
// Styles: importing this module also pulls in the compiled Tailwind stylesheet,
// shipped as `dist/style.css`. Consumers import it once (see the README).
import './index.css'

import { MotionConfig } from 'framer-motion'
import type { ColumnDef } from '@tanstack/react-table'
import type React from 'react'
import { ToastProvider, ConfirmProvider } from './ui'
import { App, type ColumnInfo } from './App'
import type { SelectionScope, CellEventInfo } from './useCellSelection'

type Row = Record<string, unknown>

export type SpreadsheetTableProps = {
  // Column definitions (TanStack Table `ColumnDef`s). Optional — omit for a
  // blank sheet the user builds themselves.
  columns?: ColumnDef<Row>[]
  // Initial rows. Optional — defaults to an empty sheet.
  data?: Row[]
  // Blank sheet size when no `columns`/`data` are given: `cols` generic text
  // columns and `rows` empty rows the user fills in. e.g. rows={4} cols={4}.
  rows?: number
  cols?: number
  // Called after any edit (typing, fill, paste, clear, delete or row reorder)
  // with the full, current rows — the way to read the user's changes back out.
  // Not called for the initial `data`.
  onDataChange?: (rows: Row[]) => void
  // Called for each individual cell whose value changes, with the data-row
  // index, column id and new value. Fires for typing, fill, paste, clear and
  // undo/redo.
  onCellChange?: (rowIndex: number, columnId: string, value: unknown) => void
  // Called when the columns change (add / remove / rename / retype / reorder /
  // hide) with a light description of the current columns.
  onColumnChange?: (columns: ColumnInfo[]) => void
  // Called when the selection changes, with a coordinate-free description of
  // what it covers (kind + the data-row indices and column ids it spans).
  onSelectionChange?: (scope: SelectionScope) => void
  // Called when a cell becomes the active cell — by click OR keyboard. Ideal
  // for triggering effects/animations elsewhere in your app on cell activation.
  onCellActivate?: (info: CellEventInfo) => void
  // Called on a cell click / on a key pressed while a cell is active, with the
  // cell info and the native event.
  onCellClick?: (info: CellEventInfo, event: React.MouseEvent) => void
  onCellKeyDown?: (info: CellEventInfo, event: KeyboardEvent) => void
  // Called when a column header / letter (A, B, C…) is clicked, and when a
  // row-number gutter (1, 2, 3…) is clicked — with the column id / data-row
  // index and the native event.
  onColumnHeaderClick?: (columnId: string, event: React.MouseEvent) => void
  onRowHeaderClick?: (rowIndex: number, event: React.MouseEvent) => void
}

/**
 * A full, spreadsheet-style data table: editable cells, formulas, rich column
 * types, formatting, a query builder, and more. Built on TanStack Table.
 *
 * ```tsx
 * import { SpreadsheetTable } from '@jugaaadi/table'
 * import '@jugaaadi/table/style.css'
 *
 * <SpreadsheetTable
 *   columns={[{ accessorKey: 'name', header: 'Name' }]}
 *   data={[{ name: 'Ada' }]}
 *   onDataChange={(rows) => console.log(rows)}
 * />
 * ```
 */
export function SpreadsheetTable({
  columns,
  data,
  rows,
  cols,
  onDataChange,
  onCellChange,
  onColumnChange,
  onSelectionChange,
  onCellActivate,
  onCellClick,
  onCellKeyDown,
  onColumnHeaderClick,
  onRowHeaderClick,
}: SpreadsheetTableProps) {
  return (
    <MotionConfig reducedMotion="user">
      <ToastProvider>
        <ConfirmProvider>
          <App
            columns={columns as never}
            data={data as never}
            rows={rows}
            cols={cols}
            standalone={false}
            onDataChange={onDataChange as never}
            onCellChange={onCellChange}
            onColumnChange={onColumnChange}
            onSelectionChange={onSelectionChange}
            onCellActivate={onCellActivate}
            onCellClick={onCellClick}
            onCellKeyDown={onCellKeyDown}
            onColumnHeaderClick={onColumnHeaderClick}
            onRowHeaderClick={onRowHeaderClick}
          />
        </ConfirmProvider>
      </ToastProvider>
    </MotionConfig>
  )
}

export default SpreadsheetTable
export type { ColumnDef }
export type { SelectionScope, CellEventInfo, ColumnInfo }
