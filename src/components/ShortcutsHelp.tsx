import React from 'react'
import { rankItem } from '@tanstack/match-sorter-utils'
import { Keyboard, Search, X } from 'lucide-react'
import { Modal } from '../ui'

// One source of truth for the grid's keyboard shortcuts. The handlers in
// `useCellSelection` implement these; this registry is what the help popup
// renders, so the documentation and the behaviour stay described in one place.
// Grouped as: Navigation / Editing / Selection / Clipboard / Other.

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
      { keys: ['Shift', 'Click'], label: 'Extend a contiguous range (cell, row or column)' },
      { keys: ['Ctrl', 'Click'], label: 'Add a separate cell / row / column (multi-select)' },
      { keys: ['Ctrl', 'Space'], label: 'Add the active cell to the selection' },
      { keys: ['Shift', 'Space'], label: 'Extend the selection to the active cell' },
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

const TOTAL_SHORTCUTS = SHORTCUT_GROUPS.reduce(
  (n, group) => n + group.items.length,
  0,
)

// The flat list a fuzzy search ranks over — each shortcut tagged with its group
// so results can show where it lives.
type FlatShortcut = Shortcut & { group: string }
const FLAT_SHORTCUTS: FlatShortcut[] = SHORTCUT_GROUPS.flatMap((group) =>
  group.items.map((item) => ({ ...item, group: group.title })),
)

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

// The key caps for one shortcut, joined with a faint "+".
function KeyCombo({ keys }: { keys: string[] }) {
  return (
    <span className="flex flex-none flex-wrap items-center justify-end gap-1">
      {keys.map((key, index) => (
        <React.Fragment key={key}>
          {index > 0 ? (
            <span className="text-2xs text-slate-400">+</span>
          ) : null}
          <KeyCap>{key}</KeyCap>
        </React.Fragment>
      ))}
    </span>
  )
}

// One shortcut row: label on the left, key caps on the right. `group` renders a
// small tag, shown only in search results where items are no longer grouped.
function ShortcutRow({
  item,
  group,
}: {
  item: Shortcut
  group?: string
}) {
  return (
    <li className="flex items-center justify-between gap-3 py-1.5">
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-slate-700">{item.label}</span>
        {group ? (
          <span className="flex-none rounded bg-slate-100 px-1.5 py-0.5 text-2xs font-medium uppercase tracking-wide text-slate-400">
            {group}
          </span>
        ) : null}
      </span>
      <KeyCombo keys={item.keys} />
    </li>
  )
}

/**
 * The `?` help popup: every grid shortcut, fuzzy-searchable and grouped, inside
 * the shared UI's <Modal> (which owns the card/sheet shell, backdrop,
 * Esc-to-close and focus management). Leads with a note that the whole table is
 * keyboard-driven, then a search box, then either ranked matches or the grouped
 * reference.
 */
export function ShortcutsHelp({ onClose }: Props) {
  const [query, setQuery] = React.useState('')
  const trimmed = query.trim()

  // Fuzzy match over label + keys + group so "select all", "ctrl a" or a
  // partial like "clpbrd" all find their way home. A multi-word query matches
  // only when EVERY word fuzzy-hits (so "copy selection" narrows), ranked by the
  // combined score.
  const results = React.useMemo(() => {
    if (!trimmed) return null
    const words = trimmed.split(/\s+/)
    return FLAT_SHORTCUTS.map((shortcut) => {
      const haystack = `${shortcut.label} ${shortcut.keys.join(' ')} ${shortcut.group}`
      const rankings = words.map((word) => rankItem(haystack, word))
      return {
        shortcut,
        passed: rankings.every((r) => r.passed),
        rank: rankings.reduce((sum, r) => sum + r.rank, 0),
      }
    })
      .filter((entry) => entry.passed)
      .sort((a, b) => b.rank - a.rank)
      .map((entry) => entry.shortcut)
  }, [trimmed])

  return (
    <Modal isOpen onClose={onClose} title="Keyboard shortcuts" maxW="sm:max-w-2xl">
      <div className="flex flex-col gap-4">
        {/* Keyboard-first banner: sets the expectation that everything here can
            be driven without a mouse. */}
        <div className="flex items-start gap-3 rounded-lg border border-accent-100 bg-accent-50/60 px-3 py-2.5">
          <span className="mt-0.5 flex-none rounded-md bg-white p-1.5 text-accent-600 shadow-sm">
            <Keyboard className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-800">
              Fully keyboard-driven
            </div>
            <p className="text-2xs leading-relaxed text-slate-500">
              Every action has a shortcut — navigate, edit, multi-select, copy
              and undo without ever leaving the keyboard. {TOTAL_SHORTCUTS}{' '}
              shortcuts in all.
            </p>
          </div>
        </div>

        {/* Fuzzy search. Autofocused so the popup is usable by typing straight
            away; the grid's key handler ignores INPUT focus, so this never
            drives the cells behind it. */}
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden
          />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search shortcuts…"
            aria-label="Search shortcuts"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-9 text-sm text-slate-700 placeholder:text-slate-400 focus:border-accent-400 focus:outline-none focus:ring-2 focus:ring-accent-100"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        {results ? (
          // Search results: a single ranked list, each tagged with its group.
          results.length ? (
            <ul className="flex flex-col divide-y divide-slate-100">
              {results.map((item) => (
                <ShortcutRow key={item.label} item={item} group={item.group} />
              ))}
            </ul>
          ) : (
            <div className="py-8 text-center text-sm text-slate-400">
              No shortcuts match “{trimmed}”.
            </div>
          )
        ) : (
          // Default reference: grouped, two columns on wider screens.
          <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
            {SHORTCUT_GROUPS.map((group) => (
              <section key={group.title}>
                <div className="eyebrow mb-1.5">{group.title}</div>
                <ul className="flex flex-col divide-y divide-slate-100">
                  {group.items.map((item) => (
                    <ShortcutRow key={item.label} item={item} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </Modal>
  )
}

export default ShortcutsHelp
