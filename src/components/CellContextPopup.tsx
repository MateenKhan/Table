import React from 'react'
import { createPortal } from 'react-dom'
import type { Column, RowData, Table } from '@tanstack/react-table'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowDownToLine,
  ArrowDownWideNarrow,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpNarrowWide,
  ArrowUpToLine,
  Baseline,
  Ban,
  Bold,
  Check,
  ChevronDown,
  Combine,
  Eraser,
  Eye,
  EyeOff,
  FunctionSquare,
  Group,
  Italic,
  PaintBucket,
  Pin,
  PinOff,
  RotateCcw,
  Rows3,
  Sigma,
  SlidersHorizontal,
  Trash2,
  Underline,
  Ungroup,
} from 'lucide-react'
import {
  Align,
  Borders,
  Format,
  TextStyleKey,
  tableFormatting,
  useFormatVersion,
} from '../formatting'
import {
  columnTypeOverrides,
  resolveColumnMeta,
  useColumnTypeOverridesVersion,
} from '../columnTypeOverrides'
import { isAttachmentType, type TypeOptions } from '../columnTypes'
import { getColumnTypePreset } from '../columnTypeRegistry'
import { lettersForColumnId } from '../columnOrder'
import { useCellSelection } from '../useCellSelection'
import type { SelectionScope } from '../useCellSelection'
import ColorPickerButton from './ColorPickerButton'
import ColumnTypePicker from './ColumnTypePicker'
import BorderControl from './BorderControl'
import NumberFormatControl from './NumberFormatControl'
import OverflowGroups from './OverflowGroups'

// An INLINE contextual operations strip for the current selection. It used to be
// a floating `fixed`-positioned popup card opened on a column/row click; now the
// action bar owns that surface, so this renders as a compact HORIZONTAL strip
// that CustomTable docks directly above the table, driven entirely by what is
// currently selected. No `x`/`y`, no viewport clamp, no Esc / outside-close, no
// `role="dialog"` — it is part of the layout, not a transient overlay.
//
// ── Why this file is descriptor-driven ─────────────────────────────────────────
// It used to be one long literal run of JSX inside a single "Format" box, which
// made *source order* the menu order: background, colour, align, font, borders,
// column ops, insert, delete, row ops, formula — in that order, always, no
// matter what was selected. Two things fell out of that and both were bugs:
//
//   1. The strip is portaled into a container that is capped at half the actions
//      row. At a 1463px viewport the strip measured 1063px inside a 470px box,
//      so "Delete row" (x≈639) and "Delete column" (x≈963) were simply off the
//      right edge, behind an `overflow-x-auto` with no scrollbar affordance and
//      no overflow menu. Working features, unreachable.
//   2. The component never received the real `SelectionScope`. It inferred its
//      target from *which callbacks the caller happened to wire* — a proxy that
//      cannot distinguish "one row" from "five rows", and cannot rank anything.
//
// So every control is now a DESCRIPTOR in `actions` below: an id, a label, a
// group, an `applies()` predicate and a `relevance()` weight, plus either a
// simple `onSelect` handler (icon buttons) or its own `render()` (the composite
// controls — colour pickers, selects, dropdown menus). Rendering is: filter by
// `applies`, sort by `relevance`, chunk into contiguous same-group runs, hand
// the runs to `OverflowGroups` so whatever does not fit collapses into the same
// Google-Sheets "⋮" popup the expanded action groups already use. Nothing can be
// silently clipped again, and the ordering is a function of the selection rather
// than of the order somebody happened to type the JSX in.
//
// Behaviour of every pre-existing control is unchanged: writes still go straight
// to the `tableFormatting` singleton (and `columnTypeOverrides` / the TanStack
// `column` / `table`), the store is the source of truth, and `useFormatVersion`
// re-renders the swatches as they change.

// Fill palette: soft slate/tinted surfaces plus white. Raw hex is sanctioned
// here because these ARE the user's chosen colours (§ colour rules).
const BG_SWATCHES = [
  '#ffffff',
  '#f1f5f9',
  '#fee2e2',
  '#ffedd5',
  '#fef9c3',
  '#dcfce7',
  '#dbeafe',
  '#f3e8ff',
]

// Text palette: high-contrast inks.
const FG_SWATCHES = [
  '#0f172a',
  '#475569',
  '#dc2626',
  '#ea580c',
  '#16a34a',
  '#2563eb',
  '#7c3aed',
  '#db2777',
]

// Row-height presets. These mirror the S / M / L body-row heights the removed
// "Rows S/M/L" toolbar control set (see THUMBNAIL_METRICS), so a per-row height
// picked here lines up exactly with the old global sizes. `name` is the readable
// label shown in the row-height dropdown menu.
const ROW_HEIGHT_PRESETS: { label: string; name: string; value: number }[] = [
  { label: 'S', name: 'Short', value: 26 },
  { label: 'M', name: 'Medium', value: 56 },
  { label: 'L', name: 'Tall', value: 108 },
]

// Everything a surface needs to bind the descriptor list to the current
// selection. Exported because there are now TWO renderers — the inline strip
// below and the right-click menu in CellContextMenu.tsx — and CustomTable binds
// this prop bag exactly ONCE and hands the same object to both. That is what
// makes "the strip and the menu can never disagree" true by construction rather
// than by discipline: same props in, same descriptors out.
export type ContextActionProps<T extends RowData> = {
  // Every `tableFormatting` scope key the current selection maps to. Colour /
  // alignment / border writes fan out across ALL of them (one for a whole
  // column / row, one-per-cell for a free range). The first key is also read
  // back for the active-state swatches.
  scopeKeys: string[]
  // Human label for the leading eyebrow, e.g. "Column C" / "Row 5" / "Selection".
  title?: string
  // What the selection ACTUALLY covers — the same `SelectionScope` the grid
  // computes. This is what decides ordering (row ops first for a row selection,
  // column ops first for a column selection) and what supplies the counts the
  // multi-target labels read ("Delete 3 rows"). It used to be computed in
  // CustomTable and thrown away before the strip rendered.
  //
  // Optional, and falls back to the scope on the `useCellSelection` context
  // (which is the same object) so the strip stays correct when it is rendered
  // somewhere that does not thread the prop through. The prop wins when present:
  // an embedder may want to drive the strip from a scope of its own.
  scope?: SelectionScope
  // Present + enabled only when a formula makes sense for the target (a writable
  // column). Omitted for rows / cells / read-only columns.
  onEnterFormula?: () => void
  // Column-target only: the whole table (for the "show hidden columns" list) and
  // this column (for hide / pin / sort / group). Absent for rows / cells.
  table?: Table<T>
  column?: Column<T, unknown>
  // Row-target only: the target row's current effective height, and a setter
  // that applies a preset to this row (and any multi-row selection). Absent for
  // columns / cells.
  rowHeight?: number
  onSetRowHeight?: (height: number) => void
  // Row-target only: whether the target row is currently frozen (top-pinned),
  // and a toggle that freezes / unfreezes it (and any multi-row selection).
  isRowPinned?: boolean
  onToggleRowPin?: () => void
  // Row-target only: promote this single row's values to the column headers and
  // then remove the row. Rendered in the Row group when wired.
  onPromoteToHeader?: () => void
  // Column-target only: structural column operations. Each renders in the Column
  // group only when its callback is wired.
  //
  // The two inserts are SINGLE-column inserts anchored at the edge of the
  // selection (left of the first selected column / right of the last). With N
  // columns selected the strip invokes the callback N times, which stacks up
  // into N new columns — so a host needs no separate bulk callback, only an
  // insert that composes (a functional state update).
  //
  // `onDeleteColumn` deletes the WHOLE column selection in one call: unlike
  // insert, deleting is not repeatable (each id must be named), so the caller
  // binds every selected id.
  onInsertColumnLeft?: () => void
  onInsertColumnRight?: () => void
  onDeleteColumn?: () => void
  // Row-target only: insert a blank row above / below the selection, or remove
  // it entirely (Clear now lives beside the Danger group, not on the strip).
  // Same repeat-to-multiply / delete-all contract as the column ops above.
  onInsertRowAbove?: () => void
  onInsertRowBelow?: () => void
  onDeleteRow?: () => void
  // Format controls: available font-size presets and font-family options. Each
  // renders a compact select inside the Format box only when its array is
  // non-empty, so a caller can offer size, family, both, or neither.
  fontSizes?: string[]
  fontFamilies?: { label: string; value: string }[]
  // Multi-column target only: merge the selected columns into one. Renders a
  // standalone violet Merge button when wired.
  onMergeColumns?: () => void
}

