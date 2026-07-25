import { RotateCcw, Trash2 } from 'lucide-react'
import Tooltip from '../ui/Tooltip'
import { useConfirm } from '../ui'

// The two heavy, whole-table actions — Restore (reset to default data) and
// Delete-all (wipe to a blank table). They are deliberately grouped LAST in the
// actions row, fenced off inside a red-bordered "danger zone" so they read as
// distinct from the everyday controls and are hard to hit by accident. Both go
// through the shared UI's shared confirm.
type Props = {
  onDeleteAllTable: () => void
  onRestoreTable: () => void
}

export default function DangerActions({
  onDeleteAllTable,
  onRestoreTable,
}: Props) {
  const confirm = useConfirm()

  const restore = async () => {
    const ok = await confirm({
      title: 'Restore table',
      message: 'This will reset the table to its default data. Continue?',
      confirmLabel: 'Restore',
    })
    if (ok) onRestoreTable()
  }

  const deleteAll = async () => {
    const ok = await confirm({
      title: 'Delete all table',
      message: 'This will delete every row and column, leaving a blank table. Continue?',
      confirmLabel: 'Delete all',
      tone: 'danger',
    })
    if (ok) onDeleteAllTable()
  }

  return (
    <>
      <Tooltip label="Restore table (reset to default data)">
        <button
          type="button"
          aria-label="Restore table"
          className="icon-btn border border-sky-200 text-sky-600 sm:hover:bg-sky-50"
          onClick={restore}
        >
          <RotateCcw size={16} aria-hidden="true" />
        </button>
      </Tooltip>
      <Tooltip label="Delete all — wipe to a blank table">
        <button
          type="button"
          aria-label="Delete all table"
          className="icon-btn border border-rose-300 text-rose-600 sm:hover:bg-rose-100"
          onClick={deleteAll}
        >
          <Trash2 size={16} aria-hidden="true" />
        </button>
      </Tooltip>
    </>
  )
}
