import { RotateCcw, Trash2 } from 'lucide-react'
import { useCellSelection } from '../useCellSelection'
import Tooltip from '../ui/Tooltip'
import { useConfirm } from '../ui'

// The always-visible quick actions shown in the collapsed actions row: Reload,
// and — only when NOTHING is selected — a "reset the table" wipe. Anything that
// acts on a selection (the unified Clear, delete row, delete/insert column) now
// lives in the contextual ops strip, so there is a single, consistent place for
// each and no per-kind guessing here.
type Props = {
  onReload: () => void
  onDeleteAll: () => void
}

export default function PeekActions({ onReload, onDeleteAll }: Props) {
  const selection = useCellSelection()
  const confirm = useConfirm()
  const kind = selection?.selectionScope?.kind ?? 'none'

  const guard = async (message: string, run: () => void) => {
    if (await confirm({ title: 'Confirm', message, tone: 'danger' })) run()
  }

  return (
    <>
      <Tooltip label="Reload data">
        <button
          type="button"
          className="icon-btn-sm border border-sky-200 text-sky-600 sm:hover:bg-sky-50"
          onClick={onReload}
          aria-label="Reload data"
        >
          <RotateCcw size={16} />
        </button>
      </Tooltip>
      {/* Full reset — only offered when there is no selection to act on, so it
          never competes with the contextual Clear. */}
      {kind === 'none' ? (
        <Tooltip label="Reset the table (delete all rows & columns)">
          <button
            type="button"
            className="icon-btn-sm icon-btn-danger border border-rose-200"
            aria-label="Reset the table"
            onClick={() =>
              guard('Delete everything and reset to a blank table?', onDeleteAll)
            }
          >
            <Trash2 size={16} />
          </button>
        </Tooltip>
      ) : null}
    </>
  )
}
