import React from 'react'
import { PaintBucket } from 'lucide-react'
import Tooltip from './Tooltip'
import { useConfirm } from '../piranha'
import ColorPickerButton from './ColorPickerButton'
import BorderControl from './BorderControl'
import type { Borders } from '../formatting'

// A dynamic, icon-only action row for the table. Every button is icon-only and
// carries a <Tooltip> for its name (+ keyboard shortcut) — no visible text
// labels. Which buttons appear is driven entirely by `scope`, the current
// selection, passed in through props. Data-loss confirms go through piranha's
// shared promise-based `useConfirm()` (src/piranha/) rather than a hand-rolled
// popover, so there is zero divergent confirm code at import time. Every
// mutation is still delegated to a callback prop.

// Piranha's <Tooltip> takes a single `label` string (no explanation/shortcut
// props), so fold an optional key-cap hint into the label as `Label (Ctrl+X)`,
// matching piranha's own convention ("Close (Esc)").
function tipLabel(label: string, shortcut?: string | string[]): string {
  if (!shortcut) return label
  const keys = Array.isArray(shortcut) ? shortcut : [shortcut]
  return keys.length ? `${label} (${keys.join('+')})` : label
}

// ── Public prop / type API (the parent wires straight to these) ───────────────
export type ActionScopeKind =
  | 'none'
  | 'cell'
  | 'range'
  | 'rows'
  | 'columns'
  | 'all'

export type ActionFormat = {
  bg?: string
  fg?: string
  align?: 'left' | 'center' | 'right'
  fontSize?: string
  fontFamily?: string
  borders?: Borders
}

export type ActionsBarProps = {
  scope: { kind: ActionScopeKind; rowIndices: number[]; columnIds: string[] }
  /** Drives the data-loss confirm on empty/delete of a selection. */
  selectionHasValues: boolean
  onDeleteAllTable: () => void
  onRestoreTable: () => void
  onDeleteRows: (rowIndices: number[]) => void
  onEmptyColumns: (columnIds: string[]) => void
  onMergeColumns: (columnIds: string[]) => void
  /** Effective format of the current selection — reflected as active state. */
  currentFormat: ActionFormat
  /** '' / undefined in a field clears it. */
  onSetFormat: (patch: ActionFormat) => void
  fontFamilies?: { label: string; value: string }[]
  fontSizes?: string[]
}

// ── Inline SVG icons — 16px, currentColor, no icon-library dependency ─────────
const svgBase = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

function TrashAllIcon() {
  return (
    <svg {...svgBase}>
      <path d="M2.5 4h11" />
      <path d="M6 4V2.5h4V4" />
      <path d="M3.6 4l.6 8.6a1 1 0 0 0 1 .9h5.6a1 1 0 0 0 1-.9L12.4 4" />
      <path d="M6.5 6.8v4.4M9.5 6.8v4.4" />
    </svg>
  )
}

function RestoreIcon() {
  return (
    <svg {...svgBase}>
      <path d="M12.8 8a4.8 4.8 0 1 1-1.5-3.5" />
      <path d="M12.8 2.6V5H10.4" />
    </svg>
  )
}

function DeleteRowsIcon() {
  return (
    <svg {...svgBase}>
      <line x1="2.2" y1="4" x2="13.8" y2="4" />
      <line x1="2.2" y1="8" x2="7.5" y2="8" />
      <line x1="2.2" y1="12" x2="13.8" y2="12" />
      <path d="M10.4 6.4l3.2 3.2M13.6 6.4l-3.2 3.2" />
    </svg>
  )
}

function EraserIcon() {
  return (
    <svg {...svgBase}>
      <path d="M8.4 13H13" />
      <path d="M7.6 13L3 8.4a1.1 1.1 0 0 1 0-1.5l4.1-4.1a1.1 1.1 0 0 1 1.5 0l3.5 3.5a1.1 1.1 0 0 1 0 1.5L8 13z" />
      <path d="M5.6 5l4.9 4.9" />
    </svg>
  )
}

