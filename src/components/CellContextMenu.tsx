import React from 'react'
import { createPortal } from 'react-dom'
import type { RowData } from '@tanstack/react-table'
import {
  groupActionRuns,
  useContextActions,
  type ActionTone,
  type ContextActionProps,
  type StripAction,
} from './CellContextPopup'

// The RIGHT-CLICK menu for the grid — renderer TWO of the descriptor list in
// CellContextPopup.
//
// ── Why this file holds no action list ────────────────────────────────────────
// Right-click is where people instinctively look for insert / delete, and until
// now nothing in this codebase bound `contextmenu` at all. The obvious way to
// fix that would have been to write out a menu of insert/delete/format items
// here — and that list would have started drifting from the ops strip the first
// time either one gained an action, gained a `applies()` condition, or changed a
// label. ("Delete 3 rows" on one surface and "Delete row" on the other is the
// cheap version of that bug; acting on the wrong count is the expensive one.)
//
// So this file contains no actions. It calls `useContextActions` with the SAME
// prop bag CustomTable hands the strip, gets back the same list — already
// filtered by `applies()` and ordered by `relevance()` — and renders it in the
// shape a menu wants. Adding an action to the strip adds it here; changing when
// one applies changes it here; the two surfaces cannot disagree because there is
// nothing for them to disagree about.
//
// What this file DOES own is menu mechanics, which the strip has no use for:
// portalling out of the grid's overflow containers, viewport flipping, roving
// focus with a focus trap, and dismissal.

// Gap kept between the menu and the viewport edge when it is clamped or flipped.
const MARGIN = 8

// Menu-surface tints for the icon in an item row. Deliberately a separate map
// from the strip's `TONE_CLASS`: on the strip a tone colours a bare icon button,
// here it colours a 15px glyph beside text, and the danger tone additionally
// colours the whole row. Presentation is the one thing the two renderers are
// allowed to differ on (see the `strip` / `menu` fields on StripAction).
const ICON_TONE: Record<ActionTone, string> = {
  neutral: 'text-slate-500',
  teal: 'text-teal-600',
  sky: 'text-sky-600',
  violet: 'text-violet-600',
  emerald: 'text-emerald-600',
  danger: 'text-rose-600',
}

// Everything focusable the roving-focus model walks. Nested popovers portal
// themselves to <body>, so they are never DOM descendants of the menu and never
// show up here — which is what we want: while a colour picker is open the arrow
// keys belong to it, not to us.
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

type Props<T extends RowData> = ContextActionProps<T> & {
  // Where the pointer was (client coordinates). The menu's top-left corner
  // unless it would leave the viewport — see the flip logic below.
  at: { x: number; y: number }
  onClose: () => void
}

// One row of the menu, tagged with its index so the keyboard model can tell
// "move to the next row" (↑/↓) from "move within this row" (←/→).
function MenuRow({
  index,
  children,
}: {
  index: number
  children: React.ReactNode
}) {
  return <div data-menu-row={index}>{children}</div>
}

