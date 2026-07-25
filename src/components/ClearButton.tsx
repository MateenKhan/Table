import { Eraser } from 'lucide-react'
import { useCellSelection } from '../useCellSelection'
import Tooltip from '../ui/Tooltip'
import { useConfirm } from '../ui'

// Clear the CONTENTS of the current selection — a standalone amber eraser that
// sits just before the Danger group (i.e. before Restore). Rendered only when
// something is selected, and confirms through the shared dialog before wiping,
// so it never lives in two places or fires without asking.
export default function ClearButton() {
  const selection = useCellSelection()
  const confirm = useConfirm()

  if (!selection || selection.selectionScope.kind === 'none') return null

  const clear = async () => {
    const ok = await confirm({
      title: 'Clear contents',
      message: 'Clear the contents of the selected cells?',
      confirmLabel: 'Clear',
      tone: 'danger',
    })
    if (ok) selection.clearSelection()
  }

  return (
    <Tooltip label="Clear contents (Del)">
      <button
        type="button"
        className="icon-btn border border-amber-200 text-amber-600 sm:hover:bg-amber-50"
        aria-label="Clear contents"
        onClick={clear}
      >
        <Eraser size={16} aria-hidden="true" />
      </button>
    </Tooltip>
  )
}