function MergeIcon() {
  return (
    <svg {...svgBase}>
      <path d="M3 2.8l4 4M13 2.8l-4 4" />
      <path d="M8 6.8V13" />
      <path d="M6 11l2 2 2-2" />
    </svg>
  )
}

function AlignGlyph({ dir }: { dir: 'left' | 'center' | 'right' }) {
  // Middle line is shorter and anchored per direction; top/bottom span full.
  const x1 = dir === 'left' ? 2 : dir === 'right' ? 8 : 4
  const x2 = dir === 'left' ? 8 : dir === 'right' ? 14 : 12
  return (
    <svg {...svgBase}>
      <line x1="2" y1="4" x2="14" y2="4" />
      <line x1={x1} y1="8" x2={x2} y2="8" />
      <line x1="2" y1="12" x2="14" y2="12" />
    </svg>
  )
}

function TextColorGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M4 11.2 7.5 3.4 11 11.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5.4 8.6h4.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

// ── A hairline cluster divider ────────────────────────────────────────────────
function Divider() {
  return <span aria-hidden="true" className="mx-0.5 h-6 border-l border-slate-200" />
}

// ── Destructive/heavy action button → piranha's shared useConfirm() dialog ────
type ConfirmButtonProps = {
  icon: React.ReactNode
  label: string
  shortcut?: string | string[]
  message: string
  /** Confirm-button label in the dialog (piranha defaults to "Delete"). */
  confirmLabel?: string
  /** When false the action fires immediately with no confirm step. */
  requireConfirm: boolean
  danger?: boolean
  onConfirm: () => void
}

function ConfirmButton({
  icon,
  label,
  shortcut,
  message,
  confirmLabel,
  requireConfirm,
  danger,
  onConfirm,
}: ConfirmButtonProps) {
  const confirm = useConfirm()

  const handleClick = async () => {
    if (!requireConfirm) {
      onConfirm()
      return
    }
    const ok = await confirm({
      title: label,
      message,
      confirmLabel,
      tone: danger ? 'danger' : 'default',
    })
    if (ok) onConfirm()
  }

  return (
    <Tooltip label={tipLabel(label, shortcut)}>
      <button
        type="button"
        aria-label={label}
        aria-haspopup={requireConfirm ? 'dialog' : undefined}
        className={`icon-btn${danger ? ' icon-btn-danger' : ''}`}
        onClick={handleClick}
      >
        {icon}
      </button>
    </Tooltip>
  )
}

// ── Alignment toggle (accent = active) ────────────────────────────────────────
const ALIGN_OPTS: {
  value: 'left' | 'center' | 'right'
  label: string
}[] = [
  { value: 'left', label: 'Align left' },
  { value: 'center', label: 'Align centre' },
  { value: 'right', label: 'Align right' },
]

const ALIGN_SHORTCUT: Record<'left' | 'center' | 'right', string[]> = {
  left: ['Ctrl', 'Shift', 'L'],
  center: ['Ctrl', 'Shift', 'E'],
  right: ['Ctrl', 'Shift', 'R'],
}