export function CellContextMenu<T extends RowData>(props: Props<T>) {
  const { at, onClose, title } = props
  const { actions } = useContextActions(props)

  const menuRef = React.useRef<HTMLDivElement>(null)
  const [pos, setPos] = React.useState<{
    left: number
    top: number
  } | null>(null)

  /* ------------------------------------------------------------- placement */

  // Measure, then place: the menu is rendered hidden at the origin for one
  // frame, measured, and only then positioned — so the flip decision is made
  // against the REAL size rather than a guess that would be wrong for every
  // selection kind (a column menu is twice the height of a cell menu).
  React.useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const width = el.offsetWidth
    const height = el.offsetHeight
    // Horizontal: prefer to open to the RIGHT of the pointer (the direction a
    // menu is read); flip to the left when that would overflow, and clamp when
    // even the flipped position does not fit.
    let left = at.x
    if (left + width > window.innerWidth - MARGIN) left = at.x - width
    if (left < MARGIN) left = MARGIN
    // Vertical: same, downward-first.
    let top = at.y
    if (top + height > window.innerHeight - MARGIN) top = at.y - height
    if (top < MARGIN) top = MARGIN
    setPos({ left, top })
  }, [at.x, at.y])

  /* ---------------------------------------------------------- focus + trap */

  // Restore focus on close. Captured on mount, before the menu takes focus —
  // for a right-click that is the grid's scroll container (the selection hook
  // moves focus there as part of selecting), so closing the menu leaves the user
  // exactly where they were, arrow keys still driving the grid.
  React.useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    return () => {
      if (previous && document.contains(previous)) previous.focus()
    }
  }, [])

  const items = React.useCallback((): HTMLElement[] => {
    const el = menuRef.current
    if (!el) return []
    return Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE))
  }, [])

  // Focus the first item once placed. Waiting for `pos` avoids scrolling the
  // page to a menu that is still parked at the origin.
  React.useEffect(() => {
    if (!pos) return
    const first = items()[0]
    if (first) first.focus()
    else menuRef.current?.focus()
  }, [pos, items])

  const rowIndexOf = (el: HTMLElement) =>
    Number(el.closest('[data-menu-row]')?.getAttribute('data-menu-row') ?? -1)

  // Keys the menu owns while it is open. They must not ALSO reach the grid's
  // window-level handler, and Escape is why: closing the menu restores focus to
  // the grid synchronously, so by the time the same native Escape finishes
  // bubbling to `window` the grid's `navAllowed()` check passes and it clears
  // the selection — i.e. "Esc dismisses the menu" would silently also throw
  // away what the menu was about to act on. Caught in the browser; see report.
  const OWNED_KEYS = [
    'ArrowDown',
    'ArrowUp',
    'ArrowLeft',
    'ArrowRight',
    'Home',
    'End',
    'Escape',
    'Tab',
  ]

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (OWNED_KEYS.includes(event.key)) event.stopPropagation()
    const all = items()
    if (!all.length) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
      return
    }
    const active = document.activeElement as HTMLElement | null
    const current = active ? all.indexOf(active) : -1

    // Move to the first focusable of the next / previous ROW, wrapping. Rows
    // rather than raw focusables so a cluster row (B / I / U) is one stop going
    // down and three stops going sideways — the behaviour a menu with an
    // embedded toolbar row needs.
    const stepRow = (direction: 1 | -1) => {
      const row = current >= 0 ? rowIndexOf(all[current]) : -1
      const rows = all.map(rowIndexOf)
      const candidates = all
        .map((el, index) => ({ el, index, row: rows[index] }))
        .filter((entry) =>
          direction === 1 ? entry.row > row : entry.row < row,
        )
      const next =
        direction === 1
          ? candidates[0]
          : // Last row before this one, but its FIRST focusable.
            (() => {
              const target = candidates[candidates.length - 1]?.row
              return candidates.find((entry) => entry.row === target)
            })()
      // Wrap: past the end go to the first item, before the start to the last
      // row's first item.
      if (next) return next.el
      if (direction === 1) return all[0]
      const lastRow = rows[rows.length - 1]
      return all.find((_, index) => rows[index] === lastRow) ?? all[0]
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        stepRow(1)?.focus()
        break
      case 'ArrowUp':
        event.preventDefault()
        stepRow(-1)?.focus()
        break
      case 'ArrowRight':
      case 'ArrowLeft': {
        // Within the current row only. On a single-control row this is a no-op
        // rather than a jump, so ← / → never "escape" sideways into an
        // unrelated action.
        if (current < 0) return
        const row = rowIndexOf(all[current])
        const siblings = all.filter((el) => rowIndexOf(el) === row)
        if (siblings.length < 2) return
        event.preventDefault()
        const cursor = siblings.indexOf(all[current])
        const next =
          event.key === 'ArrowRight'
            ? siblings[(cursor + 1) % siblings.length]
            : siblings[(cursor - 1 + siblings.length) % siblings.length]
        next?.focus()
        break
      }
      case 'Home':
        event.preventDefault()
        all[0]?.focus()
        break
      case 'End':
        event.preventDefault()
        all[all.length - 1]?.focus()
        break
      case 'Escape':
        event.preventDefault()
        onClose()
        break
      case 'Tab': {
        // Trap. Tab is a legitimate way to walk a menu, so it cycles rather
        // than being swallowed — it just never leaves.
        event.preventDefault()
        const next = event.shiftKey
          ? all[(current - 1 + all.length) % all.length]
          : all[(current + 1) % all.length]
        next?.focus()
        break
      }
    }
  }

  /* ------------------------------------------------------------ dismissal */

  React.useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (menuRef.current?.contains(target)) return
      // THE portalled-popover convention (OverflowGroups.tsx:121,
      // BorderControl.tsx:232): a composite control inside this menu — the
      // colour palettes, the border picker, the number-format panel, the
      // column-type listbox, the Arrange / Hidden / Row-height dropdowns —
      // renders its panel through a portal to <body>, so it is NOT a DOM
      // descendant of the menu. Without this guard the first click into any of
      // them would dismiss the menu that opened them.
      const el =
        target instanceof Element ? target : (target as ChildNode).parentElement
      if (el?.closest('[data-popover-portal]')) return
      onClose()
    }
    // A context menu is anchored to a point in the document, so any scroll or
    // resize invalidates it. Closing (rather than repositioning, as the strip's
    // dropdowns do) is the platform behaviour and the honest one: the cell it
    // was opened on has moved.
    const onScrollOrResize = () => onClose()
    // Capture, so a handler that stops propagation cannot strand the menu open.
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
    }
  }, [onClose])

  /* ------------------------------------------------------------- the rows */

  // Drop what the menu surface omits, then chunk by group exactly as the strip
  // does — so the two surfaces show the same clusters in the same order.
  const runs = groupActionRuns(
    actions.filter((action) => action.menu !== 'omit'),
  )

  // A running row index across the whole menu: the keyboard model is flat, the
  // group runs are only visual.
  let rowIndex = 0

  const renderItem = (action: StripAction, index: number) => {
    const Icon = action.icon
    const danger = action.tone === 'danger'
    return (
      <MenuRow key={action.id} index={index}>
        <button
          type="button"
          role="menuitem"
          tabIndex={-1}
          disabled={action.disabled}
          className={`flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors disabled:pointer-events-none disabled:opacity-40 focus:outline-none focus-visible:outline-none ${
            danger
              ? 'text-rose-700 sm:hover:bg-rose-50 focus:bg-rose-50'
              : 'text-slate-700 sm:hover:bg-slate-50 focus:bg-slate-50'
          }`}
          onClick={() => {
            action.onSelect?.()
            // An item is a one-shot command, so it closes. The composite rows
            // below deliberately do NOT — a colour or a border is something you
            // adjust more than once per visit.
            onClose()
          }}
        >
          {Icon ? (
            <Icon
              size={15}
              aria-hidden="true"
              className={`flex-none ${ICON_TONE[action.tone ?? 'neutral']}`}
            />
          ) : (
            <span className="w-[15px] flex-none" aria-hidden="true" />
          )}
          <span className="flex-1 truncate">{action.label}</span>
        </button>
      </MenuRow>
    )
  }

  // A labelled row hosting one or more composite controls — the descriptors'
  // own `render()`, unchanged. `role="group"` (not menuitem) because these are
  // controls that own their own popover semantics; forcing a menuitem role onto
  // a colour picker would lie to a screen reader about what Enter does.
  const renderControls = (
    label: string,
    members: StripAction[],
    index: number,
  ) => (
    <MenuRow key={`controls-${members[0].id}`} index={index}>
      <div
        role="group"
        aria-label={label}
        className="flex items-center justify-between gap-2 rounded-md px-2 py-1"
      >
        <span className="min-w-0 flex-1 truncate text-sm text-slate-600">
          {label}
        </span>
        <span className="flex flex-none items-center gap-1">
          {members.map((action) => (
            <React.Fragment key={action.id}>{action.render?.()}</React.Fragment>
          ))}
        </span>
      </div>
    </MenuRow>
  )

  const renderRun = (run: { actions: StripAction[] }) => {
    const out: React.ReactNode[] = []
    let i = 0
    while (i < run.actions.length) {
      const action = run.actions[i]
      const mode = action.menu ?? (action.render ? 'inline' : 'item')
      if (mode === 'item') {
        out.push(renderItem(action, rowIndex++))
        i++
        continue
      }
      // Inline: swallow the whole cluster run (consecutive members sharing a
      // cluster id) into ONE row. An uncluster+ed control is a run of one.
      const cluster = action.menuCluster
      const members: StripAction[] = [action]
      i++
      if (cluster) {
        while (i < run.actions.length && run.actions[i].menuCluster?.id === cluster.id) {
          members.push(run.actions[i])
          i++
        }
      }
      out.push(renderControls(cluster?.label ?? action.label, members, rowIndex++))
    }
    return out
  }

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={title ? `Actions for ${title}` : 'Cell actions'}
      tabIndex={-1}
      // The convention every portalled popover here follows, and the reason a
      // colour picker opened from inside this menu does not dismiss it — see
      // the pointerdown guard above.
      data-popover-portal=""
      // MUST be portalled: both the toolbar slot the strip lives in and the
      // grid's scroll container are `overflow` boxes, so an absolutely
      // positioned menu rendered in place would be clipped by whichever one
      // owns the cell that was right-clicked.
      className="fixed z-[120] flex min-w-[13rem] max-w-[18rem] flex-col overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg"
      style={{
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        maxHeight: `calc(100vh - ${MARGIN * 2}px)`,
        // Hidden for the measuring frame only.
        visibility: pos ? undefined : 'hidden',
      }}
      onKeyDown={onKeyDown}
      // A right-click INSIDE the menu should not stack a native menu on top of
      // it. There is no text to select in here; the composite controls' own
      // panels are separate portals and are unaffected.
      onContextMenu={(event) => event.preventDefault()}
    >
      {/* What the menu is about to act on, in the same words the strip's
          eyebrow uses ("Row 5" / "Column C" / "3 rows"). On a menu this is not
          decoration: the whole class of bug being avoided here is acting on a
          selection other than the one the user thinks they right-clicked. */}
      {title ? (
        <div className="px-2 pb-1 pt-1 text-2xs font-semibold uppercase tracking-wide text-slate-400">
          {title}
        </div>
      ) : null}
      {runs.map((run, index) => (
        <React.Fragment key={`${run.group}-${index}`}>
          {index > 0 ? (
            <div role="separator" className="my-1 border-t border-slate-200" />
          ) : null}
          {renderRun(run)}
        </React.Fragment>
      ))}
    </div>,
    document.body,
  )
}

export default CellContextMenu
