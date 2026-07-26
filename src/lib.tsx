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
import { ToastProvider, ConfirmProvider } from './ui'
import { App } from './App'
import type { SelectionScope } from './useCellSelection'

type Row = Record<string, unknown>

export type SpreadsheetTableProps = {
  // Column definitions (TanStack Table `ColumnDef`s). Optional — omit for a
  // blank sheet the user builds themselves.
  columns?: ColumnDef<Row>[]
  // Initial rows. Optional — defaults to an empty sheet.
  data?: Row[]
  // Called after any edit (typing, fill, paste, clear, delete or row reorder)
  // with the full, current rows — the way to read the user's changes back out.
  // Not called for the initial `data`.
  onDataChange?: (rows: Row[]) => void
  // Called when the selection changes, with a coordinate-free description of
  // what it covers (kind + the data-row indices and column ids it spans).
  onSelectionChange?: (scope: SelectionScope) => void
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
  onDataChange,
  onSelectionChange,
}: SpreadsheetTableProps) {
  return (
    <MotionConfig reducedMotion="user">
      <ToastProvider>
        <ConfirmProvider>
          <App
            columns={columns as never}
            data={data as never}
            standalone={false}
            onDataChange={onDataChange as never}
            onSelectionChange={onSelectionChange}
          />
        </ConfirmProvider>
      </ToastProvider>
    </MotionConfig>
  )
}

export default SpreadsheetTable
export type { ColumnDef }
export type { SelectionScope }
