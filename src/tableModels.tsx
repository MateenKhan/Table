import {
  CellContext,
  ColumnDef,
  FilterFn,
  SortingFn,
  sortingFns,
} from '@tanstack/react-table'
import React from 'react'
import { Person } from './makeData'
import {
  rankItem,
  compareItems,
  RankingInfo,
} from '@tanstack/match-sorter-utils'
import IndeterminateCheckbox from './components/InderterminateCheckbox'
import EditableCell from './components/EditableCell'
import AttachmentCell from './components/AttachmentCell'
// Side-effect import too: this is where ColumnMeta gets augmented.
import './columnTypes'
import { isAttachmentType } from './columnTypes'
import {
  resolveColumnMeta,
  useColumnTypeOverridesVersion,
} from './columnTypeOverrides'

export const fuzzyFilter: FilterFn<Person> = (
  row,
  columnId,
  value,
  addMeta,
) => {
  // Rank the item
  const itemRank = rankItem(row.getValue(columnId), value)

  // Store the ranking info
  addMeta(itemRank)

  // Return if the item should be filtered in/out
  return itemRank.passed
}

export const fuzzySort: SortingFn<Person> = (rowA, rowB, columnId) => {
  let dir = 0

  // Only sort by rank if the column has ranking information
  if (rowA.columnFiltersMeta[columnId]) {
    dir = compareItems(
      rowA.columnFiltersMeta[columnId]! as RankingInfo,
      rowB.columnFiltersMeta[columnId]! as RankingInfo,
    )
  }

  // Provide an alphanumeric fallback for when the item ranks are equal
  return dir === 0 ? sortingFns.alphanumeric(rowA, rowB, columnId) : dir
}

export type CellUpdate = {
  rowIndex: number
  columnId: string
  value: unknown
}

export type TableMeta = {
  updateData: (rowIndex: number, columnId: string, value: unknown) => void
  // Batched variant so a fill of hundreds of cells is a single state update.
  updateCells: (updates: CellUpdate[]) => void
}

// Columns the cell selection layer must ignore entirely.
export const SKIP_COLUMNS = ['select']

// Columns that can be selected but never written back to by the grid.
// `fullName` is derived from two other fields, so writing to it would be
// silently dropped. `avatar` / `attachment` hold objects, not text: they stay
// selectable (paste-to-upload needs an active cell) but the formula editor,
// the fill handle and Delete all skip them.
export const READ_ONLY_COLUMNS = ['fullName', 'avatar', 'attachment']

// Shared column definition for the two attachment columns. They are opaque to
// sorting, grouping and search - an object URL is not something anyone wants
// to sort by or see offered as a search suggestion.
const attachmentColumn = {
  cell: (props: CellContext<Person, unknown>) => <AttachmentCell {...props} />,
  enableSorting: false,
  enableGrouping: false,
  enableColumnFilter: false,
  enableGlobalFilter: false,
} satisfies Partial<ColumnDef<Person>>

// The default cell renderer dispatches on the column's EFFECTIVE type (base
// meta + any runtime type override): `file` / `image` columns get the full
// AttachmentCell (upload, preview, size limits, upload-to-server, events); every
// other type gets EditableCell. This is what makes a consumer's
// `meta: { type: 'image' }` column behave like the demo's built-in ones —
// without the consumer having to wire a `cell` renderer themselves.
function DefaultCell(props: CellContext<Person, unknown>) {
  // Re-render (and so re-dispatch) when a column's type changes at runtime.
  useColumnTypeOverridesVersion()
  const meta = resolveColumnMeta(props.column.id, props.column.columnDef.meta)
  return isAttachmentType(meta.type) ? (
    <AttachmentCell {...props} />
  ) : (
    <EditableCell {...props} />
  )
}

// Give our default column cell renderer editing superpowers!
export const defaultColumn: Partial<ColumnDef<Person>> = {
  cell: (props) => <DefaultCell {...props} />,
}

