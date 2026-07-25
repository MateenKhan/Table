import React from 'react'
import { createPortal } from 'react-dom'
import type { Column, RowData, Table } from '@tanstack/react-table'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowDownWideNarrow,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpNarrowWide,
  ArrowUpToLine,
  Baseline,
  Ban,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  Group,
  PaintBucket,
  Pin,
  PinOff,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  Ungroup,
} from 'lucide-react'
import {
  Align,
  Borders,
  Format,
  tableFormatting,
  useFormatVersion,
} from '../formatting'
import {
  columnTypeOverrides,
  resolveColumnMeta,
  useColumnTypeOverridesVersion,
} from '../columnTypeOverrides'
import { getColumnTypePreset } from '../columnTypeRegistry'
import ColorPickerButton from './ColorPickerButton'
import ColumnTypePicker from './ColumnTypePicker'
import BorderControl from './BorderControl'

// An INLINE contextual operations strip for the current selection. It used to be
// a floating `fixed`-positioned popup card opened on a column/row click; now the
// action bar owns that surface, so this renders as a compact HORIZONTAL strip
// that CustomTable docks directly above the table, driven entirely by what is
// currently selected. No `x`/`y`, no viewport clamp, no Esc / outside-close, no
// `role="dialog"` — it is part of the layout, not a transient overlay.
//
// It carries the exact same operations it always has:
//   • Column target → column type (ColumnTypePicker), hide, pin / sort / group
//     (in a small "Arrange" dropdown), show-hidden-columns (a dropdown), plus
//     the shared format cluster and an "Enter formula" jump.
//   • Row target → freeze / unfreeze, row-height presets, plus the format cluster.
//   • Cell / range / whole-grid target → the format cluster only.
// The format cluster (background / text colour, alignment, borders) is always
// present and writes across EVERY scope key the current selection maps to.
//
// Writes still go straight to the `tableFormatting` singleton (and
// `columnTypeOverrides` / the TanStack `column` / `table`); the store is the
// source of truth and `useFormatVersion` re-renders the swatches as they change.

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
// picked here lines up exactly with the old global sizes.
const ROW_HEIGHT_PRESETS: { label: string; value: number }[] = [
  { label: 'Short', value: 26 },
  { label: 'Medium', value: 56 },
  { label: 'Tall', value: 108 },
]

type Props<T extends RowData> = {
  // Every `tableFormatting` scope key the current selection maps to. Colour /
  // alignment / border writes fan out across ALL of them (one for a whole
  // column / row, one-per-cell for a free range). The first key is also read
  // back for the active-state swatches.
  scopeKeys: string[]
  // Human label for the leading eyebrow, e.g. "Column C" / "Row 5" / "Selection".
  title?: string
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
  // then remove the row. Rendered in the ROW strip when wired.
  onPromoteToHeader?: () => void
  // Column-target only: structural column operations. Each renders in the COLUMN
  // strip only when its callback is wired.
  onInsertColumnLeft?: () => void
  onInsertColumnRight?: () => void
  onDeleteColumn?: () => void
}

const ALIGNMENTS: { value: Align; label: string }[] = [
  { value: 'left', label: 'Align left' },
  { value: 'center', label: 'Align centre' },
  { value: 'right', label: 'Align right' },
]

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

// Vertical hairline between clusters on the strip itself.
function ClusterDivider() {
  return <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 bg-slate-200" />
}

