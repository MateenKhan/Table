import React from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Minus, Plus, RotateCcw } from 'lucide-react'
import { isDateType, type TypeOptions } from '../columnTypes'
import {
  CURRENCY_OPTIONS,
  DATE_FORMAT_PATTERNS,
  MAX_DECIMALS,
  MIN_DECIMALS,
  dateFormatKeyFromMeta,
  dateFormatPresetId,
  numberFormatPresetId,
  numberFormatSpecFromMeta,
  type NumberFormatSpec,
} from '../columnTypeRegistry'

// The number-format picker for the ops strip: plain number / percentage /
// currency, decimal places up and down, the thousands separator, and — for a
// date column — the date pattern.
//
// ── Why ONE control and not six strip buttons ────────────────────────────────
// The strip is portaled into a container capped at half the actions row; a
// cluster that outgrows it is a cluster that folds into the "⋮". Six top-level
// controls in the Format box would push the box past what fits at any realistic
// viewport and bury the whole of formatting behind the overflow menu — the exact
// failure the descriptor rewrite was undoing. So this is a single ~46px trigger
// whose panel is portaled to <body> with fixed positioning (the BorderControl
// pattern: an ancestor `overflow` can never clip it, Esc / outside-pointerdown
// close it, and it flips above the trigger when there is no room below).
//
// ── Why it writes to the COLUMN TYPE and says so ─────────────────────────────
// Number format is VALUE presentation — what the cell's text says — and that is
// owned per column by `columnTypeOverrides`, not per scope by `tableFormatting`
// (the full argument is at the top of `formatting.ts`). So a range selection
// still formats whole columns, and the panel states that in words rather than
// letting the user find out from the rows they did not select. `onApply` hands
// the caller a builder instead of a finished id precisely so the change is
// applied as a DELTA on each column's own resolved meta: bumping the decimals on
// a "Kilograms" column keeps its `kg`, and on a `currency` column keeps its
// currency. The picker adjusts a column's format; it does not overwrite its type.
//
// Note on percentage: this produces a `%` SUFFIX (43 → "43.0%"), the same thing
// the registry's built-in `percent` preset has always meant here. It deliberately
// does not multiply by 100 — that would silently disagree with the preset sitting
// two menus away, and re-typing the cell would then fight the formatter.

export type NumberFormatControlProps = {
  /**
   * The resolved meta of the PRIMARY (first formattable) selected column. Drives
   * every active state in the panel, and decides whether the date section shows.
   */
  current: TypeOptions
  /** How many columns an apply will touch — shown in the panel's caption. */
  columnCount: number
  /**
   * Apply a format change. `build` is called once per selected column with THAT
   * column's resolved meta and returns the preset id to store, `null` to clear
   * the column's override, or `undefined` to leave the column alone (used by the
   * date patterns, which mean nothing on a numeric column).
   */
  onApply: (build: (meta: TypeOptions) => string | null | undefined) => void
}

