import React from 'react'
import { createPortal } from 'react-dom'
// react-colorful injects its own styles automatically (no CSS import needed —
// the './dist/index.css' subpath isn't exported and breaks the prod build).
import { HexColorPicker, HexColorInput } from 'react-colorful'
import Tooltip from '../ui/Tooltip'

// A small icon button that opens a compact react-colorful popover. Reused by the
// toolbar (ActionsBar) and the per-cell/column ops (CellContextPopup) so every
// colour control in the app is one the shared UI-styled widget. The popover is
// PORTALED to the body with fixed positioning, so it can never be clipped by a
// scrolling/overflow ancestor (e.g. the action strip's overflow-x-auto).

export type ColorPickerButtonProps = {
  value?: string // current hex, e.g. "#ff3b1d"; undefined = unset
  onChange: (color: string | undefined) => void // undefined when cleared
  label: string // accessible name + tooltip, e.g. "Text color"
  icon?: React.ReactNode // trigger glyph; if absent, show a colour swatch
  swatches?: string[] // optional quick presets
  // Notified when the picker opens / closes, so a host popover can (e.g.) hide
  // its other controls while a colour is being picked.
  onOpenChange?: (open: boolean) => void
}

export function ColorPickerButton({
  value,
  onChange,
  label,
  icon,
  swatches,
  onOpenChange,
}: ColorPickerButtonProps) {
  const [open, setOpen] = React.useState(false)

  React.useEffect(() => {
    onOpenChange?.(open)
  }, [open, onOpenChange])
  const wrapRef = React.useRef<HTMLSpanElement>(null)
  const popRef = React.useRef<HTMLDivElement>(null)
  const [pos, setPos] = React.useState<{ left: number; top: number } | null>(
    null,
  )

  // Position the portaled panel under the trigger, clamped to the viewport.
  const place = React.useCallback(() => {
    const trigger = wrapRef.current
    if (!trigger) return
    const t = trigger.getBoundingClientRect()
    const margin = 8
    const w = popRef.current?.offsetWidth ?? 200
    const h = popRef.current?.offsetHeight ?? 220
    let left = t.left
    let top = t.bottom + 6
    if (left + w > window.innerWidth - margin)
      left = window.innerWidth - margin - w
    if (left < margin) left = margin
    if (top + h > window.innerHeight - margin)
      top = Math.max(margin, t.top - h - 6) // flip above if no room below
    setPos({ left, top })
  }, [])

  React.useLayoutEffect(() => {
    if (open) place()
    else setPos(null)
  }, [open, place])

  // Reposition + Esc / outside-close while open (outside checks BOTH the trigger
  // and the portaled panel, since the panel is not a DOM child of the wrapper).
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
      if (
        !wrapRef.current?.contains(target) &&
        !popRef.current?.contains(target)
      )
        setOpen(false)
    }
    const reflow = () => place()
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('resize', reflow)
    window.addEventListener('scroll', reflow, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('resize', reflow)
      window.removeEventListener('scroll', reflow, true)
    }
  }, [open, place])

  return (
    <span className="relative inline-flex" ref={wrapRef}>
      <Tooltip label={label}>
        <button
          type="button"
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          className="icon-btn-sm border border-slate-300 sm:hover:bg-slate-100"
          onClick={() => setOpen((o) => !o)}
        >
          {icon ? (
            <span className="relative inline-grid place-items-center">
              {icon}
              <span
                aria-hidden="true"
                className="absolute -bottom-1.5 left-1/2 h-1 w-3.5 -translate-x-1/2 rounded-full border border-slate-200"
                style={value ? { backgroundColor: value } : undefined}
              />
            </span>
          ) : (
            <span
              aria-hidden="true"
              className="h-4 w-4 rounded border border-slate-200"
              style={
                value
                  ? { backgroundColor: value }
                  : {
                      backgroundImage:
                        'linear-gradient(45deg,#cbd5e1 25%,transparent 25%,transparent 75%,#cbd5e1 75%),linear-gradient(45deg,#cbd5e1 25%,transparent 25%,transparent 75%,#cbd5e1 75%)',
                      backgroundSize: '6px 6px',
                      backgroundPosition: '0 0, 3px 3px',
                    }
              }
            />
          )}
        </button>
      </Tooltip>

      {open
        ? createPortal(
            <div
              ref={popRef}
              role="dialog"
              aria-label={label}
              data-popover-portal=""
              className="fixed z-[100] rounded-lg border border-slate-200 bg-white p-2 shadow-lg"
              style={{
                left: pos?.left ?? -9999,
                top: pos?.top ?? -9999,
                visibility: pos ? 'visible' : 'hidden',
              }}
            >
              <div className="flex flex-col gap-2">
                <HexColorPicker
                  color={value ?? '#000000'}
                  onChange={onChange}
                  style={{ width: 176, height: 150 }}
                />

                <div className="flex items-center gap-1.5">
                  <HexColorInput
                    color={value ?? ''}
                    onChange={onChange}
                    prefixed
                    className="input-sm !w-24"
                    aria-label={`${label} hex value`}
                  />
                  <button
                    type="button"
                    className="btn-ghost-sm"
                    onClick={() => onChange(undefined)}
                  >
                    Clear
                  </button>
                </div>

                {swatches && swatches.length ? (
                  <div className="grid grid-cols-8 gap-1">
                    {swatches.map((color) => (
                      <button
                        key={color}
                        type="button"
                        aria-label={color}
                        title={color}
                        aria-pressed={value === color}
                        onClick={() => onChange(color)}
                        className={`h-5 w-5 rounded border border-slate-200 transition-transform active:scale-95 sm:hover:scale-110 ${
                          value === color
                            ? 'ring-2 ring-accent-500 ring-offset-1'
                            : ''
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </span>
  )
}

export default ColorPickerButton