// A compact strip button that opens a small menu panel. The panel is rendered
// through a portal with FIXED positioning (measured under the trigger, clamped
// to the viewport) so it is never clipped by the strip's own `overflow-x-auto`
// — the same trick BorderControl uses. Esc / outside pointer-down close it, and
// the render-prop hands children a `close()` so an item can dismiss the menu.
function StripMenu({
  label,
  icon: Icon,
  ariaLabel,
  disabled = false,
  children,
}: {
  label: string
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
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-1 whitespace-nowrap rounded-lg px-2 py-1 text-sm transition-colors disabled:pointer-events-none disabled:opacity-40 sm:hover:bg-slate-50 ${
          open ? 'bg-slate-50 text-accent-600' : 'text-slate-700'
        }`}
    >
        {Icon ? <Icon size={15} className="flex-none text-slate-500" /> : null}
        <span className="truncate">{label}</span>
        <ChevronDown size={13} className="flex-none text-slate-400" />
      </button>

      {open
        ? createPortal(
            <div
              ref={panelRef}
              role="menu"
              aria-label={ariaLabel}
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

export function CellContextStrip<T extends RowData>({
  scopeKeys,
  title,
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
}: Props<T>) {
  // Subscribe so swatch selection / clearing reflects instantly.
  useFormatVersion()
  // Subscribe so a chosen column type reflects the moment it is set.
  useColumnTypeOverridesVersion()

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

  // Clusters are assembled into an array so hairline dividers can be interleaved
  // between exactly the ones that are present (no leading / trailing divider).
  const clusters: React.ReactNode[] = []

  // Column type.
  if (column) {
    clusters.push(
      <div key="type" className="flex shrink-0 items-center gap-1">
        <span className="text-2xs font-semibold uppercase tracking-wide text-slate-400">
          Type
        </span>
        <div className="w-44">
          <ColumnTypePicker
            value={currentPresetId}
            typeLabel={typeLabel}
            onSelect={(presetId) => columnTypeOverrides.set(column.id, presetId)}
          />
        </div>
        {typeOverride ? (
          <button
            type="button"
            className="icon-btn-sm"
            title="Reset to default"
            aria-label="Reset column type to default"
            onClick={() => columnTypeOverrides.set(column.id, null)}
          >
            <RotateCcw size={15} />
          </button>
        ) : null}
      </div>,
    )
  }

  // Column ops: hide + an "Arrange" (pin / sort / group) menu + a
  // "Show hidden columns" menu.
  if (column) {
    clusters.push(
      <div key="colops" className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          className="icon-btn-sm"
          title="Hide column"
          aria-label="Hide column"
          onClick={() => column.toggleVisibility(false)}
        >
          <EyeOff size={16} />
        </button>

        <StripMenu label="Arrange" icon={SlidersHorizontal} ariaLabel="Pin, sort and group">
          {(close) => (
            <>
              {column.getCanPin() ? (
                <>
                  <MenuItem
                    icon={ArrowLeftToLine}
                    label="Pin left"
                    active={pinned === 'left'}
                    onClick={() => {
                      column.pin(pinned === 'left' ? false : 'left')
                      close()
                    }}
                  />
                  <MenuItem
                    icon={ArrowRightToLine}
                    label="Pin right"
                    active={pinned === 'right'}
                    onClick={() => {
                      column.pin(pinned === 'right' ? false : 'right')
                      close()
                    }}
                  />
                  {pinned ? (
                    <MenuItem
                      icon={PinOff}
                      label="Unpin"
                      onClick={() => {
                        column.pin(false)
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
                  column.toggleSorting(false)
                  close()
                }}
              />
              <MenuItem
                icon={ArrowDownWideNarrow}
                label="Sort descending"
                active={sorted === 'desc'}
                onClick={() => {
                  column.toggleSorting(true)
                  close()
                }}
              />
              {sorted ? (
                <MenuItem
                  icon={Ban}
                  label="Clear sort"
                  onClick={() => {
                    column.clearSorting()
                    close()
                  }}
                />
              ) : null}

              {column.getCanGroup() ? (
                <>
                  <MenuDivider />
                  {column.getIsGrouped() ? (
                    <MenuItem
                      icon={Ungroup}
                      label="Ungroup"
                      active
                      onClick={() => {
                        column.getToggleGroupingHandler()()
                        close()
                      }}
                    />
                  ) : (
                    <MenuItem
                      icon={Group}
                      label="Group by this column"
                      onClick={() => {
                        column.getToggleGroupingHandler()()
                        close()
                      }}
                    />
                  )}
                </>
              ) : null}
            </>
          )}
        </StripMenu>

        {/* Show hidden columns — the ONLY way back for a column with no header
            left to click, so it stays reachable from every column's strip. */}
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
      </div>,
    )
  }

  // Column structural ops: insert a column left / right of this one, delete this
  // column. Each button renders only when its callback is wired.
  if (onInsertColumnLeft || onInsertColumnRight || onDeleteColumn) {
    clusters.push(
      <div key="colstruct" className="flex shrink-0 items-center gap-1">
        {onInsertColumnLeft ? (
          <button
            type="button"
            className="icon-btn-sm"
            title="Insert column left"
            aria-label="Insert column left"
            onClick={onInsertColumnLeft}
          >
            <ArrowLeftToLine size={16} />
          </button>
        ) : null}
        {onInsertColumnRight ? (
          <button
            type="button"
            className="icon-btn-sm"
            title="Insert column right"
            aria-label="Insert column right"
            onClick={onInsertColumnRight}
          >
            <ArrowRightToLine size={16} />
          </button>
        ) : null}
        {onDeleteColumn ? (
          <button
            type="button"
            className="icon-btn-sm text-slate-500 sm:hover:bg-rose-50 sm:hover:text-rose-600"
            title="Delete column"
            aria-label="Delete column"
            onClick={onDeleteColumn}
          >
            <Trash2 size={16} />
          </button>
        ) : null}
      </div>,
    )
  }

  // Promote row to header (row target): use this row's values as the column
  // headers, then remove the row.
  if (onPromoteToHeader) {
    clusters.push(
      <div key="promote" className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          className="btn-ghost-sm whitespace-nowrap"
          title="Use this row's values as column headers, then remove the row"
          aria-label="Use as header"
          onClick={onPromoteToHeader}
        >
          <ArrowUpToLine size={16} aria-hidden="true" />
          Use as header
        </button>
      </div>,
    )
  }

  // Freeze / unfreeze (row target).
  if (onToggleRowPin) {
    clusters.push(
      <div key="freeze" className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          aria-pressed={isRowPinned}
          className={`icon-btn-sm ${
            isRowPinned ? 'bg-accent-500/10 text-accent-600' : ''
          }`}
          title={isRowPinned ? 'Unfreeze row' : 'Freeze row'}
          aria-label={isRowPinned ? 'Unfreeze row' : 'Freeze row'}
          onClick={onToggleRowPin}
        >
          {isRowPinned ? <PinOff size={16} /> : <Pin size={16} />}
        </button>
      </div>,
    )
  }

  // Row-height presets (row target).
  if (onSetRowHeight) {
    clusters.push(
      <div key="height" className="flex shrink-0 items-center gap-1">
        <span className="text-2xs font-semibold uppercase tracking-wide text-slate-400">
          Height
        </span>
        {ROW_HEIGHT_PRESETS.map(({ label, value }) => {
          const active = rowHeight === value
          return (
            <button
              key={label}
              type="button"
              aria-pressed={active}
              className={`rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
                active
                  ? 'border-accent-200 bg-accent-500/10 text-accent-600'
                  : 'border-slate-200 text-slate-700 sm:hover:bg-slate-50'
              }`}
              onClick={() => onSetRowHeight(value)}
            >
              {label}
            </button>
          )
        })}
      </div>,
    )
  }

  // Format cluster — always present: background / text colour, alignment, borders.
  clusters.push(
    <div key="format" className="flex shrink-0 items-center gap-1">
      <ColorPickerButton
        label="Background color"
        value={format.bg}
        onChange={setBg}
        swatches={BG_SWATCHES}
        icon={<PaintBucket size={16} />}
      />
      <ColorPickerButton
        label="Text color"
        value={format.fg}
        onChange={setFg}
        swatches={FG_SWATCHES}
        icon={<Baseline size={16} />}
      />
      <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-slate-200" />
      {ALIGNMENTS.map(({ value, label }) => {
        const active = format.align === value
        return (
          <button
            key={value}
            type="button"
            aria-label={label}
            aria-pressed={active}
            className={`icon-btn-sm ${
              active ? 'bg-accent-500/10 text-accent-600' : ''
            }`}
            onClick={() => setAlign(active ? undefined : value)}
          >
            <AlignGlyph dir={value} />
          </button>
        )
      })}
      <span aria-hidden="true" className="mx-0.5 h-5 w-px bg-slate-200" />
      <BorderControl
        onApply={(patch) => setBorders(patch.borders)}
        currentBorders={format.borders}
      />
    </div>,
  )

  // Enter formula (writable column target).
  if (onEnterFormula) {
    clusters.push(
      <div key="formula" className="flex shrink-0 items-center">
        <button
          type="button"
          className="btn-ghost-sm whitespace-nowrap"
          onClick={onEnterFormula}
        >
          Enter formula…
        </button>
      </div>,
    )
  }

  return (
    <div className="custom-scrollbar flex w-full items-center gap-2 overflow-x-auto px-2 py-1.5 text-sm text-slate-700">
      {title ? (
        <span className="eyebrow shrink-0 whitespace-nowrap">{title}</span>
      ) : null}
      {clusters.map((node, index) => (
        <React.Fragment key={index}>
          {index > 0 || title ? <ClusterDivider /> : null}
          {node}
        </React.Fragment>
      ))}
    </div>
  )
}

export default CellContextStrip
