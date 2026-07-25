// The cells referenced by the formula draft currently being edited.
//
// A module-level singleton in the same shape as `formatting.ts` /
// `customFunctions.ts`: framework-agnostic `subscribe` / `version` hooks and a
// React `useSyncExternalStore` adapter, owning NO React state and needing NO
// provider. `EditableCell` writes the set while a `=` draft is typed;
// `CustomTable` reads it to paint a live highlight on each referenced cell, then
// it is cleared when editing ends.
//
// Keys are `<dataRowIndex>:<columnId>` — the SAME data/definition-space
// coordinates the grid keys formatting on, so a highlight lines up with the cell
// through sort / filter / pagination exactly like a per-cell format does.

import React from 'react'

export type CellRef = { columnId: string; dataRow: number }

const refKey = (columnId: string, dataRow: number) => `${dataRow}:${columnId}`

class FormulaRefsStore {
  private keys = new Set<string>()
  private listeners = new Set<() => void>()
  private revision = 0

  /** Bumped on every change — use as a `useSyncExternalStore` snapshot. */
  get version(): number {
    return this.revision
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify() {
    this.revision++
    this.listeners.forEach((listener) => {
      // A misbehaving subscriber must never take the grid down with it.
      try {
        listener()
      } catch {
        /* ignored */
      }
    })
  }

  /**
   * Replace the referenced set. No-ops (no version bump, no notify) when the set
   * is unchanged, so re-publishing the same refs on an unrelated keystroke does
   * not thrash the grid.
   */
  set(refs: CellRef[]): void {
    const next = new Set<string>()
    for (const ref of refs) next.add(refKey(ref.columnId, ref.dataRow))
    if (next.size === this.keys.size) {
      let same = true
      for (const key of next) {
        if (!this.keys.has(key)) {
          same = false
          break
        }
      }
      if (same) return
    }
    this.keys = next
    this.notify()
  }

  /** Drop every highlight (edit ended / draft is no longer a formula). */
  clear(): void {
    if (!this.keys.size) return
    this.keys = new Set()
    this.notify()
  }

  /** Is this cell referenced by the formula currently being edited? */
  has(columnId: string, dataRow: number): boolean {
    return this.keys.has(refKey(columnId, dataRow))
  }
}

/** The single store the editor and the grid share. */
export const formulaRefs = new FormulaRefsStore()

/**
 * Re-render on any change to the referenced set. Returns the store's version
 * counter so a component reading `formulaRefs.has` during render stays in sync.
 */
export function useFormulaRefsVersion(): number {
  return React.useSyncExternalStore(
    React.useCallback(
      (listener: () => void) => formulaRefs.subscribe(listener),
      [],
    ),
    () => formulaRefs.version,
    () => formulaRefs.version,
  )
}
