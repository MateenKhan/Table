import React from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Plus, Search, X } from 'lucide-react'
import {
  columnTypeRegistry,
  listColumnTypePresets,
  useColumnTypeRegistryVersion,
  type ColumnTypePreset,
} from '../columnTypeRegistry'

// A searchable type dropdown for a single column. The trigger shows the current
// type's label; opening it reveals a filterable, grouped listbox of every
// registry preset (Basic / Units / Custom). Selecting one calls `onSelect` with
// its durable preset id — the caller records that against the column.
//
// Custom units are created inline (a "+ Custom unit…" row that reveals a
// label + symbol form) and deleted inline (a × on each custom row); both go
// straight through `columnTypeRegistry`, and `useColumnTypeRegistryVersion`
// re-renders the list as they land.

type Props = {
  // The preset id currently chosen for the column, if any (drives the check).
  value?: string
  // Human label shown on the trigger, e.g. "Currency (USD)" or "Text".
  typeLabel: string
  onSelect: (presetId: string) => void
}

// Preserve the registry's own order but collect presets under their group so we
// can print a header before each run.
function groupPresets(
  presets: ColumnTypePreset[],
): { group: string; items: ColumnTypePreset[] }[] {
  const order: string[] = []
  const byGroup = new Map<string, ColumnTypePreset[]>()
  for (const preset of presets) {
    if (!byGroup.has(preset.group)) {
      byGroup.set(preset.group, [])
      order.push(preset.group)
    }
    byGroup.get(preset.group)!.push(preset)
  }
  return order.map((group) => ({ group, items: byGroup.get(group)! }))
}