// The row-checkbox column. Exported so a rebuilt-from-schema table (import /
// clone) can restore the exact same structural column rather than trying to
// reconstruct its custom header/cell from a serialised descriptor.
export const selectColumn: ColumnDef<Person> = {
  id: 'select',
  header: ({ table }) => (
    <div className="flex items-center justify-center">
      <IndeterminateCheckbox
        checked={table.getIsAllRowsSelected()}
        indeterminate={table.getIsSomeRowsSelected()}
        onChange={table.getToggleAllRowsSelectedHandler()}
      />
    </div>
  ),
  cell: ({ row }) => (
    <div className="flex items-center justify-center">
      <IndeterminateCheckbox
        checked={row.getIsSelected()}
        indeterminate={row.getIsSomeSelected()}
        onChange={row.getToggleSelectedHandler()}
      />
    </div>
  ),
}

export const columns: ColumnDef<Person>[] = [
  selectColumn,
  {
    header: 'Name',
    columns: [
      {
        accessorKey: 'avatar',
        header: 'Photo',
        size: 150,
        meta: { type: 'image', accept: 'image/*' },
        ...attachmentColumn,
      },
      {
        accessorKey: 'firstName',
        meta: { type: 'text' },
      },
      {
        accessorFn: (row) => row.lastName,
        id: 'lastName',
        header: () => <span>Last Name</span>,
        meta: { type: 'text' },
      },
      {
        accessorFn: (row) => `${row.firstName} ${row.lastName}`,
        id: 'fullName',
        header: 'Full Name',
        cell: (info) => info.getValue(),
        filterFn: fuzzyFilter,
        sortingFn: fuzzySort,
        meta: { type: 'text' },
      },
    ],
  },
  {
    header: 'Info',
    columns: [
      {
        accessorKey: 'age',
        header: () => 'Age',
        meta: { type: 'number' },
      },
      {
        header: 'More Info',
        columns: [
          {
            accessorKey: 'visits',
            header: () => <span>Visits</span>,
            meta: { type: 'number' },
          },
          {
            accessorKey: 'status',
            header: 'Status',
            meta: { type: 'text' },
          },
          {
            accessorKey: 'progress',
            header: 'Profile Progress',
            meta: { type: 'decimal', decimals: 1, suffix: '%' },
          },
          {
            accessorKey: 'salary',
            header: 'Salary',
            meta: { type: 'currency', currency: 'USD', decimals: 2 },
          },
          {
            accessorKey: 'attachment',
            header: 'Attachment',
            size: 200,
            meta: { type: 'file' },
            ...attachmentColumn,
          },
        ],
      },
    ],
  },
]

export const getTableMeta = (
  setData: React.Dispatch<React.SetStateAction<Person[]>>,
  skipAutoResetPageIndex: () => void,
  // Optional host hook fired once per cell whose value is written, AFTER the
  // update is queued. Kept outside the state updater so React StrictMode's
  // double-invocation of the updater never double-fires it.
  onCellChange?: (rowIndex: number, columnId: string, value: unknown) => void,
) =>
  ({
    updateData: (rowIndex, columnId, value) => {
      // Skip age index reset until after next rerender
      skipAutoResetPageIndex()
      setData((old) =>
        old.map((row, index) => {
          if (index !== rowIndex) return row

          return {
            ...old[rowIndex]!,
            [columnId]: value,
          }
        }),
      )
      onCellChange?.(rowIndex, columnId, value)
    },
    updateCells: (updates) => {
      if (!updates.length) return
      // Skip age index reset until after next rerender
      skipAutoResetPageIndex()
      setData((old) => {
        const touched = new Map<number, Record<string, unknown>>()

        for (const { rowIndex, columnId, value } of updates) {
          if (!old[rowIndex]) continue
          let draft = touched.get(rowIndex)
          if (!draft) {
            draft = { ...old[rowIndex] }
            touched.set(rowIndex, draft)
          }
          draft[columnId] = value
        }

        if (!touched.size) return old

        const next = old.slice()
        touched.forEach((draft, rowIndex) => {
          next[rowIndex] = draft as Person
        })
        return next
      })
      // Report each written cell. Fired outside the updater (see note above);
      // updates for non-existent rows are harmless — the host just hears a value.
      if (onCellChange) {
        for (const { rowIndex, columnId, value } of updates) {
          onCellChange(rowIndex, columnId, value)
        }
      }
    },
  }) as TableMeta
