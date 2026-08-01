// Public library entry for `@jugaaadi/table`. Exports a single, batteries-
// included <SpreadsheetTable /> that mounts the same providers the demo app uses
// (main.tsx) and embeds the table in LIBRARY mode (standalone=false) — so it
// never reads the host page's URL or touches localStorage.
//
// Styles: importing this module also pulls in the compiled Tailwind stylesheet,
// shipped as `dist/style.css`. Consumers import it once (see the README).
import './index.css'

import React from 'react'
import { MotionConfig } from 'framer-motion'
import type { ColumnDef } from '@tanstack/react-table'
import { ToastProvider, ConfirmProvider } from './ui'
import { App, type ColumnInfo } from './App'
import type { SelectionScope, CellEventInfo } from './useCellSelection'
import { TableThemeProvider, type TableClassNames, type TablePart } from './theme'
import type {
  AttachmentConfig,
  FileSizeLimitInfo,
  FileSizeLimitDecision,
  UploadCellInfo,
  UploadToServerInfo,
  UploadEventHandler,
} from './attachmentConfig'

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
  // How many rows a page shows. Defaults to every row you passed, because an
  // embedded sheet renders no pagination controls — TanStack's own default of
  // 10 silently hid everything past row 10 with no way to reach it.
  pageSize?: number
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

  // ── Uploads / attachments (file + image columns) ──────────────────────────
  // Grid-wide max upload size in BYTES. A per-column `meta.maxFileSize` wins
  // over this. Undefined = no limit (there is no built-in default).
  maxFileSize?: number
  // Called when a picked/dropped/pasted file exceeds the limit. Return (or
  // resolve) `true` to keep it, `false` to discard. Omit to get the built-in
  // themeable agree/reject popup instead.
  onFileSizeLimitExceeded?: (info: FileSizeLimitInfo) => FileSizeLimitDecision
  // When provided, an "upload to server" button appears on filled attachment
  // cells; clicking it calls this with the attachment + original File. The grid
  // ships NO networking — you own the upload.
  onUploadToServer?: (info: UploadToServerInfo) => void
  // Low-level upload interaction events, each with the native event + the cell.
  onUploadClick?: UploadEventHandler<React.MouseEvent>
  onUploadKeyDown?: UploadEventHandler<React.KeyboardEvent>
  onUploadMouseDown?: UploadEventHandler<React.MouseEvent>
  onUploadMouseUp?: UploadEventHandler<React.MouseEvent>
  onUploadDrop?: UploadEventHandler<React.DragEvent>

  // ── Import / export ───────────────────────────────────────────────────────
  // Max bytes per attachment inline-embedded into an exported .json/.html.
  // Larger files export as references (need re-uploading elsewhere). Undefined
  // embeds everything regardless of size.
  exportEmbedLimit?: number

  // ── Theming ───────────────────────────────────────────────────────────────
  // Per-part extra classes, merged onto each surface (root, toolbar, tooltip,
  // popup, toast, lightbox). See the README "Theming" section; you can also
  // recolor with `--jt-*` CSS variables or target `[data-jt="…"]` in plain CSS.
  classNames?: TableClassNames
}

/**
 * A full, spreadsheet-style data table: editable cells, formulas, rich column
 * types, formatting, a query builder, media attachments, and more. Built on
 * TanStack Table.
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
  pageSize,
  onDataChange,
  onCellChange,
  onColumnChange,
  onSelectionChange,
  onCellActivate,
  onCellClick,
  onCellKeyDown,
  onColumnHeaderClick,
  onRowHeaderClick,
  maxFileSize,
  onFileSizeLimitExceeded,
  onUploadToServer,
  onUploadClick,
  onUploadKeyDown,
  onUploadMouseDown,
  onUploadMouseUp,
  onUploadDrop,
  exportEmbedLimit,
  classNames,
}: SpreadsheetTableProps) {
  // Bundle every attachment-related prop into the config the cells read. Kept
  // stable across renders so the provider does not thrash.
  const attachmentConfig = React.useMemo<AttachmentConfig>(
    () => ({
      maxFileSize,
      onFileSizeLimitExceeded,
      onUploadToServer,
      onUploadClick,
      onUploadKeyDown,
      onUploadMouseDown,
      onUploadMouseUp,
      onUploadDrop,
    }),
    [
      maxFileSize,
      onFileSizeLimitExceeded,
      onUploadToServer,
      onUploadClick,
      onUploadKeyDown,
      onUploadMouseDown,
      onUploadMouseUp,
      onUploadDrop,
    ],
  )

  return (
    <MotionConfig reducedMotion="user">
      <TableThemeProvider classNames={classNames}>
        <ToastProvider>
          <ConfirmProvider>
            <App
              columns={columns as never}
              data={data as never}
              rows={rows}
              cols={cols}
              pageSize={pageSize}
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
              attachmentConfig={attachmentConfig}
              exportEmbedLimit={exportEmbedLimit}
            />
          </ConfirmProvider>
        </ToastProvider>
      </TableThemeProvider>
    </MotionConfig>
  )
}

export default SpreadsheetTable
export type { ColumnDef }
export type { SelectionScope, CellEventInfo, ColumnInfo }
export type { TableClassNames, TablePart }
export type {
  AttachmentConfig,
  FileSizeLimitInfo,
  FileSizeLimitDecision,
  UploadCellInfo,
  UploadToServerInfo,
  UploadEventHandler,
}