const ALIGNMENTS: { value: Align; label: string }[] = [
  { value: 'left', label: 'Align left' },
  { value: 'center', label: 'Align centre' },
  { value: 'right', label: 'Align right' },
]

// Character formatting, as data so the toggle descriptors, their tooltips and
// the Ctrl+B/I/U handler below all read from one list. `shortcut` is only ever
// shown to the user — the handler matches on the letter, not on this string.
const TEXT_STYLES: {
  key: TextStyleKey
  label: string
  shortcut: string
  icon: LucideIcon
}[] = [
  { key: 'bold', label: 'Bold', shortcut: 'Ctrl+B', icon: Bold },
  { key: 'italic', label: 'Italic', shortcut: 'Ctrl+I', icon: Italic },
  { key: 'underline', label: 'Underline', shortcut: 'Ctrl+U', icon: Underline },
]

// Nothing selected. A module-level constant so the fallback below never creates
// a new object per render (which would churn every memo downstream).
const EMPTY_SCOPE: SelectionScope = {
  kind: 'none',
  rowIndices: [],
  columnIds: [],
}

/* ------------------------------------------------------------- descriptors */

// The logical clusters the strip is built from. A run of same-group actions
// renders as ONE captioned box, and the overflow menu moves whole boxes, so a
// group is never split between the strip and the "⋮" popup.
//
// `structure` is deliberately its OWN group rather than the tail of `column` /
// `row`: it is the add/remove cluster for whichever axis is selected, it is by
// far the smallest cluster (three icon buttons), and — see the relevance table
// below — being small is what lets it be the cluster that always survives the
// fit. Burying "Delete column" is the bug this whole file is fixing.
export type StripGroup = 'structure' | 'format' | 'column' | 'row' | 'formula'

const GROUP_META: Record<
  StripGroup,
  { caption: string; tone: 'teal' | 'sky' | 'violet' | 'emerald' | 'amber' }
> = {
  structure: { caption: 'Structure', tone: 'amber' },
  format: { caption: 'Format', tone: 'teal' },
  column: { caption: 'Column', tone: 'sky' },
  row: { caption: 'Row', tone: 'violet' },
  formula: { caption: 'Formula', tone: 'emerald' },
}

// Relevance: the group weight for each selection kind, highest first. This is
// the whole of "order actions by what is selected" —
//   • a ROW selection leads with the row ops (insert above/below and delete
//     first, then use-as-header / freeze / height), then formatting, then the
//     formula ops, and the column ops last;
//   • a COLUMN selection is the mirror image: insert/delete column, then type /
//     hide / arrange, then formatting;
//   • a cell / range / whole-grid selection leads with formatting, then the
//     formula ops (which is where autosum lives, and a range is exactly when
//     autosum is worth reaching for).
//
// Formatting is never REMOVED for a row/column target, only demoted — it sits
// behind the ops that are specific to what the user actually picked.
//
// Why `structure` outranks the axis's own property cluster rather than trailing
// it: the property clusters are wide (the column one carries a 176px type
// picker, an Arrange menu and a hidden-columns menu — ~460px all told, more than
// the ops half of the actions row has to give), so whichever cluster comes
// second is the one that folds into the "⋮". Putting the three-button structural
// cluster first means insert / delete are ALWAYS on the strip itself, and the
// cluster that overflows is the one whose contents are all still one click away
// in the menu. Ranking by relevance alone would have re-created the original bug
// in a new place.
const GROUP_RELEVANCE: Record<
  SelectionScope['kind'],
  Record<StripGroup, number>
> = {
  none: { format: 500, formula: 400, structure: 300, column: 200, row: 100 },
  cell: { format: 500, formula: 400, structure: 300, column: 200, row: 100 },
  range: { format: 500, formula: 400, structure: 300, column: 200, row: 100 },
  all: { format: 500, formula: 400, structure: 300, column: 200, row: 100 },
  rows: { structure: 500, row: 400, format: 300, formula: 200, column: 100 },
  columns: { structure: 500, column: 400, format: 300, formula: 200, row: 100 },
}

// The scope-derived facts `applies` / `relevance` are allowed to see. A
// descriptor's predicate is deliberately NOT handed the whole prop bag: it
// closes over the props it needs (the descriptors are built inside the
// component), and takes only the selection here, so "is this relevant?" reads
// as a question about the selection rather than about the caller's wiring.
export type StripFacts = {
  scope: SelectionScope
  kind: SelectionScope['kind']
  // Distinct data rows / columns the selection covers. These are what the
  // multi-target labels and the repeat-N inserts count.
  rowCount: number
  columnCount: number
}

// Tints for the plain icon-button actions. Spelled out as literals so Tailwind
// keeps every class in the build.
export type ActionTone = 'neutral' | 'teal' | 'sky' | 'violet' | 'emerald' | 'danger'

export const TONE_CLASS: Record<ActionTone, string> = {
  neutral: 'text-slate-600',
  teal: 'text-teal-600',
  sky: 'text-sky-600',
  violet: 'text-violet-600',
  emerald: 'text-emerald-600',
  danger: 'text-rose-600 sm:hover:bg-rose-50 sm:hover:text-rose-600',
}

// How a descriptor presents in the RIGHT-CLICK menu (CellContextMenu). The
// menu is a second RENDERER over this one list, not a second list, so every
// descriptor has to answer "and what do you look like as a menu row?".
//
//   'item'   — a role="menuitem" row: leading icon, label, click to run. The
//              natural shape for anything that is already `icon` + `onSelect`.
//   'inline' — a labelled row that HOSTS the descriptor's own `render()`
//              control. The composite controls (colour pickers, the border
//              picker, the number-format panel, the column-type listbox, the
//              Arrange / Hidden / Row-height dropdowns) are all trigger buttons
//              that portal their own panel to <body> and mark it
//              `data-popover-portal`, so they work unchanged inside the menu —
//              the menu's outside-close skips those panels, exactly as
//              OverflowGroups already does for the strip's "⋮".
//   'omit'   — not offered in the menu at all.
//
// Default: `render` → 'inline', otherwise 'item'.
export type MenuMode = 'item' | 'inline' | 'omit'

