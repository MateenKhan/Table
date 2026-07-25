import React from 'react'

// A collapsible titled section that remembers whether it was open.
//
// Self-contained on purpose: it knows nothing about the table, so it can wrap
// any block of toolbar UI. It can run uncontrolled (its own state + localStorage)
// or controlled (parent owns `open`), so a parent can collapse it on "Apply".

const keyFor = (storageKey: string) => `accordion:${storageKey}`

export function loadAccordionOpen(storageKey: string, defaultOpen = true) {
  try {
    const raw = window.localStorage.getItem(keyFor(storageKey))
    if (raw === null) return defaultOpen
    return raw === 'open'
  } catch {
    // Storage blocked - the section still works, it just forgets.
    return defaultOpen
  }
}

export function storeAccordionOpen(storageKey: string, isOpen: boolean) {
  try {
    window.localStorage.setItem(keyFor(storageKey), isOpen ? 'open' : 'closed')
  } catch {
    // Ignored for the same reason.
  }
}

type Props = {
  title: React.ReactNode
  // localStorage key the open / closed state is remembered under. Namespaced
  // internally, so 'query' is enough.
  storageKey: string
  // Only consulted the first time, before anything has been remembered.
  defaultOpen?: boolean
  // Merged onto the root, so a layout can size the section from outside.
  className?: string
  // Shown in the header, muted, ONLY while collapsed — e.g. a summary of the
  // query that was applied, so the collapsed bar still says what is in effect.
  summary?: React.ReactNode
  // Controlled mode: when `open` is provided the parent owns the state (and gets
  // `onOpenChange`); otherwise the component keeps its own state in localStorage.
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: React.ReactNode
}

export function Accordion({
  title,
  storageKey,
  defaultOpen = true,
  className = '',
  summary,
  open,
  onOpenChange,
  children,
}: Props) {
  const isControlled = open !== undefined
  const [internalOpen, setInternalOpen] = React.useState(() =>
    loadAccordionOpen(storageKey, defaultOpen),
  )
  const isOpen = isControlled ? (open as boolean) : internalOpen

  // Pointing the same (uncontrolled) accordion at another key adopts its state.
  React.useEffect(() => {
    if (!isControlled) setInternalOpen(loadAccordionOpen(storageKey, defaultOpen))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey])

  const setOpen = (next: boolean) => {
    // Persist in both modes so the choice survives a reload regardless of who
    // owns the state.
    storeAccordionOpen(storageKey, next)
    if (!isControlled) setInternalOpen(next)
    onOpenChange?.(next)
  }

  return (
    <div
      className={`${className} border border-slate-200 rounded-lg overflow-hidden`.trim()}
    >
      <button
        type="button"
        className="w-full flex items-center justify-between gap-2 px-3 py-2 font-bold text-slate-800 bg-slate-50 sm:hover:bg-slate-100 transition-colors"
        onClick={() => setOpen(!isOpen)}
        aria-expanded={isOpen}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0">{title}</span>
          {!isOpen && summary ? (
            <span className="truncate text-sm font-normal text-slate-500">
              {summary}
            </span>
          ) : null}
        </span>
        <span aria-hidden="true" className="shrink-0">
          {isOpen ? '▲' : '▼'}
        </span>
      </button>

      {/* Slide open/closed by animating the grid track 1fr <-> 0fr (§9, the same
          technique the shared UI's CollapsibleHeader uses). The content is kept mounted
          (not display:none) so a half-typed query survives a collapse, and the
          padding lives INSIDE the clipped track so it collapses with it. The
          global prefers-reduced-motion rule zeroes this transition. */}
      <div
        className="grid transition-[grid-template-rows] duration-slow ease-in-out"
        style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <div className="p-2">{children}</div>
        </div>
      </div>
    </div>
  )
}

export default Accordion