// A small labelled button used across the panel's sections.
function PanelButton({
  label,
  title,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  label?: string
  title: string
  active?: boolean
  disabled?: boolean
  onClick: () => void
  children?: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-8 min-w-[2rem] items-center justify-center gap-1 rounded-md border px-2 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-40 motion-reduce:transition-none sm:hover:bg-slate-100 ${
        active
          ? 'border-accent-400 bg-accent-500/10 text-accent-600'
          : 'border-slate-200 text-slate-600'
      }`}
    >
      {children}
      {label ? <span>{label}</span> : null}
    </button>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 text-2xs font-semibold uppercase tracking-wide text-slate-400">
      {children}
    </div>
  )
}

export function NumberFormatControl({
  current,
  columnCount,
  onApply,
}: NumberFormatControlProps) {
  const [open, setOpen] = React.useState(false)
  const wrapRef = React.useRef<HTMLSpanElement>(null)
  const panelRef = React.useRef<HTMLDivElement>(null)
  const [pos, setPos] = React.useState<{ left: number; top: number } | null>(
    null,
  )

  // Position under the trigger, clamped to the viewport, flipping above when
  // there is no room below. Same measure-then-show dance as BorderControl, so
  // the panel never renders one frame in the wrong place.
  const reposition = React.useCallback(() => {
    const trigger = wrapRef.current
    const panel = panelRef.current
    if (!trigger) return
    const t = trigger.getBoundingClientRect()
    const margin = 8
    const panelW = panel?.offsetWidth ?? 260
    const panelH = panel?.offsetHeight ?? 300
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

  // The primary column's current format — every active state below reads this.
  const spec = numberFormatSpecFromMeta(current)
  const dateColumn = isDateType(current.type)
  const dateKey = dateFormatKeyFromMeta(current)

  /**
   * Apply a spec transform to every selected column. `mutate` receives the
   * column's OWN spec, so what the control does not explicitly change survives
   * per column (see the delta note at the top of the file).
   */
  const applySpec = (mutate: (spec: NumberFormatSpec) => NumberFormatSpec) => {
    onApply((meta) => numberFormatPresetId(mutate(numberFormatSpecFromMeta(meta))))
  }

  const applyDatePattern = (patternKey: string) => {
    onApply((meta) =>
      // A numeric column caught up in a multi-column selection has no business
      // becoming a date, so it is skipped rather than converted.
      isDateType(meta.type)
        ? dateFormatPresetId(meta.type === 'datetime' ? 'datetime' : 'date', patternKey)
        : undefined,
    )
  }

  const stepDecimals = (delta: number) =>
    applySpec((s) => ({
      ...s,
      decimals: Math.min(MAX_DECIMALS, Math.max(MIN_DECIMALS, s.decimals + delta)),
    }))

  const isPercent = spec.style === 'num' && spec.suffix === '%'
  const isPlain = spec.style === 'num' && !spec.suffix
  const scopeNote =
    columnCount > 1
      ? `Applies to all ${columnCount} selected columns`
      : 'Applies to the whole column'

  return (
    <span className="relative inline-flex shrink-0" ref={wrapRef}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Number format"
        title="Number format"
        onClick={() => setOpen((o) => !o)}
        className={`flex items-center gap-0.5 rounded-lg border px-1.5 py-1 text-sm transition-colors sm:hover:bg-slate-50 ${
          open
            ? 'border-accent-300 bg-accent-500/10 text-accent-600'
            : 'border-slate-300 text-slate-600'
        }`}
      >
        {/* "123" is the universally-read spreadsheet glyph for this menu, and it
            costs less width than any icon plus a label would. */}
        <span className="font-semibold leading-none tracking-tight">123</span>
        <ChevronDown size={13} className="flex-none text-slate-400" />
      </button>

      {open
        ? createPortal(
            <div
              ref={panelRef}
              role="dialog"
              aria-label="Number format"
              data-popover-portal=""
              className="fixed z-[100] w-64 rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-lg"
              style={{
                left: pos?.left ?? 0,
                top: pos?.top ?? 0,
                visibility: pos ? undefined : 'hidden',
              }}
            >
              <div className="flex flex-col gap-3">
                {/* The panel says out loud that this lands per COLUMN, because
                    the user may well have selected three cells. */}
                <p className="text-2xs leading-snug text-slate-500">{scopeNote}</p>

                <div>
                  <SectionLabel>Format</SectionLabel>
                  <div className="grid grid-cols-3 gap-1">
                    <PanelButton
                      label="123"
                      title="Plain number"
                      active={isPlain}
                      onClick={() =>
                        applySpec((s) => ({ ...s, style: 'num', suffix: '' }))
                      }
                    />
                    <PanelButton
                      label="%"
                      title="Percentage"
                      active={isPercent}
                      onClick={() =>
                        applySpec((s) => ({ ...s, style: 'num', suffix: '%' }))
                      }
                    />
                    <PanelButton
                      label="$"
                      title="Currency"
                      active={spec.style === 'cur'}
                      onClick={() =>
                        applySpec((s) => ({
                          ...s,
                          style: 'cur',
                          currency: s.currency,
                          suffix: '',
                        }))
                      }
                    />
                  </div>
                </div>

                {spec.style === 'cur' ? (
                  <div>
                    <SectionLabel>Currency</SectionLabel>
                    <select
                      className="select-sm w-full text-slate-600 border-slate-300"
                      aria-label="Currency"
                      value={spec.currency}
                      onChange={(event) => {
                        const code = event.target.value
                        applySpec((s) => ({
                          ...s,
                          style: 'cur',
                          currency: code,
                          suffix: '',
                        }))
                      }}
                    >
                      {CURRENCY_OPTIONS.map((option) => (
                        <option key={option.code} value={option.code}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}

                <div>
                  <SectionLabel>Decimal places</SectionLabel>
                  <div className="flex items-center gap-1">
                    <PanelButton
                      title="Decrease decimal places"
                      disabled={spec.decimals <= MIN_DECIMALS}
                      onClick={() => stepDecimals(-1)}
                    >
                      <Minus size={14} />
                    </PanelButton>
                    <span
                      className="min-w-[2rem] text-center text-sm tabular-nums text-slate-700"
                      aria-live="polite"
                    >
                      {spec.decimals}
                    </span>
                    <PanelButton
                      title="Increase decimal places"
                      disabled={spec.decimals >= MAX_DECIMALS}
                      onClick={() => stepDecimals(1)}
                    >
                      <Plus size={14} />
                    </PanelButton>
                    <span className="ml-auto">
                      <PanelButton
                        label="1,000"
                        title={
                          spec.grouping
                            ? 'Hide the thousands separator'
                            : 'Show the thousands separator'
                        }
                        active={spec.grouping}
                        onClick={() => {
                          // Target the primary column's OPPOSITE state so a
                          // mixed selection lands uniformly rather than each
                          // column flipping its own way.
                          const next = !spec.grouping
                          applySpec((s) => ({ ...s, grouping: next }))
                        }}
                      />
                    </span>
                  </div>
                </div>

                {/* Date patterns only exist for a date-ish column: offering them
                    on a number column would be offering to destroy its values. */}
                {dateColumn ? (
                  <div>
                    <SectionLabel>Date format</SectionLabel>
                    <div className="max-h-44 overflow-y-auto">
                      {DATE_FORMAT_PATTERNS.map((pattern) => {
                        const active = dateKey === pattern.key
                        return (
                          <button
                            key={pattern.key}
                            type="button"
                            aria-pressed={active}
                            onClick={() => applyDatePattern(pattern.key)}
                            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left tabular-nums transition-colors sm:hover:bg-slate-50 ${
                              active ? 'text-accent-600' : 'text-slate-700'
                            }`}
                          >
                            <span className="flex-1 truncate">{pattern.label}</span>
                            {active ? (
                              <Check size={14} className="flex-none text-accent-600" />
                            ) : null}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ) : null}

                <button
                  type="button"
                  onClick={() => onApply(() => null)}
                  title="Clear the format and fall back to the column's declared type"
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-slate-600 transition-colors sm:hover:bg-slate-50"
                >
                  <RotateCcw size={14} className="flex-none text-slate-400" />
                  <span>Default (column type)</span>
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </span>
  )
}

export default NumberFormatControl