export type StripAction = {
  // Stable across selections — it is the React key and the overflow menu's
  // identity, so it must not encode the current count.
  id: string
  // Tooltip, aria-label, and the text the overflow menu shows. Recomputed per
  // render so it can carry the multi-target count ("Delete 3 rows").
  label: string
  group: StripGroup
  // Is this control meaningful right now? Two halves, both required: the host
  // has to have wired it (closed over), AND the selection has to be a target it
  // makes sense for (the `facts` argument).
  applies: (facts: StripFacts) => boolean
  // Sort weight, higher renders earlier. Defaults to the group weight; a
  // descriptor only overrides it to move within its own group.
  relevance?: (facts: StripFacts) => number
  // Simple icon button. Composite controls set `render` instead.
  icon?: LucideIcon
  onSelect?: () => void
  tone?: ActionTone
  disabled?: boolean
  // Draw a hairline before this control when it is not first in its box. Used
  // to keep the Format group's original three runs (colour / alignment+font /
  // borders) visually separated now that they share one box.
  dividerBefore?: boolean
  // Anything that is not an icon button renders itself: the colour pickers, the
  // font selects, the border control, the column-type picker and the dropdown
  // menus all own internal state or a non-button shape.
  render?: () => React.ReactNode

  /* ── per-surface presentation ──────────────────────────────────────────────
     `applies` answers "is this relevant to the selection?" — the same answer on
     every surface. These two answer "and how does this SURFACE show it?", which
     is a different question and the only one the two renderers may differ on.
     Anything else (labels, handlers, ordering, availability) is shared, so the
     surfaces cannot drift apart. */

  // Presence on the inline strip. 'omit' is for actions that are deliberately
  // menu-only — see `clear-contents`, which the strip gave up on purpose when
  // Clear moved next to the Danger group.
  strip?: 'control' | 'omit'
  // Presence in the right-click menu. Defaults as described on `MenuMode`.
  menu?: MenuMode
  // Consecutive 'inline' actions that share a cluster id collapse onto ONE menu
  // row, captioned by the cluster's label — so B / I / U is a single "Text
  // style" row rather than three, and the menu stays a menu instead of turning
  // into a second toolbar. The first member of a run supplies the label.
  menuCluster?: { id: string; label: string }
}

/* ------------------------------------------------------------------ pieces */

// A thin vertical hairline between logical runs of controls inside one box.
function RunDivider() {
  return <span aria-hidden className="mx-0.5 h-5 w-px bg-slate-200" />
}

// A readable label for a column: its string header if it has one, else its id.
// Hidden columns have no on-screen header to read, so this is what the
// "show hidden columns" list shows them by.
function columnLabel<T extends RowData>(column: Column<T, unknown>): string {
  const header = column.columnDef.header
  return typeof header === 'string' && header ? header : column.id
}

// Three-bar alignment glyph, anchored per direction. Inline SVG keeps it crisp
// and free of any icon-font dependency.
function AlignGlyph({ dir }: { dir: Align }) {
  const short = dir === 'left' ? 4 : dir === 'right' ? 8 : 6
  const shortX = dir === 'right' ? 14 - short : 2
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <line x1="2" y1="4" x2="14" y2="4" />
      <line x1={shortX} y1="8" x2={shortX + short} y2="8" />
      <line x1="2" y1="12" x2="14" y2="12" />
    </svg>
  )
}

// One row of a dropdown menu: a leading lucide icon, a text label, and a
// trailing check when it is the active state (current sort / pin / group).
function MenuItem({
  icon: Icon,
  label,
  active = false,
  disabled = false,
  onClick,
}: {
  icon: LucideIcon
  label: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      aria-pressed={active}
      onClick={onClick}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors disabled:pointer-events-none disabled:opacity-40 sm:hover:bg-slate-50 ${
        active ? 'text-accent-600' : 'text-slate-700'
      }`}
    >
      <Icon
        size={15}
        className={active ? 'text-accent-600' : 'text-slate-500'}
      />
      <span className="flex-1 truncate">{label}</span>
      {active ? <Check size={14} className="text-accent-600" /> : null}
    </button>
  )
}

// Horizontal hairline between groups of menu items inside a dropdown.
function MenuDivider() {
  return <div className="my-1 border-t border-slate-200" />
}

// A compact, named, colored-outline wrapper around one logical cluster of strip
// controls. Mirrors the grouped clusters in the rest of the toolbar (e.g.
// "PAGINATION" sky / "TOOLS" emerald): a thin tinted border, a tiny uppercase
// caption inline at the front, and the cluster's buttons after it. Inline (not a
// tall overlapping caption) because this strip lives on a single row. All tone
// classes are spelled out as literals so Tailwind keeps them in the build.
function ClusterBox({
  name,
  tone,
  children,
}: {
  // Empty on a CONTINUATION box — a wide group is split across several boxes so
  // the overflow can keep part of it on the strip (see splitRunForOverflow), and
  // repeating the caption on each piece would read as several separate groups.
  name?: string
  tone: 'teal' | 'amber' | 'violet' | 'sky' | 'emerald'
  children: React.ReactNode
}) {
  const border = {
    teal: 'border-teal-200',
    amber: 'border-amber-200',
    violet: 'border-violet-200',
    sky: 'border-sky-200',
    emerald: 'border-emerald-200',
  }[tone]
  const text = {
    teal: 'text-teal-600',
    amber: 'text-amber-600',
    violet: 'text-violet-600',
    sky: 'text-sky-600',
    emerald: 'text-emerald-600',
  }[tone]
  // Same captioned-outline look as ControlGroup (Pagination / Tools / Danger):
  // the name overlaps the top border, masked by a matching white background.
  // Extra top room (mt-1 + pt-2) keeps the -top-2 caption clear of the icon row.
  return (
    <div
      className={`relative mt-1 inline-flex shrink-0 items-center gap-1 rounded-lg border ${border} bg-white px-2 pb-1 pt-2`}
    >
      {name ? (
        <span
          className={`absolute -top-2 left-2 bg-white px-1 text-[10px] font-semibold uppercase tracking-wide ${text}`}
        >
          {name}
        </span>
      ) : null}
      {children}
    </div>
  )
}

// A compact strip button that opens a small menu panel. The panel is rendered
// through a portal with FIXED positioning (measured under the trigger, clamped
// to the viewport) so it is never clipped by an ancestor's overflow — the same
// trick BorderControl uses. Esc / outside pointer-down close it, and the
// render-prop hands children a `close()` so an item can dismiss the menu.
// `label` is optional: omit it for an icon-only trigger (still fully labelled
// for a11y via `ariaLabel`, which also becomes the hover tooltip).
function StripMenu({
  label,
  icon: Icon,
  ariaLabel,
  disabled = false,
  children,
}: {
  label?: string
  icon?: LucideIcon
  ariaLabel: string
  disabled?: boolean
  children: (close: () => void) => React.ReactNode
}) {
  const [open, setOpen] = React.useState(false)
  const wrapRef = React.useRef<HTMLSpanElement>(null)
  const panelRef = React.useRef<HTMLDivElement>(null)
  const [pos, setPos] = React.useState<{ left: number; top: number } | null>(
    null,
  )

  const reposition = React.useCallback(() => {
    const trigger = wrapRef.current
    const panel = panelRef.current
    if (!trigger) return
    const t = trigger.getBoundingClientRect()
    const margin = 8
    const panelW = panel?.offsetWidth ?? 208
    const panelH = panel?.offsetHeight ?? 220
    let left = t.left
    if (left + panelW > window.innerWidth - margin) {
      left = window.innerWidth - margin - panelW
    }
    if (left < margin) left = margin
    let top = t.bottom + 6
    if (top + panelH > window.innerHeight - margin) {
      const above = t.top - 6 - panelH
      top =
        above >= margin
          ? above
          : Math.max(margin, window.innerHeight - margin - panelH)
    }
    setPos({ left, top })
  }, [])

  React.useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    reposition()
    const onScroll = () => reposition()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onScroll)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
    }
  }, [open, reposition])

  React.useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
      }
    }
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (wrapRef.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      setOpen(false)
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onDown, true)
    }
  }, [open])

  return (
    <span className="relative inline-flex shrink-0" ref={wrapRef}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1 whitespace-nowrap rounded-lg px-2 py-1 text-sm transition-colors disabled:pointer-events-none disabled:opacity-40 sm:hover:bg-slate-50 ${
          open ? 'bg-slate-50 text-accent-600' : 'text-slate-700'
        }`}
    >
        {Icon ? <Icon size={15} className="flex-none text-slate-500" /> : null}
        {label ? <span className="truncate">{label}</span> : null}
        <ChevronDown size={13} className="flex-none text-slate-400" />
      </button>

      {open
        ? createPortal(
            <div
              ref={panelRef}
              role="menu"
              aria-label={ariaLabel}
              // Marks this as a portaled popover, the way BorderControl /
              // ColumnTypePicker / NumberFormatControl already do. An ancestor
              // popover's outside-close handler can then treat a click in here
              // as "inside", which is what keeps a menu opened from inside the
              // strip's "⋮" overflow from dismissing the overflow underneath it.
              data-popover-portal=""
              className="fixed z-[100] min-w-[12rem] max-w-[16rem] rounded-lg border border-slate-200 bg-white p-1 text-sm text-slate-700 shadow-lg"
              style={{
                left: pos?.left ?? 0,
                top: pos?.top ?? 0,
                visibility: pos ? undefined : 'hidden',
              }}
            >
              {children(() => setOpen(false))}
            </div>,
            document.body,
          )
        : null}
    </span>
  )
}

