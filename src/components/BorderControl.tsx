import React from 'react'
import { createPortal } from 'react-dom'
import Tooltip from './Tooltip'
import ColorPickerButton from './ColorPickerButton'
import type { BorderSide, BorderStyle, Borders } from '../formatting'

// A compact, Excel-style border picker. The user sets a "pen" (colour + width +
// style), then clicks a placement preset to stamp that pen onto one/all sides of
// the current selection. Every preset emits a `borders` patch through `onApply`,
// which the ActionsBar routes into the formatting pipeline (onSetFormat).
//
// The TRIGGER is a small clickable "border box" that previews the current
// selection's borders (a neutral grid box when none). Clicking the box opens the
// OPTIONS DROPDOWN — a menu panel rendered via `createPortal` to `document.body`
// with fixed positioning. The portal matters: the ActionsBar toolbar scrolls
// with `overflow-x-auto`, which clips any absolutely-positioned child on BOTH
// axes, so an in-flow popover was being cut off (why it "wasn't visible when
// clicked"). Fixed + portaled, the panel floats above everything (z-[100]),
// viewport-clamped, Esc / outside-close, reduced-motion safe.

export type BorderControlProps = {
  /** Writes a border patch to the current selection's scope. */
  onApply: (patch: { borders: Borders }) => void
  /** The selection's currently-resolved borders (used to light up presets). */
  currentBorders?: Borders
}

const DEFAULT_COLOR = '#334155'

// Width presets S / M / L, plus a custom 1–10 input (see the Width section).
const WIDTH_PRESETS: { label: string; value: number }[] = [
  { label: 'S', value: 1 },
  { label: 'M', value: 3 },
  { label: 'L', value: 6 },
]

const STYLE_OPTIONS: BorderStyle[] = ['solid', 'dashed', 'dotted', 'double']

type Placement = 'all' | 'outer' | 'none' | 'top' | 'bottom' | 'left' | 'right'

// Which sides each placement touches. `all` / `outer` are identical here — a
// per-side-uniform model has no distinct "inner"; both set every side.
const PLACEMENT_SIDES: Record<Exclude<Placement, 'none'>, (keyof Borders)[]> = {
  all: ['top', 'right', 'bottom', 'left'],
  outer: ['top', 'right', 'bottom', 'left'],
  top: ['top'],
  bottom: ['bottom'],
  left: ['left'],
  right: ['right'],
}

// Build the `borders` patch a preset applies, from the current pen.
function buildPatch(placement: Placement, side: BorderSide): Borders {
  if (placement === 'none') {
    // Explicit nulls clear each side (distinct from "absent = inherit").
    return { top: null, right: null, bottom: null, left: null }
  }
  const patch: Borders = {}
  for (const s of PLACEMENT_SIDES[placement]) patch[s] = { ...side }
  return patch
}

// ── Tiny glyphs ──────────────────────────────────────────────────────────────
// A 16px box whose highlighted sides show which placement a preset applies.
function PlacementGlyph({ sides }: { sides: (keyof Borders)[] }) {
  const on = (s: keyof Borders) => sides.includes(s)
  const strong = { stroke: 'currentColor', strokeWidth: 1.75 }
  const faint = { stroke: 'currentColor', strokeWidth: 1, opacity: 0.25 }
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true" fill="none">
      <line x1="2" y1="2.5" x2="14" y2="2.5" {...(on('top') ? strong : faint)} />
      <line x1="2" y1="13.5" x2="14" y2="13.5" {...(on('bottom') ? strong : faint)} />
      <line x1="2.5" y1="2" x2="2.5" y2="14" {...(on('left') ? strong : faint)} />
      <line x1="13.5" y1="2" x2="13.5" y2="14" {...(on('right') ? strong : faint)} />
    </svg>
  )
}

function NoBordersGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true" fill="none">
      <rect
        x="2.5"
        y="2.5"
        width="11"
        height="11"
        stroke="currentColor"
        strokeWidth="1"
        strokeDasharray="2 2"
        opacity="0.4"
      />
    </svg>
  )
}

// The trigger box: a 4-sided preview of the current selection's borders. A side
// carrying a drawn border shows in its own colour; a cleared/absent side shows
// as a faint hairline (the neutral grid box).
function TriggerBox({ borders }: { borders?: Borders }) {
  const attrsFor = (s: keyof Borders) => {
    const side = borders?.[s]
    if (side) return { stroke: side.color, strokeWidth: 2, opacity: 1 }
    return { stroke: 'currentColor', strokeWidth: 1, opacity: 0.35 }
  }
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none">
      <line x1="2" y1="2.5" x2="14" y2="2.5" {...attrsFor('top')} />
      <line x1="2" y1="13.5" x2="14" y2="13.5" {...attrsFor('bottom')} />
      <line x1="2.5" y1="2" x2="2.5" y2="14" {...attrsFor('left')} />
      <line x1="13.5" y1="2" x2="13.5" y2="14" {...attrsFor('right')} />
    </svg>
  )
}

// A short line preview drawn in a given CSS border style, for the style picker.
function StylePreview({ borderStyle }: { borderStyle: BorderStyle }) {
  return (
    <span
      aria-hidden="true"
      className="block w-7"
      style={{
        height: 0,
        borderTop:
          borderStyle === 'double'
            ? `3px double currentColor`
            : `2px ${borderStyle} currentColor`,
      }}
    />
  )
}

// Does the resolved selection currently carry a drawn border on every side of a
// placement? Used only to light the preset as active — cosmetic, best-effort.
function placementActive(
  placement: Placement,
  borders: Borders | undefined,
): boolean {
  if (!borders) return false
  if (placement === 'none') {
    return (['top', 'right', 'bottom', 'left'] as const).every(
      (s) => borders[s] === null,
    )
  }
  return PLACEMENT_SIDES[placement].every((s) => Boolean(borders[s]))
}