export function ActionsBar({
  scope,
  selectionHasValues,
  onDeleteAllTable,
  onRestoreTable,
  onDeleteRows,
  onEmptyColumns,
  onMergeColumns,
  currentFormat,
  onSetFormat,
  fontFamilies,
  fontSizes,
}: ActionsBarProps) {
  const { kind, rowIndices, columnIds } = scope
  const hasSelection = kind !== 'none'
  const showSize = Boolean(fontSizes && fontSizes.length)
  const showFamily = Boolean(fontFamilies && fontFamilies.length)

  return (
    <div
      role="toolbar"
      aria-label="Table actions"
      className="custom-scrollbar flex flex-wrap items-center gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-white px-1.5 py-1"
    >
      {/* Always available — both heavy, both confirm first. */}
      <ConfirmButton
        icon={<TrashAllIcon />}
        label="Delete all table"
        shortcut={['Ctrl', 'Shift', 'Del']}
        message="This will permanently delete all rows in the table. Continue?"
        confirmLabel="Delete all"
        requireConfirm
        danger
        onConfirm={onDeleteAllTable}
      />
      <ConfirmButton
        icon={<RestoreIcon />}
        label="Restore table"
        message="This will reset the table to its default data. Continue?"
        confirmLabel="Restore"
        requireConfirm
        onConfirm={onRestoreTable}
      />

      {/* Row-scoped. */}
      {kind === 'rows' ? (
        <>
          <Divider />
          <ConfirmButton
            icon={<DeleteRowsIcon />}
            label="Delete rows"
            shortcut={['Ctrl', 'Del']}
            message={`This will permanently delete ${rowIndices.length} row${
              rowIndices.length === 1 ? '' : 's'
            }. Continue?`}
            confirmLabel="Delete"
            requireConfirm={selectionHasValues}
            danger
            onConfirm={() => onDeleteRows(rowIndices)}
          />
        </>
      ) : null}

      {/* Column-scoped. */}
      {kind === 'columns' ? (
        <>
          <Divider />
          <ConfirmButton
            icon={<EraserIcon />}
            label="Empty columns"
            shortcut={['Del']}
            message={`This will permanently clear values in ${columnIds.length} column${
              columnIds.length === 1 ? '' : 's'
            }. Continue?`}
            confirmLabel="Empty"
            requireConfirm={selectionHasValues}
            danger
            onConfirm={() => onEmptyColumns(columnIds)}
          />
          {columnIds.length >= 2 ? (
            <ConfirmButton
              icon={<MergeIcon />}
              label="Merge columns"
              shortcut={['Ctrl', 'M']}
              message={`Merging ${columnIds.length} columns into one may discard some values. Continue?`}
              confirmLabel="Merge"
              requireConfirm={selectionHasValues}
              onConfirm={() => onMergeColumns(columnIds)}
            />
          ) : null}
        </>
      ) : null}

      {/* Format cluster — shown whenever something is selected. */}
      {hasSelection ? (
        <>
          <Divider />

          {ALIGN_OPTS.map(({ value, label }) => {
            const active = currentFormat.align === value
            return (
              <Tooltip
                key={value}
                label={tipLabel(label, ALIGN_SHORTCUT[value])}
              >
                <button
                  type="button"
                  aria-label={label}
                  aria-pressed={active}
                  className={`icon-btn${
                    active ? ' bg-accent-500/10 text-accent-600' : ''
                  }`}
                  onClick={() =>
                    onSetFormat({ align: active ? undefined : value })
                  }
                >
                  <AlignGlyph dir={value} />
                </button>
              </Tooltip>
            )
          })}

          {showSize ? (
            <Tooltip label="Font size">
              <select
                aria-label="Font size"
                className="select-sm !w-auto min-w-[4.5rem] pr-6"
                value={currentFormat.fontSize ?? ''}
                onChange={(event) =>
                  onSetFormat({ fontSize: event.target.value || undefined })
                }
              >
                <option value="">Size</option>
                {fontSizes!.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </Tooltip>
          ) : null}

          {showFamily ? (
            <Tooltip label="Font family">
              <select
                aria-label="Font family"
                className="select-sm !w-auto min-w-[5rem] max-w-[8rem] pr-6"
                value={currentFormat.fontFamily ?? ''}
                onChange={(event) =>
                  onSetFormat({ fontFamily: event.target.value || undefined })
                }
              >
                <option value="">Font</option>
                {fontFamilies!.map((family) => (
                  <option key={family.value} value={family.value}>
                    {family.label}
                  </option>
                ))}
              </select>
            </Tooltip>
          ) : null}

          <ColorPickerButton
            label="Text color"
            icon={<TextColorGlyph />}
            value={currentFormat.fg}
            onChange={(c) => onSetFormat({ fg: c })}
          />
          <ColorPickerButton
            label="Background color"
            icon={<PaintBucket size={16} aria-hidden="true" />}
            value={currentFormat.bg}
            onChange={(c) => onSetFormat({ bg: c })}
          />
          <BorderControl
            onApply={(p) => onSetFormat(p)}
            currentBorders={currentFormat.borders}
          />
        </>
      ) : null}
    </div>
  )
}

export default ActionsBar
