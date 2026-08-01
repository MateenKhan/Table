// Browser-style "find in table": highlight cells whose displayed text matches a
// query and step through them. This module is just the highlight CHANNEL — the
// cells read it to paint themselves. App owns the query, the match list and the
// navigation; it publishes the current highlight set here.
//
// A match key is `${rowId}::${columnId}` (the TanStack row id + column id), which
// is stable across pagination and sorting — the same identity the grid uses.

import React from 'react'

export type FindHighlight = {
  // Every matching cell's key. Painted with the "match" tint.
  matches: ReadonlySet<string>
  // The one match currently stepped to (Enter / F3 / ↓). Painted stronger.
  current: string | null
}

const EMPTY: FindHighlight = { matches: new Set(), current: null }

const FindHighlightCtx = React.createContext<FindHighlight>(EMPTY)

export function FindHighlightProvider({
  value,
  children,
}: {
  value: FindHighlight
  children: React.ReactNode
}) {
  return (
    <FindHighlightCtx.Provider value={value}>
      {children}
    </FindHighlightCtx.Provider>
  )
}

/** The whole highlight set (read once per render by the table body). */
export const useFindHighlight = (): FindHighlight =>
  React.useContext(FindHighlightCtx)

export const findKey = (rowId: string, columnId: string): string =>
  `${rowId}::${columnId}`