export function ColumnTypePicker({ value, typeLabel, onSelect }: Props) {
  // Re-render whenever a custom unit is added / removed.
  useColumnTypeRegistryVersion()

  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const [activeIndex, setActiveIndex] = React.useState(0)
  // The inline "new custom unit" form, revealed from the bottom row.
  const [addingCustom, setAddingCustom] = React.useState(false)
  const [customLabel, setCustomLabel] = React.useState('')
  const [customSymbol, setCustomSymbol] = React.useState('')

  const rootRef = React.useRef<HTMLDivElement>(null)
  const searchRef = React.useRef<HTMLInputElement>(null)
  // The listbox is portaled to <body> so the ops strip's overflow-x-auto can't
  // clip it and its stacking is correct (z-[100]); position is measured off the
  // trigger and clamped to the viewport.
  const dropdownRef = React.useRef<HTMLDivElement>(null)
  const [pos, setPos] = React.useState<{
    left: number
    top: number
    width: number
  } | null>(null)

  const reposition = React.useCallback(() => {
    const t = rootRef.current?.getBoundingClientRect()
    if (!t) return
    const margin = 8
    const width = Math.max(t.width, 224)
    let left = t.left
    if (left + width > window.innerWidth - margin)
      left = window.innerWidth - margin - width
    if (left < margin) left = margin
    let top = t.bottom + 4
    const h = dropdownRef.current?.offsetHeight ?? 300
    if (top + h > window.innerHeight - margin) {
      const above = t.top - 4 - h
      top = above >= margin ? above : Math.max(margin, window.innerHeight - margin - h)
    }
    setPos({ left, top, width })
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

  const presets = listColumnTypePresets()

  // The flat, filtered list drives both the rendered rows and ↑/↓ navigation, so
  // the two never drift out of step.
  const filtered = React.useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return presets
    return presets.filter((p) => p.label.toLowerCase().includes(needle))
  }, [presets, query])

  const groups = React.useMemo(() => groupPresets(filtered), [filtered])

  // Keep the active option in range as the filter narrows.
  React.useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(0, filtered.length - 1)))
  }, [filtered.length])

  // Focus the search box when the popover opens; reset transient UI when it shuts.
  React.useEffect(() => {
    if (open) {
      searchRef.current?.focus()
    } else {
      setQuery('')
      setActiveIndex(0)
      setAddingCustom(false)
      setCustomLabel('')
      setCustomSymbol('')
    }
  }, [open])

  // Outside pointer-down closes the popover (the trigger toggles it separately).
  React.useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (rootRef.current?.contains(target)) return
      if (dropdownRef.current?.contains(target)) return
      setOpen(false)
    }
    window.addEventListener('mousedown', onDown, true)
    return () => window.removeEventListener('mousedown', onDown, true)
  }, [open])

  const choose = (presetId: string) => {
    onSelect(presetId)
    setOpen(false)
  }

  const commitCustom = () => {
    const created = columnTypeRegistry.addCustomUnit(customLabel, customSymbol)
    if (!created) return
    setCustomLabel('')
    setCustomSymbol('')
    setAddingCustom(false)
    choose(created.id)
  }

  const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => Math.min(index + 1, filtered.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const target = filtered[activeIndex]
      if (target) choose(target.id)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
    }
  }

  return (
    <div ref={rootRef} className="relative">
      {/* Trigger: shows the current type's label. */}
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-left text-sm text-slate-700 transition-colors sm:hover:bg-slate-50"
      >
        <span className="truncate">{typeLabel}</span>
        <ChevronDown size={14} className="flex-none text-slate-400" />
      </button>

      {open
        ? createPortal(
        <div
          ref={dropdownRef}
          role="listbox"
          aria-label="Column type"
          data-popover-portal=""
          className="fixed z-[100] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg"
          style={{
            left: pos?.left ?? -9999,
            top: pos?.top ?? -9999,
            width: pos?.width ?? 224,
            visibility: pos ? 'visible' : 'hidden',
          }}
        >
          {/* Search */}
          <div className="flex items-center gap-1.5 border-b border-slate-200 px-2 py-1.5">
            <Search size={13} className="flex-none text-slate-400" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKeyDown}
              placeholder="Search types…"
              className="w-full bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
            />
          </div>

          {/* Options */}
          <div className="max-h-60 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="px-2 py-2 text-2xs text-slate-400">
                No matching types
              </div>
            ) : (
              groups.map(({ group, items }) => (
                <div key={group}>
                  <div className="px-2 pb-0.5 pt-1.5 text-2xs font-semibold uppercase tracking-wide text-slate-400">
                    {group}
                  </div>
                  {items.map((preset) => {
                    const flatIndex = filtered.indexOf(preset)
                    const isActive = flatIndex === activeIndex
                    const isSelected = preset.id === value
                    return (
                      <div
                        key={preset.id}
                        className="flex items-center px-1"
                      >
                        <button
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          onMouseEnter={() => setActiveIndex(flatIndex)}
                          onClick={() => choose(preset.id)}
                          className={`flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                            isActive ? 'bg-slate-50' : ''
                          } ${
                            isSelected ? 'text-accent-600' : 'text-slate-700'
                          }`}
                        >
                          <span className="flex-1 truncate">
                            {preset.label}
                          </span>
                          {isSelected ? (
                            <Check
                              size={14}
                              className="flex-none text-accent-600"
                            />
                          ) : null}
                        </button>
                        {!preset.builtin ? (
                          <button
                            type="button"
                            aria-label={`Delete ${preset.label}`}
                            title="Delete custom type"
                            onClick={(e) => {
                              e.stopPropagation()
                              columnTypeRegistry.removeCustom(preset.id)
                            }}
                            className="icon-btn-sm flex-none text-slate-400 sm:hover:text-rose-600"
                          >
                            <X size={13} />
                          </button>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              ))
            )}
          </div>

          {/* Custom unit creation */}
          <div className="border-t border-slate-200 p-1">
            {addingCustom ? (
              <div className="space-y-1 p-1">
                <input
                  autoFocus
                  value={customLabel}
                  onChange={(e) => setCustomLabel(e.target.value)}
                  placeholder="Label (e.g. Kelvin)"
                  className="input-sm w-full"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      commitCustom()
                    } else if (e.key === 'Escape') {
                      e.preventDefault()
                      setAddingCustom(false)
                    }
                  }}
                />
                <div className="flex items-center gap-1">
                  <input
                    value={customSymbol}
                    onChange={(e) => setCustomSymbol(e.target.value)}
                    placeholder="Symbol (e.g. K)"
                    className="input-sm w-full"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        commitCustom()
                      } else if (e.key === 'Escape') {
                        e.preventDefault()
                        setAddingCustom(false)
                      }
                    }}
                  />
                  <button
                    type="button"
                    onClick={commitCustom}
                    disabled={!customLabel.trim() || !customSymbol.trim()}
                    className="btn-primary-sm flex-none disabled:pointer-events-none disabled:opacity-40"
                  >
                    Add
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setAddingCustom(true)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-slate-600 transition-colors sm:hover:bg-slate-50"
              >
                <Plus size={14} className="flex-none text-slate-400" />
                <span className="flex-1 truncate">Custom unit…</span>
              </button>
            )}
          </div>
        </div>,
            document.body,
          )
        : null}
    </div>
  )
}

export default ColumnTypePicker
