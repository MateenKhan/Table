import React from 'react'
import { Modal } from '../ui'

// One source of truth for the grid's keyboard shortcuts. The handlers in
// `useCellSelection` implement these; this registry is what the help popup
// renders, so the documentation and the behaviour stay described in one place.
// Grouped exactly as the brief asks: Navigation / Editing / Selection /
// Clipboard / Other.

export type Shortcut = {
  // Rendered as individual key caps; a `+` between them reads as "held
  // together", a space reads as "or".
  keys: string[]
  label: string
}

export type ShortcutGroup = {
  title: string
  items: Shortcut[]
}

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    title: 'Navigation',
    items: [
      { keys: ['↑', '↓', '←', '→'], label: 'Move the active cell' },
      { keys: ['Tab'], label: 'Move one cell right' },
      { keys: ['Shift', 'Tab'], label: 'Move one cell left' },
      { keys: ['Home'], label: 'Jump to the start of the row' },
      { keys: ['End'], label: 'Jump to the end of the row' },
      { keys: ['Ctrl', 'Home'], label: 'Jump to the first cell of the grid' },
      { keys: ['Ctrl', 'End'], label: 'Jump to the last cell of the grid' },
      { keys: ['PgUp', 'PgDn'], label: 'Move up / down a page of rows' },
    ],
  },
  {
    title: 'Editing',
    items: [
      {
        keys: ['Enter'],
        label: 'Edit the cell — or open the preview on an image cell',
      },
      { keys: ['F2'], label: 'Edit the cell, keeping its current value' },
      { keys: ['A…Z', '0…9'], label: 'Start typing to overwrite the cell' },
      { keys: ['Esc'], label: 'Cancel editing, clear selection, or close a preview' },
      { keys: ['Delete', 'Backspace'], label: 'Clear the selected cells' },
    ],
  },
  {
    title: 'Selection',
    items: [
      { keys: ['Shift', '↑↓←→'], label: 'Extend the selection' },
      { keys: ['Shift', 'Home', 'End'], label: 'Extend to the row edge' },
      { keys: ['Ctrl', 'A'], label: 'Select the whole grid' },
    ],
  },
  {
    title: 'Clipboard',
    items: [
      { keys: ['Ctrl', 'C'], label: 'Copy the selection' },
      { keys: ['Ctrl', 'X'], label: 'Cut the selection' },
      { keys: ['Ctrl', 'V'], label: 'Paste at the active cell' },
    ],
  },
  {
    title: 'Other',
    items: [
      { keys: ['Ctrl', 'Z'], label: 'Undo' },
      { keys: ['Ctrl', 'Y'], label: 'Redo' },
      { keys: ['?'], label: 'Show this shortcuts help' },
    ],
  },
]

type Props = {
  onClose: () => void
}

// A single key cap. Small slate chip, per the design system (§1/§2 neutral
// surfaces, hairline border, no accent — this is passive reference, not state).
function KeyCap({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[1.5rem] items-center justify-center rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-2xs font-semibold text-slate-700 shadow-[0_1px_0_rgba(148,163,184,0.4)]">
      {children}
    </kbd>
  )
}

/**
 * The `?` help popup: every grid shortcut, grouped, inside the shared UI's shared
 * <Modal> (src/ui/Modal.tsx) — which owns the centred-card/bottom-sheet
 * shell, backdrop, Esc-to-close, focus management and body portal, so this
 * component carries only the shortcut content. Mounted conditionally by the
 * caller, so it is always "open" while rendered; `onClose` is the trigger's
 * close callback, unchanged.
 */
export function ShortcutsHelp({ onClose }: Props) {
  return (
    <Modal isOpen onClose={onClose} title="Keyboard shortcuts" maxW="sm:max-w-lg">
      <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
        {SHORTCUT_GROUPS.map((group) => (
          <section key={group.title}>
            <div className="eyebrow mb-2">{group.title}</div>
            <ul className="flex flex-col gap-1.5">
              {group.items.map((item) => (
                <li
                  key={item.label}
                  className="flex items-start justify-between gap-3"
                >
                  <span className="min-w-0 flex-1 text-slate-700">
                    {item.label}
                  </span>
                  <span className="flex flex-none flex-wrap items-center justify-end gap-1">
                    {item.keys.map((key, index) => (
                      <React.Fragment key={key}>
                        {index > 0 ? (
                          <span className="text-2xs text-slate-400">+</span>
                        ) : null}
                        <KeyCap>{key}</KeyCap>
                      </React.Fragment>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  )
}

export default ShortcutsHelp