export function BorderControl({ onApply, currentBorders }: BorderControlProps) {
  const [open, setOpen] = React.useState(false)
  const [color, setColor] = React.useState(DEFAULT_COLOR)
  const [width, setWidth] = React.useState(1)
  const [style, setStyle] = React.useState<BorderStyle>('solid')
  // While the colour picker is open, the other sections hide so the colour being
  // applied is easy to see (user request).
  const [colorOpen, setColorOpen] = React.useState(false)
  // Draft for the custom-width input (committed clamped to 1–10 on blur/Enter).
  const [widthDraft, setWidthDraft] = React.useState(String(width))
  React.useEffect(() => setWidthDraft(String(width)), [width])
  const commitWidth = () => {
    const n = parseInt(widthDraft, 10)
    if (Number.isNaN(n) || n < 1) return setWidthDraft(String(width))
    setWidth(Math.min(n, 10))
  }
  const wrapRef = React.useRef<HTMLSpanElement>(null)
  const panelRef = React.useRef<HTMLDivElement>(null)
  // Fixed viewport coordinates for the portaled panel; null until measured, so
  // the panel renders hidden for one frame while it computes its clamp.
  const [pos, setPos] = React.useState<{ left: number; top: number } | null>(
    null,
  )

  // Position the panel under the trigger, clamped to the viewport. Measured off
  // the real panel size so it never runs off an edge; flips above the trigger
  // when there is no room below.
  const reposition = React.useCallback(() => {
    const trigger = wrapRef.current
    const panel = panelRef.current
    if (!trigger) return
    const t = trigger.getBoundingClientRect()
    const margin = 8
    const panelW = panel?.offsetWidth ?? 272
    const panelH = panel?.offsetHeight ?? 320
    let left = t.left
    if (left + panelW > window.innerWidth - margin) {
      left = window.innerWidth - margin - panelW
    }
    if (left < margin) left = margin
    let top = t.bottom + 6
    if (top + panelH > window.innerHeight - margin) {
      const above = t.top - 6 - panelH
      top = above >= margin ? above : Math.max(margin, window.innerHeight - margin - panelH)
    }
    setPos({ left, top })
  }, [])

  // Measure + clamp as soon as the panel mounts, and keep it anchored while the
  // toolbar or window scrolls / resizes underneath it.
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

  // Esc + outside pointer-down close. Because the panel is portaled OUT of the
  // wrapper, "outside" must exclude BOTH the trigger and the panel (the nested
  // colour popover lives inside the panel, so interacting with it stays open).
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
      // The colour picker portals its popover OUT of the panel to <body>; treat
      // clicks/drags inside any portaled popover as inside (so picking a colour
      // doesn't close the border dropdown out from under the drag).
      const el =
        target instanceof Element ? target : (target as ChildNode).parentElement
      if (el?.closest('[data-popover-portal]')) return
      setOpen(false)
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onDown, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onDown, true)
    }
  }, [open])

  const apply = (placement: Placement) => {
    const side: BorderSide = { color, width, style }
    onApply({ borders: buildPatch(placement, side) })
  }

  const hasAnyBorder =
    !!currentBorders &&
    (['top', 'right', 'bottom', 'left'] as const).some((s) =>
      Boolean(currentBorders[s]),
    )

  // A labelled placement button used in the preset grid: a box glyph + caption.
  const PresetButton = ({
    placement,
    label,
    caption,
    children,
  }: {
    placement: Placement
    label: string
    caption: string
    children: React.ReactNode
  }) => {
    const active = placementActive(placement, currentBorders)
    return (
      <Tooltip label={label}>
        <button
          type="button"
          aria-label={label}
          aria-pressed={active}
          className={`flex flex-col items-center gap-1 rounded-md border px-1 py-1.5 transition-colors motion-reduce:transition-none active:scale-95 motion-reduce:active:scale-100 sm:hover:bg-slate-100 ${
            active
              ? 'border-accent-500 bg-accent-500/10 text-accent-600'
              : 'border-slate-200 text-slate-600'
          }`}
          onClick={() => apply(placement)}
        >
          {children}
          <span className="text-[10px] font-medium leading-none">{caption}</span>
        </button>
      </Tooltip>
    )
  }

  return (
    <span className="relative inline-flex" ref={wrapRef}>
      <Tooltip label="Borders">
        <button
          type="button"
          aria-label="Borders"
          aria-haspopup="dialog"
          aria-expanded={open}
          className={`icon-btn${open || hasAnyBorder ? ' bg-accent-500/10 text-accent-600' : ''}`}
          onClick={() => setOpen((o) => !o)}
        >
          <TriggerBox borders={currentBorders} />
        </button>
      </Tooltip>

      {open
        ? createPortal(
            <div
              ref={panelRef}
              role="dialog"
              aria-label="Borders"
              className="fixed z-[100] w-64 rounded-lg border border-slate-200 bg-white p-3 shadow-lg"
              style={{
                left: pos?.left ?? 0,
                top: pos?.top ?? 0,
                visibility: pos ? undefined : 'hidden',
              }}
            >
              <div className="flex flex-col gap-3">
                {/* Colour — first, and always visible. The swatch shows the pen
                    colour so it's easy to see what will be applied. */}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-2xs font-semibold uppercase tracking-wide text-slate-400">
                    Colour
                  </span>
                  <span
                    aria-hidden="true"
                    className="h-4 w-4 rounded border border-slate-200"
                    style={{ backgroundColor: color }}
                  />
                  <ColorPickerButton
                    label="Border color"
                    value={color}
                    onChange={(c) => setColor(c ?? DEFAULT_COLOR)}
                    onOpenChange={setColorOpen}
                  />
                </div>

                {/* Everything else hides while the colour picker is open. */}
                {!colorOpen ? (
                  <>
                    <div>
                      <div className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-slate-400">
                        Placement
                      </div>
                      <div className="grid grid-cols-4 gap-1.5">
                        <PresetButton placement="all" label="All borders" caption="All">
                          <PlacementGlyph sides={['top', 'right', 'bottom', 'left']} />
                        </PresetButton>
                        <PresetButton placement="outer" label="Outer border" caption="Outer">
                          <PlacementGlyph sides={['top', 'right', 'bottom', 'left']} />
                        </PresetButton>
                        <PresetButton placement="top" label="Top border" caption="Top">
                          <PlacementGlyph sides={['top']} />
                        </PresetButton>
                        <PresetButton placement="bottom" label="Bottom border" caption="Bottom">
                          <PlacementGlyph sides={['bottom']} />
                        </PresetButton>
                        <PresetButton placement="left" label="Left border" caption="Left">
                          <PlacementGlyph sides={['left']} />
                        </PresetButton>
                        <PresetButton placement="right" label="Right border" caption="Right">
                          <PlacementGlyph sides={['right']} />
                        </PresetButton>
                        <PresetButton placement="none" label="No borders" caption="None">
                          <NoBordersGlyph />
                        </PresetButton>
                      </div>
                    </div>

                    {/* Width: S / M / L + a custom 1–10 input. */}
                    <div>
                      <div className="mb-1 text-2xs font-semibold uppercase tracking-wide text-slate-400">
                        Width
                      </div>
                      <div className="flex items-center gap-1">
                        {WIDTH_PRESETS.map((opt) => {
                          const active = width === opt.value
                          return (
                            <Tooltip key={opt.value} label={`${opt.label} — ${opt.value}px`}>
                              <button
                                type="button"
                                aria-label={`${opt.label} width, ${opt.value}px`}
                                aria-pressed={active}
                                className={`h-8 min-w-[2rem] rounded-md border px-2 text-sm font-semibold transition-colors motion-reduce:transition-none sm:hover:bg-slate-100 ${
                                  active
                                    ? 'border-accent-400 bg-accent-500/10 text-accent-600'
                                    : 'border-slate-200 text-slate-600'
                                }`}
                                onClick={() => setWidth(opt.value)}
                              >
                                {opt.label}
                              </button>
                            </Tooltip>
                          )
                        })}
                        <input
                          type="text"
                          inputMode="numeric"
                          aria-label="Custom border width, 1 to 10"
                          title="Custom width (1–10)"
                          className="input-sm !h-8 !min-h-0 !w-12 !px-1 text-center"
                          value={widthDraft}
                          onChange={(e) =>
                            setWidthDraft(e.target.value.replace(/[^0-9]/g, ''))
                          }
                          onBlur={commitWidth}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              commitWidth()
                              e.currentTarget.blur()
                            }
                          }}
                        />
                        <span className="text-2xs text-slate-500">px</span>
                      </div>
                    </div>

                    <div>
                      <div className="mb-1 text-2xs font-semibold uppercase tracking-wide text-slate-400">
                        Style
                      </div>
                      <div className="grid grid-cols-4 gap-1">
                        {STYLE_OPTIONS.map((opt) => {
                          const active = style === opt
                          return (
                            <Tooltip key={opt} label={opt[0].toUpperCase() + opt.slice(1)}>
                              <button
                                type="button"
                                aria-label={`${opt} border style`}
                                aria-pressed={active}
                                className={`grid h-8 place-items-center rounded-md border transition-colors motion-reduce:transition-none sm:hover:bg-slate-100 ${
                                  active
                                    ? 'border-accent-400 bg-accent-500/10 text-accent-600'
                                    : 'border-slate-200 text-slate-500'
                                }`}
                                onClick={() => setStyle(opt)}
                              >
                                <StylePreview borderStyle={opt} />
                              </button>
                            </Tooltip>
                          )
                        })}
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </span>
  )
}

export default BorderControl
