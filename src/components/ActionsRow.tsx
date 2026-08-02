import React from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import OverflowGroups from './OverflowGroups'

// The actions div. Collapsed, it's a SINGLE row split 50/50: the search query
// on the left, and the contextual selection ops (the "CELL / ROW / COLUMN"
// strip) in the right half, ahead of the peek of general quick actions and the
// expand toggle, which stay pinned at the far right.
//
// Expanded, the ops strip drops onto its OWN full-width row (so far more of it
// fits inline) followed by the full captioned action groups, and the top row
// becomes just the search + toggle.
//
// ── Why the ops half is a FIXED share, not `max-w-[50%]` ──────────────────────
// It used to be `sm:w-auto sm:max-w-[50%]` around a `shrink overflow-x-auto`
// scroller. That made the ops column's width a function of its own content —
// fine for a scroller that just clipped (which is exactly how "Delete row" and
// "Delete column" ended up rendered hundreds of pixels off-screen with no
// affordance), but fatal now that the strip MEASURES its container to decide
// what to fold into its "⋮" overflow menu: content shrinks → the auto-width
// column shrinks → more room is reported → content grows → oscillation.
// A definite `sm:w-1/2` with the strip as a `flex-1 min-w-0` child inside it
// breaks that loop: the measurement no longer depends on what is measured.

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
        {/* Actions half: the contextual ops take whatever the peek + toggle do
            not, inside a half-row that is exactly half wide (see the note above).
            Full width on narrow, where it wraps under the search. When expanded
            the ops move to their own row below, leaving just peek + toggle. */}
        <div className="flex w-full min-w-0 items-center justify-end gap-1 sm:w-1/2">
          {!expanded ? (
            <div className="min-w-0 flex-1 overflow-hidden">{ops}</div>
          ) : null}
          {!expanded ? (
            <div className="flex shrink-0 items-center gap-1">{peek}</div>
          ) : null}
          {toggle}
        </div>
      </div>
      {/* Expanded: the contextual strip gets a full-width row of its own (so it
          has the whole container to lay out in and folds far less into its own
          "⋮"), then the captioned action groups (Pagination, Tools, Danger) get
          theirs — and any that don't fit collapse into the same Google-Sheets
          "⋮" overflow menu rather than wrapping or clipping, so the grouping is
          always preserved. */}
      {expanded ? ops : null}
      {expanded ? (
        <OverflowGroups className="justify-end">{children}</OverflowGroups>
      ) : null}
    </div>
  )
}
