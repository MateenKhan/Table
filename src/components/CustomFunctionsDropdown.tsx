import React from 'react'
// Imported from ./formula (not ./customFunctions) so the body validator is
// guaranteed to be installed before anything is defined.
import { customFunctions, FunctionDefinition } from '../formula'

const STORAGE_KEY = 'tableCustomFunctions'

// Definitions are plain JSON, so they survive a reload.
export function loadStoredFunctions() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const result = customFunctions.replaceAll(JSON.parse(raw))
    if (!result.ok) window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // A corrupt entry should never stop the app from booting.
    window.localStorage.removeItem(STORAGE_KEY)
  }
}

function persist() {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(customFunctions.list()),
    )
  } catch {
    // Storage full or blocked - definitions still work for this session.
  }
}

const emptyDraft = { name: '', params: '', body: '' }

export function CustomFunctionsDropdown() {
  const [isOpen, setIsOpen] = React.useState(false)
  const [draft, setDraft] = React.useState(emptyDraft)
  // Set while editing an existing definition, so saving overwrites it.
  const [editingName, setEditingName] = React.useState<string | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const containerRef = React.useRef<HTMLDivElement>(null)

  const version = React.useSyncExternalStore(
    React.useCallback(
      (listener: () => void) => customFunctions.subscribe(listener),
      [],
    ),
    () => customFunctions.version,
  )

  const definitions = React.useMemo(() => customFunctions.list(), [version])

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

  const toDefinition = (): FunctionDefinition => ({
    name: draft.name.trim(),
    params: draft.params
      .split(',')
      .map((param) => param.trim())
      .filter(Boolean),
    body: draft.body.trim(),
  })

  // Live feedback while typing, without storing anything.
  const preview = React.useMemo(() => {
    if (!draft.name.trim() || !draft.body.trim()) return null
    return customFunctions.validate(toDefinition(), { overwrite: true })
  }, [draft, version])

  // Adding a name that already exists would otherwise replace it silently.
  const willReplace = React.useMemo(() => {
    const name = draft.name.trim()
    if (!name || editingName !== null) return false
    return customFunctions.has(name)
  }, [draft.name, editingName, version])

  const reset = () => {
    setDraft(emptyDraft)
    setEditingName(null)
    setError(null)
  }

  const save = () => {
    const definition = toDefinition()
    const result = customFunctions.define(definition, {
      // Editing an existing one, or replacing a same-named definition.
      overwrite: editingName !== null || customFunctions.has(definition.name),
    })

    if (!result.ok) {
      setError(result.error)
      return
    }

    // A rename leaves the old definition behind, so drop it explicitly.
    if (editingName && editingName.toUpperCase() !== definition.name.toUpperCase()) {
      customFunctions.remove(editingName)
    }

    persist()
    reset()
  }

  const edit = (definition: FunctionDefinition) => {
    setDraft({
      name: definition.name,
      params: definition.params.join(', '),
      body: definition.body,
    })
    setEditingName(definition.name)
    setError(null)
  }

  const remove = (name: string) => {
    customFunctions.remove(name)
    persist()
    if (editingName === name) reset()
  }

  return (
    <div className="relative inline-block" ref={containerRef}>
      <button
        type="button"
        className="icon-btn-sm relative"
        onClick={() => setIsOpen((open) => !open)}
        title="Custom formula functions"
        aria-label="Custom formula functions"
      >
        <span className="text-sm italic">ƒx</span>
        {definitions.length > 0 && (
          <span className="absolute -right-0.5 -top-0.5 rounded-full bg-accent-500 px-1 text-[9px] font-bold leading-tight text-white">
            {definitions.length}
          </span>
        )}
      </button>

      {isOpen ? (
        <div
          className="border border-slate-200 rounded-lg shadow-lg bg-white text-slate-700"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            zIndex: 30,
            width: '26rem',
            maxHeight: '28rem',
            overflowY: 'auto',
          }}
        >
          <div className="px-2 py-1 border-b border-slate-200 text-sm font-bold text-slate-900">
            {editingName ? `Edit ${editingName}` : 'New function'}
          </div>

          <div className="p-2 flex flex-col gap-2 border-b border-slate-200">
            <label className="flex items-center gap-2 text-sm">
              <span style={{ width: '5rem' }}>Name</span>
              <input
                value={draft.name}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, name: e.target.value }))
                }
                placeholder="SQFT"
                className="input-sm flex-1"
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <span style={{ width: '5rem' }}>Params</span>
              <input
                value={draft.params}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, params: e.target.value }))
                }
                placeholder="w, h"
                className="input-sm flex-1"
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <span style={{ width: '5rem' }}>Body</span>
              <input
                value={draft.body}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, body: e.target.value }))
                }
                placeholder="w * h / 144"
                className="input-sm flex-1"
              />
            </label>

            {error ? (
              <div className="text-sm text-rose-700">
                {error}
              </div>
            ) : preview && !preview.ok ? (
              <div className="text-sm text-rose-700">
                {preview.error}
              </div>
            ) : preview && preview.ok && willReplace ? (
              <div className="text-sm text-amber-700">
                {draft.name.trim().toUpperCase()} already exists — saving will
                replace it.
              </div>
            ) : preview && preview.ok ? (
              <div className="text-sm text-emerald-700">
                Call it as ={draft.name.trim().toUpperCase()}(
                {toDefinition().params.join(', ')})
              </div>
            ) : (
              <div className="text-sm text-slate-500">
                Body may use params, columns (age), A1 refs and SUM/AVG/MIN/MAX.
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                className="btn-primary-sm"
                onClick={save}
                disabled={!preview || !preview.ok}
              >
                {editingName ? 'Save' : 'Add'}
              </button>
              {editingName || draft.name || draft.body ? (
                <button className="btn-ghost-sm" onClick={reset}>
                  Cancel
                </button>
              ) : null}
            </div>
          </div>

          <div className="px-2 py-1 border-b border-slate-200 text-sm font-bold text-slate-900">
            Defined ({definitions.length})
          </div>
          {definitions.length === 0 ? (
            <div className="px-2 py-1 text-sm text-slate-500">
              None yet. Add one above.
            </div>
          ) : (
            definitions.map((definition) => (
              <div
                key={definition.name}
                className="px-2 py-1 flex items-center gap-2 text-sm border-b border-slate-100"
              >
                <span className="flex-1">
                  <strong className="text-slate-900">{definition.name}</strong>(
                  {definition.params.join(', ')}) = {definition.body}
                </span>
                <button
                  className="btn-ghost-sm"
                  onClick={() => edit(definition)}
                >
                  Edit
                </button>
                <button
                  className="icon-btn-sm icon-btn-danger"
                  onClick={() => remove(definition.name)}
                  title="Delete"
                  aria-label={`Delete ${definition.name}`}
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  )
}

export default CustomFunctionsDropdown