/* --------------------------------------------------------------- autosum */

// One cell the autosum action will write, and the formula text to write there.
type AutosumWrite = { dataIndex: number; columnId: string; text: string }

// Whether a column can be NAMED in a formula at all.
//
// The engine binds A1 letters to `DATA_COLUMN_IDS` (definition order of the
// built-in schema) and treats a bare `<letters><digits>` identifier as an A1
// reference. So a user-authored column whose id happens to look like that —
// `col1`, `col2`, the ids the blank sheet hands out — parses as an out-of-range
// A1 reference and can only ever evaluate to `#ERROR`. There is no notation that
// reaches those columns, so autosum declines rather than writing a formula that
// is guaranteed to fail. Ids with an underscore or a trailing letter (`col_a3x`,
// the ids column-insert mints) fall through to the named-column notation and are
// fine, as is every built-in column.
const A1_SHAPED = /^[A-Za-z]+\d+$/
const canReferenceColumn = (columnId: string) =>
  !!lettersForColumnId(columnId) || !A1_SHAPED.test(columnId)

// One cell reference, in whichever notation the engine will resolve for this
// column: A1 (`E5`) for the built-in data columns, the named-column form
// (`myCol[5]`) for everything else. Row numbers are 1-based in both.
const cellRef = (columnId: string, dataIndex: number) => {
  const letters = lettersForColumnId(columnId)
  return letters ? `${letters}${dataIndex + 1}` : `${columnId}[${dataIndex + 1}]`
}

const isBlank = (value: unknown) =>
  value === null || value === undefined || value === ''

/**
 * Work out what a one-click autosum would write for the current selection, or
 * `[]` when there is nothing sensible to write. Two shapes, both landing just
 * outside the selection the way a spreadsheet's Σ does:
 *
 *   • VERTICAL (the selection covers 2+ rows) — one `=SUM(first:last)` per
 *     selected column, written into the cell BELOW the range. For a whole-column
 *     selection the range is first trimmed back to the last row that actually
 *     holds a value, so the total lands in the first blank cell instead of past
 *     the end of the sheet (where there would be nowhere to put it).
 *   • HORIZONTAL (one row, 2+ columns) — a single `=SUM(a, b, c)` written into
 *     the cell to the RIGHT of the last selected column. SUM flattens its
 *     arguments, so listing the cells is the same total as a range would be, and
 *     it works for columns that are not adjacent in letter space.
 *
 * Read-only columns are skipped as targets (a derived column has nowhere to put
 * a formula) but still count as sources.
 */
function planAutosum(
  scope: SelectionScope,
  data: Record<string, unknown>[],
  visibleColumnIds: string[],
  isReadOnly: (columnId: string) => boolean,
): AutosumWrite[] {
  if (scope.kind === 'none') return []
  const columns = scope.columnIds.filter(canReferenceColumn)
  const rows = [...scope.rowIndices].sort((a, b) => a - b)
  if (!columns.length || !rows.length) return []

  // ── horizontal: total a single row across several columns ────────────────
  if (rows.length === 1) {
    if (columns.length < 2) return []
    const row = rows[0]
    const last = scope.columnIds[scope.columnIds.length - 1]
    const at = visibleColumnIds.indexOf(last)
    const target = at < 0 ? undefined : visibleColumnIds[at + 1]
    if (!target || isReadOnly(target)) return []
    const args = columns.map((columnId) => cellRef(columnId, row)).join(', ')
    return [{ dataIndex: row, columnId: target, text: `=SUM(${args})` }]
  }

  // ── vertical: total each selected column ─────────────────────────────────
  const first = rows[0]
  let last = rows[rows.length - 1]
  if (scope.kind === 'columns' || scope.kind === 'all') {
    let lastFilled = -1
    for (const r of rows) {
      if (columns.some((columnId) => !isBlank(data[r]?.[columnId]))) lastFilled = r
    }
    if (lastFilled > first) last = lastFilled
  }
  const target = last + 1
  if (target >= data.length) return []

  return columns
    .filter((columnId) => !isReadOnly(columnId))
    .map((columnId) => ({
      dataIndex: target,
      columnId,
      text: `=SUM(${cellRef(columnId, first)}:${cellRef(columnId, last)})`,
    }))
}

/* --------------------------------------------------------------- the model */

// What both renderers consume: the descriptor list already filtered by
// `applies` and ordered by relevance, plus the facts it was filtered against.
export type ContextActionModel = {
  scope: SelectionScope
  facts: StripFacts
  // Filtered + ordered. A renderer still drops what its own surface omits
  // (`strip`/`menu`), but it never re-decides availability or order.
  actions: StripAction[]
  // The character-style toggle, handed out so exactly ONE surface can own the
  // Ctrl+B/I/U shortcut (see `useTextStyleShortcuts`).
  toggleTextStyle: (key: TextStyleKey) => void
}

/**
 * Build the contextual action descriptors for a selection.
 *
 * This is the whole point of the descriptor refactor generalised one step: the
 * list of "actions that apply to this selection, ordered by relevance" is
 * exactly what an ops strip renders AND exactly what a right-click menu
 * renders, so it is computed once, here, and both surfaces render the result.
 * A new action becomes available in both places by being added to one array.
 *
 * A hook rather than a plain function because it subscribes to the formatting
 * and column-type stores and reads the grid's selection context — the same
 * subscriptions the strip has always had.
 */
