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

export type SpreadsheetTableProps = {
  // Column definitions (TanStack Table `ColumnDef`s). Optional — omit for a
  // blank sheet the user builds themselves.
  columns?: ColumnDef<Record<string, unknown>>[]
  // Initial rows. Optional — defaults to an empty sheet.
  data?: Record<string, unknown>[]
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
 * />
 * ```
 */
export function SpreadsheetTable({ columns, data }: SpreadsheetTableProps) {
  return (
    <MotionConfig reducedMotion="user">
      <ToastProvider>
        <ConfirmProvider>
          <App
            columns={columns as never}
            data={data as never}
            standalone={false}
          />
        </ConfirmProvider>
      </ToastProvider>
    </MotionConfig>
  )
}

export default SpreadsheetTable
export type { ColumnDef }
