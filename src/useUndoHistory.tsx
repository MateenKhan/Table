import React from 'react'
import { FormulaMap } from './formula'
import {
  applyFormulaPatch,
  CellWrite,
  cellWritesFor,
  HISTORY_LIMIT,
  HistoryEntry,
  isEmptyEntry,
  pushHistory,
} from './undo'

export type HistoryApi = {
  // Records an already-applied action. Clears the redo stack, as every editor
  // does: once you branch, the old future is gone.
  record: (entry: HistoryEntry) => void
  undo: () => boolean
  redo: () => boolean
  // Used by ⟳ Refresh Data: the rows the patches point at no longer exist.
  clear: () => void
}

type Options = {
  // Batched cell writer - `meta.updateCells`.
  applyCells: (updates: CellWrite[]) => void
  setFormulas: React.Dispatch<React.SetStateAction<FormulaMap>>
  limit?: number
}

/**
 * The undo / redo stacks. Both live in refs: nothing renders from them, so a
 * state update per keystroke would only cost a re-render of the whole table.
 *
 * Every entry carries both halves of an action - the cell values and the
 * formula sources - and both are put back together, so undoing a fill that
 * wrote formulas restores the formulas as well as the numbers they produced.
 */
export function useUndoHistory({
  applyCells,
  setFormulas,
  limit = HISTORY_LIMIT,
}: Options): HistoryApi {
  const undoStack = React.useRef<HistoryEntry[]>([])
  const redoStack = React.useRef<HistoryEntry[]>([])

  // Kept fresh without re-creating the api object, which is handed to the
  // selection provider as a prop.
  const optionsRef = React.useRef({ applyCells, setFormulas, limit })
  optionsRef.current = { applyCells, setFormulas, limit }

  return React.useMemo<HistoryApi>(() => {
    const step = (entry: HistoryEntry, direction: 'undo' | 'redo') => {
      const { applyCells: write, setFormulas: setMap } = optionsRef.current
      // Formulas first: the recalculation effect in App runs off `formulas`,
      // and restoring the values in the same batch means it finds them already
      // consistent rather than recomputing from a half-restored state.
      if (entry.formulas.length) {
        setMap((prev) => applyFormulaPatch(prev, entry.formulas, direction))
      }
      if (entry.cells.length) write(cellWritesFor(entry, direction))
    }

    return {
      record: (entry) => {
        if (isEmptyEntry(entry)) return
        undoStack.current = pushHistory(
          undoStack.current,
          entry,
          optionsRef.current.limit,
        )
        redoStack.current = []
      },
      undo: () => {
        const entry = undoStack.current[undoStack.current.length - 1]
        if (!entry) return false
        undoStack.current = undoStack.current.slice(0, -1)
        redoStack.current = pushHistory(
          redoStack.current,
          entry,
          optionsRef.current.limit,
        )
        step(entry, 'undo')
        return true
      },
      redo: () => {
        const entry = redoStack.current[redoStack.current.length - 1]
        if (!entry) return false
        redoStack.current = redoStack.current.slice(0, -1)
        undoStack.current = pushHistory(
          undoStack.current,
          entry,
          optionsRef.current.limit,
        )
        step(entry, 'redo')
        return true
      },
      clear: () => {
        undoStack.current = []
        redoStack.current = []
      },
    }
  }, [])
}

export default useUndoHistory
