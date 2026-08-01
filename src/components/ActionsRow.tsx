import React from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import OverflowGroups from './OverflowGroups'

// The actions div. Collapsed, it's a SINGLE row split ~50/50: the search query
// on the left keeps at least half the width, and the contextual selection ops
// (the "CELL / ROW / COLUMN" strip) live in the right half — capped there and
// horizontally scrollable, so a wide strip never overruns the search. The peek
// of general quick actions and the expand toggle stay pinned at the far right.
//
// Expanded, the ops strip drops BELOW at full width (so every contextual icon is
// visible without scrolling) followed by the full captioned action groups, and
// the top row becomes just the search + toggle.

type Props = {
  // The query input — always visible, no label.
  query: React.ReactNode
  // The contextual selection ops (portaled strip slot). Collapses to nothing
  // when the selection is empty (its own empty:hidden).
  ops?: React.ReactNode
  // A few common general quick actions (reload, find, settings, …).
  peek: React.ReactNode
  // The full set of action groups, revealed when expanded.
  children: React.ReactNode
  className?: string
}

export default function ActionsRow({
  query,
  ops,
  peek,
  children,
  className = '',
}: Props) {
  const [expanded, setExpanded] = React.useState(false)

  const toggle = (
    <button
      type="button"
      className="icon-btn-sm shrink-0"
      onClick={() => setExpanded((v) => !v)}
      title={expanded ? 'Hide actions' : 'Show all actions'}
      aria-label={expanded ? 'Hide actions' : 'Show all actions'}
      aria-expanded={expanded}
    >
      {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
    </button>
  )

  return (
    <div className={`flex flex-col gap-2 ${className}`.trim()}>
      {/* The min-height is load-bearing. The contextual ops strip is a captioned
          group ~74px tall dropping into a row that is otherwise ~44px, so it
          used to shove the whole table down ~20-30px the moment a selection
          appeared and yank it back when the selection cleared — most visibly
          when clicking sort. Reserving the tall state keeps the grid still.
          Collapsed only: when expanded the ops move to their own row below and
          this one has nothing to reserve for. */}
      <div
        className={`flex flex-wrap items-center gap-2 sm:flex-nowrap${
          expanded ? '' : ' sm:min-h-[5rem]'
        }`}
      >
        {/* Search — full width on narrow screens (actions wrap below); on sm+ it
            grows but keeps at least half the row. */}
        <div className="min-w-0 grow basis-full sm:basis-1/2">{query}</div>
        {/* Actions half: contextual ops (capped + scrollable) then peek + toggle,
            pinned right. Full width on narrow (wraps under the search); capped to
            half on sm+. When expanded the ops move below, leaving just the peek +
            toggle here. */}
        <div className="flex w-full min-w-0 shrink items-center justify-end gap-1 sm:w-auto sm:max-w-[50%]">
          {!expanded ? (
            <div className="min-w-0 shrink overflow-x-auto">{ops}</div>
          ) : null}
          {!expanded ? (
            <div className="flex shrink-0 items-center gap-1">{peek}</div>
          ) : null}
          {toggle}
        </div>
      </div>
      {/* Expanded: the contextual strip (Format etc.) leads and scrolls if wide;
          the captioned action groups (Pagination, Tools, Danger) follow, and any
          that don't fit collapse into a "⋮" overflow menu (Google-Sheets style)
          rather than wrapping or clipping — the grouping is always preserved. */}
      {expanded ? (
        <div className="flex items-center gap-2">
          <div className="min-w-0 shrink overflow-x-auto empty:hidden">{ops}</div>
          <OverflowGroups className="flex-1 justify-end">
            {children}
          </OverflowGroups>
        </div>
      ) : null}
    </div>
  )
}
