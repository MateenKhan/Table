import { RowData, Table } from '@tanstack/react-table'
import React from 'react'
import {
  ColumnMerge,
  isSpannableSelection,
  MergeCandidate,
  mergeCandidates,
  MergeSeparator,
  mergeIdFor,
  SEPARATORS,
  withMerge,
  withoutMerge,
} from '../columnMerge'
import { SKIP_COLUMNS } from '../tableModels'

type Mode = ColumnMerge['mode']

const MODES: { id: Mode; label: string; hint: string }[] = [
  {
    id: 'combine',
    label: 'Combine values',
    hint: 'Fold the chosen columns into one derived, read-only column.',
  },
  {
    id: 'group',
    label: 'Span a header',
    hint: 'Give neighbouring columns under the same header a shared parent header. Data stays separate.',
  },
]

type Props<T extends RowData> = {
  table: Table<T>
  merges: ColumnMerge[]
  onChange: React.Dispatch<React.SetStateAction<ColumnMerge[]>>
}

// Sits next to the Columns dropdown and shares its look: a bordered button that
// opens an absolutely positioned panel.
export function ColumnMergeDropdown<T extends RowData>({
  table,
  merges,
  onChange,
}: Props<T>) {
  const [isOpen, setIsOpen] = React.useState(false)
  const [mode, setMode] = React.useState<Mode>('combine')
  const [selected, setSelected] = React.useState<string[]>([])
  const [name, setName] = React.useState('')
  const [separator, setSeparator] = React.useState<MergeSeparator>('space')
  const containerRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!isOpen) return

    const onPointerDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setIsOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [isOpen])

  // Read straight off the table, so the picker always describes the tree as it
  // currently stands rather than the original definitions.
  const candidates = mergeCandidates(table, SKIP_COLUMNS)
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]))
  const chosen = selected
    .map((id) => byId.get(id))
    .filter((candidate): candidate is MergeCandidate => !!candidate)

  // Group the checkboxes the way the header tree does, so "same parent" - the
  // rule mode B enforces - is visible before anything is clicked.
  const sections: { key: string; label: string; items: MergeCandidate[] }[] = []
  for (const candidate of candidates) {
    const last = sections[sections.length - 1]
    if (last && last.key === candidate.parentId) {
      last.items.push(candidate)
      continue
    }
    sections.push({
      key: candidate.parentId,
      label: candidate.parentLabel || 'Top level',
      items: [candidate],
    })
  }

  const isSelected = (id: string) => selected.includes(id)

  // Mode B narrows the choice as you go: anything that could not sit under one
  // spanning header alongside what is already ticked is disabled outright.
  const isDisabled = (candidate: MergeCandidate) => {
    if (mode !== 'group') return false
    if (isSelected(candidate.id)) return false
    if (!chosen.length) return false
    return !isSpannableSelection([...chosen, candidate])
  }

  const toggle = (id: string) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((entry) => entry !== id) : [...prev, id],
    )

  const reset = () => {
    setSelected([])
    setName('')
  }

  const switchMode = (next: Mode) => {
    setMode(next)
    reset()
  }

  const defaultName = chosen
    .map((candidate) => candidate.label)
    .join(mode === 'combine' ? ' + ' : ' / ')

  const problem = (() => {
    if (selected.length < 2) return 'Pick at least two columns.'
    if (mode === 'group' && !isSpannableSelection(chosen))
      return 'A spanning header needs neighbouring columns under the same parent.'
    return null
  })()

  const submit = () => {
    if (problem) return
    const header = name.trim() || defaultName
    const id = mergeIdFor(mode, selected)
    const next: ColumnMerge =
      mode === 'combine'
        ? { id, mode: 'combine', header, columnIds: selected, separator }
        : { id, mode: 'group', header, columnIds: selected }

    onChange((prev) => withMerge(prev, next))
    reset()
  }

  const remove = (id: string) => onChange((prev) => withoutMerge(prev, id))

  const modeHint = MODES.find((entry) => entry.id === mode)!.hint

  return (
    <div className="relative inline-block" ref={containerRef}>
      <button
        type="button"
        className="btn-ghost-sm"
        onClick={() => setIsOpen((open) => !open)}
      >
        <span>Merge</span>
        <span className="text-slate-500">{merges.length}</span>
        <span>{isOpen ? '▲' : '▼'}</span>
      </button>

      {isOpen ? (
        <div
          className="border border-slate-200 rounded-lg shadow-lg bg-white text-slate-700"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            zIndex: 20,
            width: '22rem',
          }}
        >
          <div className="p-2 border-b border-slate-200 flex flex-col gap-1">
            <div className="flex gap-2">
              {MODES.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => switchMode(entry.id)}
                  aria-pressed={mode === entry.id}
                  className={`flex-1 min-h-control px-2 rounded-lg text-sm border transition-colors ${
                    mode === entry.id
                      ? 'bg-accent-500 text-white border-transparent font-bold'
                      : 'bg-white text-slate-700 border-slate-200 sm:hover:bg-slate-50'
                  }`}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <span className="text-sm text-slate-500">{modeHint}</span>
          </div>

          <div style={{ maxHeight: '14rem', overflowY: 'auto' }}>
            {sections.map((section) => (
              <div key={section.key || 'root'}>
                <div className="px-2 py-1 text-sm font-bold text-slate-500 border-b border-slate-200">
                  {section.label}
                </div>
                {section.items.map((candidate) => {
                  const disabled = isDisabled(candidate)

                  return (
                    <label
                      key={candidate.id}
                      className={`px-2 py-1 flex items-center gap-1.5 ${
                        disabled
                          ? 'opacity-40 cursor-not-allowed'
                          : 'cursor-pointer sm:hover:bg-slate-50'
                      }`}
                      title={
                        disabled
                          ? 'Not adjacent to the columns already picked, or under a different header'
                          : candidate.id
                      }
                    >
                      <input
                        type="checkbox"
                        className="accent-accent-500"
                        checked={isSelected(candidate.id)}
                        disabled={disabled}
                        onChange={() => toggle(candidate.id)}
                      />
                      {candidate.label}
                      {candidate.label === candidate.id ? null : (
                        <span className="text-sm text-slate-500">
                          {candidate.id}
                        </span>
                      )}
                    </label>
                  )
                })}
              </div>
            ))}
          </div>

          <div className="p-2 border-t border-slate-200 flex flex-col gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={defaultName || 'Merged column name'}
              className="input-sm"
              aria-label="Merged header name"
            />

            {mode === 'combine' ? (
              <label className="flex items-center gap-2 text-sm">
                Separator
                <select
                  className="select-sm w-auto"
                  value={separator}
                  onChange={(e) =>
                    setSeparator(e.target.value as MergeSeparator)
                  }
                >
                  {SEPARATORS.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {problem ? (
              <span className="text-sm text-slate-500">{problem}</span>
            ) : null}

            <div className="flex items-center gap-2">
              <button
                type="button"
                className="btn-primary-sm"
                onClick={submit}
                disabled={!!problem}
              >
                Merge {selected.length ? `${selected.length} columns` : ''}
              </button>
              {selected.length ? (
                <button
                  type="button"
                  className="btn-ghost-sm"
                  onClick={reset}
                >
                  Clear
                </button>
              ) : null}
            </div>
          </div>

          <div className="p-2 border-t border-slate-200">
            <div className="text-sm font-bold text-slate-900">Active merges</div>
            {merges.length === 0 ? (
              <div className="text-sm text-slate-500">None yet</div>
            ) : (
              merges.map((merge) => (
                <div
                  key={merge.id}
                  className="flex items-center gap-2 py-1 text-sm"
                >
                  <span className="text-slate-500">
                    {merge.mode === 'combine' ? 'Combine' : 'Span'}
                  </span>
                  <span className="flex-1" style={{ minWidth: 0 }}>
                    <strong className="text-slate-900">{merge.header}</strong>{' '}
                    <span className="text-slate-500">
                      ({merge.columnIds.join(', ')})
                    </span>
                  </span>
                  <button
                    type="button"
                    className="icon-btn-sm icon-btn-danger"
                    onClick={() => remove(merge.id)}
                    title="Unmerge"
                    aria-label={`Unmerge ${merge.header}`}
                  >
                    ×
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default ColumnMergeDropdown
