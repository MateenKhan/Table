// Undo / redo, stored as patches rather than snapshots.
//
// A single user action - an edit, a Delete, a fill of 900 cells, a paste - is
// one `HistoryEntry`. The entry records only the cells it actually changed,
// with their before and after values, plus the same for the formula map. That
// keeps a 1000-row fill to roughly one object per written cell instead of a
// copy of the whole table, and it is what lets `data` and `formulas` be put
// back in step with each other: undoing a fill that wrote formulas restores the
// previous formula sources *and* the previous computed values.
//
// Pure and dependency-free on purpose - the React wiring lives in
// `useUndoHistory.tsx` and the tests exercise this file directly.

import type { FormulaMap } from './formula'

// Structurally identical to `tableModels.CellUpdate`, redeclared so this module
// stays free of the React component graph that file drags in.
export type CellWrite = {
  rowIndex: number
  columnId: string
  value: unknown
}

export type CellPatch = {
  rowIndex: number
  columnId: string
  before: unknown
  after: unknown
}

// `undefined` on either side means "no formula here", i.e. the key is absent
// from the map.
export type FormulaPatch = {
  key: string
  before: string | undefined
  after: string | undefined
}

export type HistoryEntry = {
  // Human-readable, for debugging only.
  label: string
  cells: CellPatch[]
  formulas: FormulaPatch[]
}

export type HistoryDirection = 'undo' | 'redo'

export const HISTORY_LIMIT = 50

export const isEmptyEntry = (entry: HistoryEntry) =>
  entry.cells.length === 0 && entry.formulas.length === 0

/** Cell writes that move `entry` in the given direction. */
export function cellWritesFor(
  entry: HistoryEntry,
  direction: HistoryDirection,
): CellWrite[] {
  return entry.cells.map((patch) => ({
    rowIndex: patch.rowIndex,
    columnId: patch.columnId,
    value: direction === 'undo' ? patch.before : patch.after,
  }))
}

/**
 * Apply the formula half of a patch. Returns the same map reference when
 * nothing changes, so callers can bail out of a `setState`.
 */
export function applyFormulaPatch(
  map: FormulaMap,
  patches: FormulaPatch[],
  direction: HistoryDirection,
): FormulaMap {
  if (!patches.length) return map

  const next = { ...map }
  let changed = false

  for (const patch of patches) {
    const value = direction === 'undo' ? patch.before : patch.after
    if (value === undefined) {
      if (patch.key in next) {
        delete next[patch.key]
        changed = true
      }
      continue
    }
    if (next[patch.key] !== value) {
      next[patch.key] = value
      changed = true
    }
  }

  return changed ? next : map
}

/**
 * Push an entry onto a stack, dropping the oldest once `limit` is reached.
 * Returns a new array; the input is never mutated.
 */
export function pushHistory(
  stack: HistoryEntry[],
  entry: HistoryEntry,
  limit = HISTORY_LIMIT,
): HistoryEntry[] {
  if (limit <= 0) return []
  const next = stack.length >= limit ? stack.slice(stack.length - limit + 1) : stack.slice()
  next.push(entry)
  return next
}

/**
 * Drop cells whose value did not actually change, so a re-typed identical value
 * or a paste over matching data does not fill the history with no-ops.
 */
export function pruneCellPatches(cells: CellPatch[]): CellPatch[] {
  return cells.filter((patch) => !Object.is(patch.before, patch.after))
}

/** Same, for formulas. */
export function pruneFormulaPatches(patches: FormulaPatch[]): FormulaPatch[] {
  return patches.filter((patch) => patch.before !== patch.after)
}

/** Build an entry with both halves pruned. */
export function makeEntry(
  label: string,
  cells: CellPatch[],
  formulas: FormulaPatch[],
): HistoryEntry {
  return {
    label,
    cells: pruneCellPatches(cells),
    formulas: pruneFormulaPatches(formulas),
  }
}
