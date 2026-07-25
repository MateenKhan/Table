import React from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

// The actions div. It hosts the query on the left and, on the right, a small
// always-visible "peek" of the most useful actions (which change with the
// selection) plus a toggle. It starts COLLAPSED — the full set of action groups
// is revealed only when the toggle is pressed. This is deliberately NOT a plain
// accordion: collapsed still shows meaningful, context-aware quick actions.

type Props = {
  // The query input — always visible, no label.
  query: React.ReactNode
  // A few common / selection-contextual quick actions, shown while collapsed.
  peek: React.ReactNode
  // The full set of action groups, revealed when expanded.
  children: React.ReactNode
  className?: string
}

export default function ActionsRow({
  query,
  peek,
  children,
  className = '',
}: Props) {
  const [expanded, setExpanded] = React.useState(false)

  return (
    <div className={`flex flex-col gap-2 ${className}`.trim()}>
      <div className="flex items-center gap-2">
        {/* Query = left half (full width when expanded). */}
        <div className="min-w-0 flex-1 basis-0">{query}</div>
        {/* Actions = right half: the peek of quick, selection-contextual actions.
            Shown only while COLLAPSED — when expanded, the fuller captioned groups
            below carry these actions, so the peek would just duplicate them. */}
        {!expanded ? (
          <div className="flex min-w-0 flex-1 basis-0 flex-wrap items-center justify-end gap-1">
            {peek}
          </div>
        ) : null}
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
      </div>
      {/* The full action groups — captioned ControlGroups — appear on expand. */}
      {expanded ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {children}
        </div>
      ) : null}
    </div>
  )
}