export function useContextActions<T extends RowData>(
  props: ContextActionProps<T>,
): ContextActionModel {
  const {
    scopeKeys,
    // `title` is a pure presentation prop — each renderer shows it its own way
    // (an eyebrow chip on the strip, a header on the menu), so the model never
    // reads it.
    scope: scopeProp,
    onEnterFormula,
    table,
    column,
    rowHeight,
    onSetRowHeight,
    isRowPinned,
    onToggleRowPin,
    onPromoteToHeader,
    onInsertColumnLeft,
    onInsertColumnRight,
    onDeleteColumn,
    onInsertRowAbove,
    onInsertRowBelow,
    onDeleteRow,
    fontSizes,
    fontFamilies,
    onMergeColumns,
  } = props

  // Subscribe so swatch selection / clearing reflects instantly.
  useFormatVersion()
  // Subscribe so a chosen column type reflects the moment it is set.
  useColumnTypeOverridesVersion()
  // The grid's selection API — the write path autosum commits through, and the
  // fallback source of the selection scope (see the `scope` prop's note).
  const selection = useCellSelection()

  const scope = scopeProp ?? selection?.selectionScope ?? EMPTY_SCOPE
  const facts: StripFacts = {
    scope,
    kind: scope.kind,
    rowCount: scope.rowIndices.length,
    columnCount: scope.columnIds.length,
  }

  // The active-state swatches read the first scope key's stored format; every
  // write fans out across ALL keys the selection covers.
  const format: Format = tableFormatting.get(scopeKeys[0] ?? '')

  const setBg = (bg?: string) =>
    scopeKeys.forEach((key) => tableFormatting.update(key, { bg }))
  const setFg = (fg?: string) =>
    scopeKeys.forEach((key) => tableFormatting.update(key, { fg }))
  const setAlign = (align?: Align) =>
    scopeKeys.forEach((key) => tableFormatting.update(key, { align }))
  const setBorders = (borders: Borders) =>
    scopeKeys.forEach((key) => tableFormatting.update(key, { borders }))
  const setFontSize = (fontSize?: string) =>
    scopeKeys.forEach((k) => tableFormatting.update(k, { fontSize }))
  const setFontFamily = (fontFamily?: string) =>
    scopeKeys.forEach((k) => tableFormatting.update(k, { fontFamily }))

  // ── Character formatting ───────────────────────────────────────────────────
  // Toggling reads the FIRST scope key's stored value and writes the opposite to
  // every key, which is how the alignment buttons and the colour swatches have
  // always behaved here: one click makes the whole selection agree instead of
  // each scope flipping independently (a per-scope flip on a 40-cell range gives
  // a checkerboard). `undefined` is the clear — see `Format`'s present-or-absent
  // note in formatting.ts.
  const toggleTextStyle = (key: TextStyleKey) => {
    const next = format[key] ? undefined : true
    scopeKeys.forEach((k) => tableFormatting.update(k, { [key]: next }))
  }

  // ── Number format targets ──────────────────────────────────────────────────
  // Number format is a per-COLUMN, value-presentation concern (see the ownership
  // note at the top of formatting.ts), so the picker's targets are the columns
  // the selection touches — whatever shape the selection itself is. Attachment
  // and mixed columns are dropped: "2 decimal places" on an image column is not
  // a formatting choice, it is a way to lose the images.
  const numberFormatTargets: { id: string; meta: TypeOptions }[] = table
    ? scope.columnIds
        .map((id) => ({
          id,
          meta: resolveColumnMeta(id, table.getColumn(id)?.columnDef.meta),
        }))
        .filter(
          (target) =>
            !isAttachmentType(target.meta.type) && target.meta.type !== 'mixed',
        )
    : []

  // Each column is re-formatted from its OWN resolved meta, so a change made
  // across a mixed selection is a delta rather than a wholesale retype — see
  // NumberFormatControl for why that matters.
  const applyNumberFormat = (
    build: (meta: TypeOptions) => string | null | undefined,
  ) => {
    for (const target of numberFormatTargets) {
      const next = build(target.meta)
      if (next === undefined) continue
      columnTypeOverrides.set(target.id, next)
    }
  }

  // ── Column operations (the removed "Columns" dropdown's job) ───────────────
  const sorted = column?.getIsSorted() // false | 'asc' | 'desc'
  const pinned = column?.getIsPinned() // false | 'left' | 'right'
  const hiddenColumns =
    table
      ?.getAllLeafColumns()
      .filter((leaf) => !leaf.getIsVisible() && leaf.getCanHide()) ?? []

  // ── Column type (the per-column datatype picker) ───────────────────────────
  const typeOverride = column ? columnTypeOverrides.get(column.id) : null
  const currentPresetId =
    typeof typeOverride === 'string' ? typeOverride : undefined
  const resolvedMeta = column
    ? resolveColumnMeta(column.id, column.columnDef.meta)
    : undefined
  const typeLabel =
    getColumnTypePreset(currentPresetId ?? resolvedMeta?.type ?? 'text')
      ?.label ??
    resolvedMeta?.type ??
    'Text'

  // ── Multi-target helpers ───────────────────────────────────────────────────
  // "N of a thing" for the labels, so a single target keeps its original
  // wording exactly ("Delete row", not "Delete 1 row").
  const plural = (count: number, noun: string) =>
    count > 1 ? `${count} ${noun}s` : noun
  // Insert callbacks are single-insert and anchored at the edge of the
  // selection, so N of them stack into a block of N. See the prop docs.
  const repeat = (times: number, run: () => void) => {
    for (let i = 0; i < Math.max(1, times); i++) run()
  }

  // ── Autosum ────────────────────────────────────────────────────────────────
  const autosumWrites = React.useMemo(() => {
    if (!selection || !table) return []
    const data = table.options.data as unknown as Record<string, unknown>[]
    const visible = table.getVisibleLeafColumns().map((leaf) => leaf.id)
    return planAutosum(scope, data, visible, selection.isReadOnlyColumn)
    // `table.options.data` is a fresh array on every data change, which is
    // exactly when the plan can go stale, so it is the dependency that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection, table, scope, table?.options.data])

  // Committing through `selection.commitEdit` is the same path a typed formula
  // takes: it evaluates, stores the source in the formula map and records an
  // undo entry. One entry per written cell — a multi-column autosum is
  // therefore several undo steps, not one, which matches how the grid already
  // records a per-cell edit.
  const runAutosum = () => {
    if (!selection) return
    for (const write of autosumWrites) {
      selection.commitEdit(write.dataIndex, write.columnId, write.text)
    }
  }

  /* --------------------------------------------------------- the descriptors */

  // Source order inside a group IS the rendered order (relevance is per-group,
  // and the sort below is stable), so this list still reads top-to-bottom the
  // way the old JSX did.
  const actions: StripAction[] = [
    /* ── FORMAT ─────────────────────────────────────────────────────────── */
    {
      id: 'bg',
      label: 'Background color',
      group: 'format',
      applies: () => true,
      // Both swatch buttons share one menu row — "Colour: [fill] [text]" reads
      // as one decision, and it keeps the menu from opening eight rows tall
      // before it reaches the row/column ops somebody right-clicked for.
      menuCluster: { id: 'colour', label: 'Colour' },
      render: () => (
        <ColorPickerButton
          label="Background color"
          value={format.bg}
          onChange={setBg}
          swatches={BG_SWATCHES}
          icon={<PaintBucket size={16} className="text-sky-600" />}
        />
      ),
    },
    {
      id: 'fg',
      label: 'Text color',
      group: 'format',
      applies: () => true,
      menuCluster: { id: 'colour', label: 'Colour' },
      render: () => (
        <ColorPickerButton
          label="Text color"
          value={format.fg}
          onChange={setFg}
          swatches={FG_SWATCHES}
          icon={<Baseline size={16} className="text-violet-600" />}
        />
      ),
    },
    ...TEXT_STYLES.map<StripAction>(({ key, label, shortcut, icon: Icon }, index) => ({
      id: `text-${key}`,
      label: `${label} (${shortcut})`,
      group: 'format',
      // Always meaningful: every selection shape has text in it, and unlike the
      // number format there is no column type that makes bold nonsensical.
      applies: () => true,
      dividerBefore: index === 0,
      // One "Text style: B I U" menu row, not three rows of one toggle each.
      menuCluster: { id: 'text-style', label: 'Text style' },
      render: () => {
        // Reads the STORED format for the first scope key, not the resolved one,
        // so the pressed state answers "did I set this here?" — the same
        // question every other active state on this strip answers.
        const active = !!format[key]
        return (
          <button
            type="button"
            title={`${label} (${shortcut})`}
            aria-label={label}
            aria-pressed={active}
            className={`icon-btn-sm border ${
              active
                ? 'border-accent-300 bg-accent-500/10 text-accent-600'
                : 'border-slate-300 text-slate-600 sm:hover:bg-slate-100'
            }`}
            onClick={() => toggleTextStyle(key)}
          >
            <Icon size={16} aria-hidden="true" />
          </button>
        )
      },
    })),
    ...ALIGNMENTS.map<StripAction>(({ value, label }, index) => ({
      id: `align-${value}`,
      label,
      group: 'format',
      applies: () => true,
      dividerBefore: index === 0,
      menuCluster: { id: 'align', label: 'Align' },
      render: () => {
        const active = format.align === value
        return (
          <button
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={active}
            className={`icon-btn-sm border ${
              active
                ? 'border-accent-300 bg-accent-500/10 text-accent-600'
                : 'border-slate-300 text-teal-600 sm:hover:bg-slate-100'
            }`}
            onClick={() => setAlign(active ? undefined : value)}
          >
            <AlignGlyph dir={value} />
          </button>
        )
      },
    })),
    {
      id: 'font-size',
      label: 'Font size',
      group: 'format',
      applies: () => !!fontSizes && fontSizes.length > 0,
      // The only two controls the menu turns down, and for a mechanical reason
      // rather than a taste one: these are native <select>s, and a native
      // dropdown is NOT a DOM element — its option list is drawn by the OS. The
      // menu cannot treat a click in it as "inside" the way it can for the
      // `data-popover-portal` panels every other composite control uses, so
      // picking a font would dismiss the menu under the picker. They stay on the
      // strip, which is not transient and does not care.
      menu: 'omit',
      render: () => (
        <select
          className="select-sm !w-[4.5rem] pr-5 text-slate-600 border-slate-300"
          aria-label="Font size"
          title="Font size"
          value={format.fontSize ?? ''}
          onChange={(event) => setFontSize(event.target.value || undefined)}
        >
          <option value="">15px</option>
          {fontSizes!.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      ),
    },
    {
      id: 'font-family',
      label: 'Font family',
      group: 'format',
      applies: () => !!fontFamilies && fontFamilies.length > 0,
      // Same native-<select> reason as the size picker above.
      menu: 'omit',
      render: () => (
        <select
          className="select-sm !w-[5rem] pr-5 text-slate-600 border-slate-300"
          aria-label="Font family"
          title="Font family"
          value={format.fontFamily ?? ''}
          onChange={(event) => setFontFamily(event.target.value || undefined)}
        >
          <option value="">Sans</option>
          {fontFamilies!.map((family) => (
            <option key={family.value} value={family.value}>
              {family.label}
            </option>
          ))}
        </select>
      ),
    },
    {
      id: 'number-format',
      label: 'Number format',
      group: 'format',
      // Needs at least one column whose values can carry a numeric / date
      // format. A selection of nothing but image columns simply doesn't get it.
      applies: () => numberFormatTargets.length > 0,
      dividerBefore: true,
      render: () => (
        <NumberFormatControl
          current={numberFormatTargets[0].meta}
          columnCount={numberFormatTargets.length}
          onApply={applyNumberFormat}
        />
      ),
    },
    {
      id: 'borders',
      label: 'Borders',
      group: 'format',
      applies: () => true,
      dividerBefore: true,
      render: () => (
        <BorderControl
          onApply={(patch) => setBorders(patch.borders)}
          currentBorders={format.borders}
        />
      ),
    },

    /* ── COLUMN ─────────────────────────────────────────────────────────── */
    {
      id: 'column-type',
      label: 'Column type',
      group: 'column',
      applies: () => !!column,
      render: () => (
        <>
          <span className="text-2xs font-semibold uppercase tracking-wide text-slate-400">
            Type
          </span>
          <div className="w-44">
            <ColumnTypePicker
              value={currentPresetId}
              typeLabel={typeLabel}
              onSelect={(presetId) =>
                columnTypeOverrides.set(column!.id, presetId)
              }
            />
          </div>
        </>
      ),
    },
    {
      id: 'column-type-reset',
      label: 'Reset column type to default',
      group: 'column',
      applies: () => !!column && !!typeOverride,
      icon: RotateCcw,
      tone: 'neutral',
      onSelect: () => columnTypeOverrides.set(column!.id, null),
    },
    {
      id: 'column-hide',
      label: 'Hide column',
      group: 'column',
      applies: () => !!column,
      icon: EyeOff,
      tone: 'neutral',
      onSelect: () => column!.toggleVisibility(false),
    },
    {
      id: 'column-arrange',
      label: 'Pin, sort and group',
      group: 'column',
      applies: () => !!column,
      render: () => (
        <StripMenu
          label="Arrange"
          icon={SlidersHorizontal}
          ariaLabel="Pin, sort and group"
        >
          {(close) => (
            <>
              {column!.getCanPin() ? (
                <>
                  <MenuItem
                    icon={ArrowLeftToLine}
                    label="Pin left"
                    active={pinned === 'left'}
                    onClick={() => {
                      column!.pin(pinned === 'left' ? false : 'left')
                      close()
                    }}
                  />
                  <MenuItem
                    icon={ArrowRightToLine}
                    label="Pin right"
                    active={pinned === 'right'}
                    onClick={() => {
                      column!.pin(pinned === 'right' ? false : 'right')
                      close()
                    }}
                  />
                  {pinned ? (
                    <MenuItem
                      icon={PinOff}
                      label="Unpin"
                      onClick={() => {
                        column!.pin(false)
                        close()
                      }}
                    />
                  ) : null}
                  <MenuDivider />
                </>
              ) : null}

              <MenuItem
                icon={ArrowUpNarrowWide}
                label="Sort ascending"
                active={sorted === 'asc'}
                onClick={() => {
                  column!.toggleSorting(false)
                  close()
                }}
              />
              <MenuItem
                icon={ArrowDownWideNarrow}
                label="Sort descending"
                active={sorted === 'desc'}
                onClick={() => {
                  column!.toggleSorting(true)
                  close()
                }}
              />
              {sorted ? (
                <MenuItem
                  icon={Ban}
                  label="Clear sort"
                  onClick={() => {
                    column!.clearSorting()
                    close()
                  }}
                />
              ) : null}

              {column!.getCanGroup() ? (
                <>
                  <MenuDivider />
                  {column!.getIsGrouped() ? (
                    <MenuItem
                      icon={Ungroup}
                      label="Ungroup"
                      active
                      onClick={() => {
                        column!.getToggleGroupingHandler()()
                        close()
                      }}
                    />
                  ) : (
                    <MenuItem
                      icon={Group}
                      label="Group by this column"
                      onClick={() => {
                        column!.getToggleGroupingHandler()()
                        close()
                      }}
                    />
                  )}
                </>
              ) : null}
            </>
          )}
        </StripMenu>
      ),
    },
    {
      // The ONLY way back for a column with no header left to click, so it stays
      // reachable from every column.
      id: 'column-hidden',
      label: 'Show hidden columns',
      group: 'column',
      applies: () => !!column && !!table,
      render: () => (
        <StripMenu
          label={
            hiddenColumns.length
              ? `Hidden (${hiddenColumns.length})`
              : 'No hidden'
          }
          icon={Eye}
          ariaLabel="Show hidden columns"
          disabled={hiddenColumns.length === 0}
        >
          {(close) => (
            <div className="max-h-64 overflow-y-auto">
              {hiddenColumns.map((leaf) => (
                <MenuItem
                  key={leaf.id}
                  icon={Eye}
                  label={columnLabel(leaf)}
                  onClick={() => {
                    leaf.toggleVisibility(true)
                    close()
                  }}
                />
              ))}
              {hiddenColumns.length > 1 ? (
                <>
                  <MenuDivider />
                  <MenuItem
                    icon={Eye}
                    label="Show all"
                    onClick={() => {
                      hiddenColumns.forEach((leaf) => leaf.toggleVisibility(true))
                      close()
                    }}
                  />
                </>
              ) : null}
            </div>
          )}
        </StripMenu>
      ),
    },
    /* ── STRUCTURE ──────────────────────────────────────────────────────── */
    /* Add / remove, for whichever axis is selected. Only one axis is ever
       wired at a time, so these share one compact box. */
    {
      id: 'column-insert-left',
      label: `Insert ${plural(facts.columnCount, 'column')} left`,
      group: 'structure',
      applies: () => !!onInsertColumnLeft,
      icon: ArrowLeftToLine,
      tone: 'teal',
      onSelect: () => repeat(facts.columnCount, onInsertColumnLeft!),
    },
    {
      id: 'column-insert-right',
      label: `Insert ${plural(facts.columnCount, 'column')} right`,
      group: 'structure',
      applies: () => !!onInsertColumnRight,
      icon: ArrowRightToLine,
      tone: 'teal',
      onSelect: () => repeat(facts.columnCount, onInsertColumnRight!),
    },
    {
      id: 'column-delete',
      label: `Delete ${plural(facts.columnCount, 'column')}`,
      group: 'structure',
      applies: () => !!onDeleteColumn,
      icon: Trash2,
      tone: 'danger',
      onSelect: () => onDeleteColumn!(),
    },
    {
      id: 'row-insert-above',
      label: `Insert ${plural(facts.rowCount, 'row')} above`,
      group: 'structure',
      applies: () => !!onInsertRowAbove,
      icon: ArrowUpToLine,
      tone: 'teal',
      onSelect: () => repeat(facts.rowCount, onInsertRowAbove!),
    },
    {
      id: 'row-insert-below',
      label: `Insert ${plural(facts.rowCount, 'row')} below`,
      group: 'structure',
      applies: () => !!onInsertRowBelow,
      icon: ArrowDownToLine,
      tone: 'teal',
      onSelect: () => repeat(facts.rowCount, onInsertRowBelow!),
    },
    {
      id: 'row-delete',
      label: `Delete ${plural(facts.rowCount, 'row')}`,
      group: 'structure',
      applies: () => !!onDeleteRow,
      icon: Trash2,
      tone: 'danger',
      onSelect: () => onDeleteRow!(),
    },
    {
      id: 'column-merge',
      label: 'Merge columns',
      group: 'structure',
      applies: () => !!onMergeColumns,
      icon: Combine,
      tone: 'violet',
      dividerBefore: true,
      onSelect: () => onMergeColumns!(),
    },
    {
      // Menu-only, and deliberately so. Clear was taken OFF the strip when it
      // moved next to the Danger group, and that decision stands — but "empty
      // what I just right-clicked" is the single most-reached-for item in a
      // spreadsheet context menu, and it is already a first-class selection
      // operation (`clearSelection` clears exactly the selection, whatever its
      // shape, undoably). `strip: 'omit'` is the mirror of `menu: 'omit'`: one
      // list, each descriptor saying where it belongs.
      id: 'clear-contents',
      label:
        facts.kind === 'rows'
          ? `Clear ${plural(facts.rowCount, 'row')}`
          : facts.kind === 'columns'
            ? `Clear ${plural(facts.columnCount, 'column')}`
            : facts.kind === 'all'
              ? 'Clear everything'
              : 'Clear contents',
      group: 'structure',
      applies: (f) => !!selection && f.kind !== 'none',
      strip: 'omit',
      icon: Eraser,
      tone: 'danger',
      // Ranked by hand because this one action wants a different neighbour on
      // each selection kind: right under insert/delete when the user opened the
      // menu on a row or column header (that cluster is what they came for),
      // but ahead of the formatting cluster on a cell or range, where clearing
      // IS the common case and burying it eight rows down would repeat the
      // discoverability bug the strip was fixing.
      relevance: (f) =>
        f.kind === 'rows' || f.kind === 'columns'
          ? GROUP_RELEVANCE[f.kind].structure - 1
          : GROUP_RELEVANCE[f.kind].format + 1,
      onSelect: () => selection!.clearSelection(),
    },

    /* ── ROW ────────────────────────────────────────────────────────────── */
    {
      id: 'row-promote',
      label: 'Use row as header',
      group: 'row',
      applies: () => !!onPromoteToHeader,
      icon: ArrowUpToLine,
      tone: 'violet',
      onSelect: () => onPromoteToHeader!(),
    },
    {
      id: 'row-pin',
      label: isRowPinned ? 'Unfreeze row' : 'Freeze row',
      group: 'row',
      applies: () => !!onToggleRowPin,
      // A toggle, so the strip wants a pressed-state icon button and the menu
      // wants a plain row. Same label, same handler, two shapes: `render` for
      // the strip, `icon` + `onSelect` for the menu — which is exactly what
      // `menu: 'item'` selects. Nothing here can drift, because there is still
      // only one `onToggleRowPin` and one label expression.
      menu: 'item',
      icon: isRowPinned ? PinOff : Pin,
      tone: 'sky',
      onSelect: () => onToggleRowPin!(),
      render: () => (
        <button
          type="button"
          aria-pressed={isRowPinned}
          className={`icon-btn-sm ${
            isRowPinned ? 'bg-accent-500/10 text-accent-600' : 'text-sky-600'
          }`}
          title={isRowPinned ? 'Unfreeze row' : 'Freeze row'}
          aria-label={isRowPinned ? 'Unfreeze row' : 'Freeze row'}
          onClick={onToggleRowPin}
        >
          {isRowPinned ? <PinOff size={16} /> : <Pin size={16} />}
        </button>
      ),
    },
    {
      id: 'row-height',
      label: 'Row height',
      group: 'row',
      applies: () => !!onSetRowHeight,
      render: () => (
        <StripMenu icon={Rows3} ariaLabel="Row height">
          {(close) => (
            <>
              {ROW_HEIGHT_PRESETS.map(({ name, value }) => (
                <MenuItem
                  key={value}
                  icon={Rows3}
                  label={name}
                  active={rowHeight === value}
                  onClick={() => {
                    onSetRowHeight!(value)
                    close()
                  }}
                />
              ))}
            </>
          )}
        </StripMenu>
      ),
    },

    /* ── FORMULA ────────────────────────────────────────────────────────── */
    {
      id: 'formula-autosum',
      label:
        autosumWrites.length > 1
          ? `Autosum (${autosumWrites.length} totals)`
          : 'Autosum',
      group: 'formula',
      applies: () => autosumWrites.length > 0,
      icon: Sigma,
      tone: 'emerald',
      onSelect: runAutosum,
    },
    {
      id: 'formula-enter',
      label: 'Enter formula',
      group: 'formula',
      applies: () => !!onEnterFormula,
      icon: FunctionSquare,
      tone: 'emerald',
      onSelect: () => onEnterFormula!(),
    },
  ]

  /* --------------------------------------------------------------- ordering */

  // Filter by relevance-to-the-selection, then order by it. `Array#sort` is
  // stable, and the explicit index tiebreak makes that guarantee load-bearing
  // rather than incidental: within one group the rendered order is exactly the
  // source order above.
  const ordered = actions
    .filter((action) => action.applies(facts))
    .map((action, index) => ({ action, index }))
    .sort((a, b) => {
      const weight = (entry: { action: StripAction }) =>
        entry.action.relevance?.(facts) ??
        GROUP_RELEVANCE[facts.kind][entry.action.group]
      return weight(b) - weight(a) || a.index - b.index
    })
    .map((entry) => entry.action)

  return { scope, facts, actions: ordered, toggleTextStyle }
}

// Chunk an ordered action list into contiguous same-group runs. In the
// right-click menu a run becomes one hairline-separated block. On the strip a
// run is split again by `splitRunForOverflow` before it is handed to
// `OverflowGroups`. Shared so the two surfaces group identically.
export function groupActionRuns(actions: StripAction[]) {
  const runs: { group: StripGroup; actions: StripAction[] }[] = []
  for (const action of actions) {
    const last = runs[runs.length - 1]
    if (last && last.group === action.group) last.actions.push(action)
    else runs.push({ group: action.group, actions: [action] })
  }
  return runs
}

/**
 * Split one group's actions into several boxes, so `OverflowGroups` has
 * something finer than a whole group to work with.
 *
 * A group used to be atomic: one run, one box, one overflow unit. That is fine
 * until a single group is wider than the strip — which is the normal case for
 * Format, whose ~11 controls measure around 600px against a strip that is
 * typically ~400px. Atomic meant all-or-nothing, so the ENTIRE group dropped
 * into the "⋮" and the strip rendered a caption and an overflow button next to
 * several hundred pixels of nothing. Users reasonably read that as broken.
 *
 * Splitting fixes it without a measuring pass here: the actions are already
 * sorted by relevance, so keeping a prefix inline keeps the RIGHT prefix — for
 * a row selection insert/delete stay put and the colour pickers fold away, not
 * the other way round.
 *
 * The budget is in slots rather than pixels because the real widths are not
 * known until layout, and `OverflowGroups` measures for real anyway; this only
 * has to make the units small enough that at least one of them fits. A
 * composite control (a select, a colour picker, a dropdown trigger) is roughly
 * twice an icon button, hence the weights.
 */
const SLOTS_PER_BOX = 4

export function splitRunForOverflow(actions: StripAction[]): StripAction[][] {
  const boxes: StripAction[][] = []
  let current: StripAction[] = []
  let used = 0

  for (const action of actions) {
    const cost = action.render ? 2 : 1
    // Never emit an empty box: an action that is wider than the whole budget
    // still gets one to itself rather than being dropped.
    if (current.length && used + cost > SLOTS_PER_BOX) {
      boxes.push(current)
      current = []
      used = 0
    }
    current.push(action)
    used += cost
  }
  if (current.length) boxes.push(current)
  return boxes
}

/**
 * Ctrl/⌘+B / I / U, bound by whichever surface owns the shortcut.
 *
 * It lives outside `useContextActions` for a sharp reason: the model hook is now
 * called by BOTH the strip and the right-click menu, and a window listener
 * registered twice would toggle bold twice per press — i.e. never. The STRIP
 * owns it, because the strip is mounted exactly when there is a selection, which
 * is exactly when the shortcut means anything; the menu is transient and must
 * not re-bind it.
 *
 * The guards mirror `useCellSelection`'s: an event aimed at a form control (the
 * cell editor, the query box, a toolbar select) belongs to that control.
 * Swallowing the event matters for Ctrl+U in particular, which the browser would
 * otherwise take as "view source".
 */
export function useTextStyleShortcuts(
  toggleTextStyle: (key: TextStyleKey) => void,
) {
  const toggleRef = React.useRef(toggleTextStyle)
  toggleRef.current = toggleTextStyle
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      if (event.altKey || event.shiftKey) return
      const pressed = event.key.toLowerCase()
      const style = TEXT_STYLES.find(
        (entry) => entry.shortcut.slice(-1).toLowerCase() === pressed,
      )
      if (!style) return
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (target?.isContentEditable) return
      event.preventDefault()
      toggleRef.current(style.key)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}

/* --------------------------------------------------------------- the strip */

// The inline ops strip: one horizontal row of captioned clusters, docked above
// the table. Renderer ONE of the shared descriptor list.
export function CellContextStrip<T extends RowData>(
  props: ContextActionProps<T>,
) {
  const { title } = props
  const { actions, toggleTextStyle } = useContextActions(props)
  useTextStyleShortcuts(toggleTextStyle)

  // Menu-only actions never reach the strip. Everything else is rendered in the
  // order the model already put it in.
  const runs = groupActionRuns(
    actions.filter((action) => action.strip !== 'omit'),
  )

  const renderAction = (action: StripAction) => {
    if (action.render) return action.render()
    const Icon = action.icon
    if (!Icon) return null
    return (
      <button
        type="button"
        className={`icon-btn-sm ${TONE_CLASS[action.tone ?? 'neutral']}`}
        title={action.label}
        aria-label={action.label}
        disabled={action.disabled}
        onClick={action.onSelect}
      >
        <Icon size={16} aria-hidden="true" />
      </button>
    )
  }

  return (
    <div className="flex w-full min-w-0 items-center gap-2 px-2 py-1.5 text-sm text-slate-700">
      {/* The eyebrow. `title` has been a prop — and passed by every call site —
          since the strip was a popup, but it was never destructured, so users
          had no confirmation of WHAT the strip was about to act on. It is the
          first thing on the strip now, and it never scrolls or overflows away. */}
      {title ? (
        <span
          className="shrink-0 whitespace-nowrap rounded-md bg-slate-100 px-2 py-1 text-2xs font-semibold uppercase tracking-wide text-slate-500"
          title={`Acting on ${title}`}
        >
          {title}
        </span>
      ) : null}
      {/* No `overflow-x-auto` any more: what does not fit goes into the "⋮"
          menu instead of off the right-hand edge of a clipped scroller. */}
      <OverflowGroups className="min-w-0 flex-1">
        {runs.flatMap((run, runIndex) =>
          // One box per SLICE of a run, not per run — see splitRunForOverflow.
          // Only the first slice carries the caption; the rest continue it.
          splitRunForOverflow(run.actions).map((slice, sliceIndex) => (
            <ClusterBox
              key={`${run.group}-${runIndex}-${sliceIndex}`}
              name={sliceIndex === 0 ? GROUP_META[run.group].caption : undefined}
              tone={GROUP_META[run.group].tone}
            >
              {slice.map((action, index) => (
                <React.Fragment key={action.id}>
                  {action.dividerBefore && index > 0 ? <RunDivider /> : null}
                  {renderAction(action)}
                </React.Fragment>
              ))}
            </ClusterBox>
          )),
        )}
      </OverflowGroups>
    </div>
  )
}

export default CellContextStrip
