import type { ReactNode } from 'react'
import { RotateCcw, Trash2, Eraser } from 'lucide-react'
import { useCellSelection } from '../useCellSelection'
import Tooltip from '../piranha/Tooltip'
import { useConfirm } from '../piranha'

// The always-visible quick actions shown in the collapsed actions row. The
// destructive slot CHANGES with the current selection:
//   • cells / range / all  → Clear cells (empties the selected cells' values)
//   • rows                 → Delete rows
//   • columns              → Clear columns
//   • nothing selected     → Delete all rows
type Props = {
  onReload: () => void
  onDeleteAll: () => void
  onDeleteRows: (rowIndices: number[]) => void
  onEmptyColumns: (columnIds: string[]) => void
}

export default function PeekActions({
  onReload,
  onDeleteAll,
  onDeleteRows,
  onEmptyColumns,
}: Props) {
  const selection = useCellSelection()
  const confirm = useConfirm()
  const scope = selection?.selectionScope
  const kind = scope?.kind ?? 'none'

  const guard = async (message: string, run: () => void) => {
    if (await confirm({ title: 'Confirm', message, tone: 'danger' })) run()
  }

  // Clear the selected cells' values by focusing the grid and firing Delete —
  // the grid's own Delete handler clears the active range (and it's undoable).
  const clearCells = () => {
    selection?.focusGrid()
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }),
    )
  }

  let destructive: ReactNode = null
  if (kind === 'rows' && scope?.rowIndices.length) {
    const rows = scope.rowIndices
    destructive = (
      <Tooltip label={`Delete ${rows.length} selected row(s)`}>
        <button
          type="button"
          className="icon-btn-sm icon-btn-danger"
          aria-label="Delete selected rows"
          onClick={() =>
            guard(`Delete ${rows.length} selected row(s)?`, () =>
              onDeleteRows(rows),
            )
          }
        >
          <Trash2 size={16} />
        </button>
      </Tooltip>
    )
  } else if (kind === 'columns' && scope?.columnIds.length) {
    const cols = scope.columnIds
    destructive = (
      <Tooltip label={`Clear ${cols.length} selected column(s)`}>
        <button
          type="button"
          className="icon-btn-sm icon-btn-danger"
          aria-label="Clear selected columns"
          onClick={() =>
            guard(`Clear values in ${cols.length} column(s)?`, () =>
              onEmptyColumns(cols),
            )
          }
        >
          <Eraser size={16} />
        </button>
      </Tooltip>
    )
  } else if (kind === 'cell' || kind === 'range' || kind === 'all') {
    destructive = (
      <Tooltip label="Clear selected cells (Del)">
        <button
          type="button"
          className="icon-btn-sm icon-btn-danger"
          aria-label="Clear selected cells"
          onClick={clearCells}
        >
          <Eraser size={16} />
        </button>
      </Tooltip>
    )
  } else {
    destructive = (
      <Tooltip label="Delete all rows">
        <button
          type="button"
          className="icon-btn-sm icon-btn-danger"
          aria-label="Delete all rows"
          onClick={() => guard('Delete ALL rows?', onDeleteAll)}
        >
          <Trash2 size={16} />
        </button>
      </Tooltip>
    )
  }

  return (
    <>
      <Tooltip label="Reload data">
        <button
          type="button"
          className="icon-btn-sm"
          onClick={onReload}
          aria-label="Reload data"
        >
          <RotateCcw size={16} />
        </button>
      </Tooltip>
      {destructive}
    </>
  )
}
