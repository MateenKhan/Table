import React from 'react'
import { Download, Pencil, SquarePen, Trash2, Check, X } from 'lucide-react'
import {
  GlobalSearchValue,
  querySummary,
  isGlobalSearchEmpty,
} from '../globalSearch'
import { savedQueries, useSavedQueriesVersion, SavedQuery } from '../savedQueries'
import { Modal, useConfirm, useToast } from '../piranha'
import { Tooltip } from '../piranha/Tooltip'

// ─────────────────────────────────────────────────────────────────────────────
// SavedQueriesDialog — CRUD for browser-stored queries, inside the shared
// piranha Modal. Two regions: "Save current query" (name + Save, with an
// overwrite confirm), and a searchable, column-SORTABLE mini-table for finding,
// loading, renaming and deleting saved queries. The Query column is rendered
// with the very same `querySummary` the builder uses, so a saved query reads
// exactly the way it does live.
//
// Self-contained + props-driven: the parent owns the trigger buttons and the
// builder value. Store mutations flow through the `savedQueries` singleton;
// `useSavedQueriesVersion` keeps this list in sync with them.
// ─────────────────────────────────────────────────────────────────────────────

export type SavedQueriesDialogProps = {
  open: boolean
  onClose: () => void
  /** The query currently in the builder — the subject of "Save current query". */
  currentValue: GlobalSearchValue
  /** Apply a saved query back into the builder. */
  onLoad: (value: GlobalSearchValue) => void
}

type SortKey = 'name' | 'query' | 'updated'
type SortDir = 'asc' | 'desc'

/** Short, human "time since" — "just now", "5m ago", "3h ago", "2d ago", or a
 *  compact date once it is older than a week. */
function relativeTime(ts: number): string {
  const diff = Date.now() - ts
  if (!Number.isFinite(diff)) return ''
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d ago`
  return new Date(ts).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

const summaryText = (value: GlobalSearchValue): string => querySummary(value)

export function SavedQueriesDialog({
  open,
  onClose,
  currentValue,
  onLoad,
}: SavedQueriesDialogProps) {
  const confirm = useConfirm()
  const toast = useToast()
  const version = useSavedQueriesVersion()

  const [name, setName] = React.useState('')
  const [search, setSearch] = React.useState('')
  const [sort, setSort] = React.useState<{ key: SortKey; dir: SortDir }>({
    key: 'updated',
    dir: 'desc',
  })

  // Inline rename state: the id being renamed, plus its working name.
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [editName, setEditName] = React.useState('')

  // Recompute the stored list whenever the store version changes.
  const all = React.useMemo(() => savedQueries.list(), [version])

  // Reset transient UI each time the dialog opens, so a stale inline-edit or
  // half-typed name never lingers into the next session.
  React.useEffect(() => {
    if (!open) return
    setName('')
    setSearch('')
    setEditingId(null)
    setEditName('')
  }, [open])

  const canSave = !isGlobalSearchEmpty(currentValue) && name.trim().length > 0

  const saveCurrent = async () => {
    const trimmed = name.trim()
    if (!trimmed || isGlobalSearchEmpty(currentValue)) return

    const existing = all.find(
      (q) => q.name.trim().toLowerCase() === trimmed.toLowerCase(),
    )
    if (existing) {
      const ok = await confirm({
        title: 'Overwrite saved query?',
        message: `A saved query named "${existing.name}" already exists. Replace its query with the one currently in the builder?`,
        confirmLabel: 'Overwrite',
        tone: 'default',
      })
      if (!ok) return
      savedQueries.replace(existing.id, currentValue)
      toast.success('Saved query updated', existing.name)
    } else {
      savedQueries.save(trimmed, currentValue)
      toast.success('Query saved', trimmed)
    }
    setName('')
  }

  const load = (sq: SavedQuery) => {
    onLoad(sq.value)
    onClose()
  }

  const startRename = (sq: SavedQuery) => {
    setEditingId(sq.id)
    setEditName(sq.name)
  }

  const commitRename = () => {
    if (!editingId) return
    const trimmed = editName.trim()
    if (trimmed) {
      savedQueries.rename(editingId, trimmed)
      toast.success('Renamed', trimmed)
    }
    setEditingId(null)
    setEditName('')
  }

  const cancelRename = () => {
    setEditingId(null)
    setEditName('')
  }

  const remove = async (sq: SavedQuery) => {
    const ok = await confirm({
      title: 'Delete saved query?',
      message: `"${sq.name}" will be removed from this browser. This cannot be undone.`,
      confirmLabel: 'Delete',
      tone: 'danger',
    })
    if (!ok) return
    savedQueries.remove(sq.id)
    toast.success('Saved query deleted', sq.name)
  }

  // Filter by name OR by the query's text, then sort by the active column.
  const rows = React.useMemo(() => {
    const needle = search.trim().toLowerCase()
    const filtered = needle
      ? all.filter(
          (q) =>
            q.name.toLowerCase().includes(needle) ||
            summaryText(q.value).toLowerCase().includes(needle),
        )
      : all

    const dir = sort.dir === 'asc' ? 1 : -1
    const compare = (a: SavedQuery, b: SavedQuery): number => {
      switch (sort.key) {
        case 'name':
          return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
        case 'query':
          return summaryText(a.value).localeCompare(
            summaryText(b.value),
            undefined,
            { sensitivity: 'base' },
          )
        case 'updated':
        default:
          return a.updatedAt - b.updatedAt
      }
    }
    // Copy before sorting so we never mutate the memoised `all`.
    return [...filtered].sort((a, b) => compare(a, b) * dir)
  }, [all, search, sort])

  const toggleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'updated' ? 'desc' : 'asc' },
    )
  }

  const th = (key: SortKey, label: string, extra = '') => {
    const active = sort.key === key
    return (
      <th
        className={`sticky top-0 z-10 bg-white border-b border-slate-200 p-0 text-left font-semibold ${extra}`}
      >
        <button
          type="button"
          onClick={() => toggleSort(key)}
          className="flex w-full items-center gap-1 px-3 py-2 text-slate-700 sm:hover:bg-slate-50 transition-colors"
          aria-label={`Sort by ${label}`}
        >
          <span>{label}</span>
          <span
            className={`text-2xs leading-none ${active ? 'text-accent-600' : 'text-transparent'}`}
            aria-hidden="true"
          >
            {active ? (sort.dir === 'asc' ? '▲' : '▼') : '▲'}
          </span>
        </button>
      </th>
    )
  }

  const cell = 'px-3 py-2 align-middle border-b border-slate-100'

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title="Saved queries"
      subtitle="Store the current query in this browser and recall it later."
      maxW="sm:max-w-2xl"
    >
      <div className="flex flex-col gap-5">
        {/* ── Region 1: Save current query ─────────────────────────────── */}
        <section className="flex flex-col gap-2">
          <div className="eyebrow">Save current query</div>
          <div className="flex items-center gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSave) saveCurrent()
              }}
              placeholder="Name this query…"
              className="input-sm flex-1"
              aria-label="Name for the current query"
            />
            <button
              type="button"
              className="btn-primary-sm shrink-0"
              onClick={saveCurrent}
              disabled={!canSave}
            >
              Save
            </button>
          </div>
          {isGlobalSearchEmpty(currentValue) ? (
            <p className="text-xs text-slate-500">
              Build a query first — there is nothing to save yet.
            </p>
          ) : (
            <p className="text-xs text-slate-500 truncate" title={summaryText(currentValue)}>
              {summaryText(currentValue)}
            </p>
          )}
        </section>

        {/* ── Region 2: Find / load saved queries ──────────────────────── */}
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <div className="eyebrow">Saved ({all.length})</div>
          </div>

          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or query…"
            className="input-sm"
            aria-label="Search saved queries"
          />

          <div className="max-h-[50vh] overflow-auto custom-scrollbar rounded-lg border border-slate-200 bg-white">
            {all.length === 0 ? (
              <div className="px-3 py-10 text-center text-sm text-slate-500">
                No saved queries yet.
              </div>
            ) : rows.length === 0 ? (
              <div className="px-3 py-10 text-center text-sm text-slate-500">
                No matches
              </div>
            ) : (
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    {th('name', 'Name')}
                    {th('query', 'Query')}
                    {th('updated', 'Updated')}
                    <th className="sticky top-0 z-10 bg-white border-b border-slate-200 px-3 py-2 text-right font-semibold text-slate-700">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((sq) => {
                    const summary = summaryText(sq.value)
                    const editing = editingId === sq.id
                    return (
                      <tr key={sq.id} className="sm:hover:bg-slate-50 transition-colors">
                        {/* Name (inline-editable) */}
                        <td className={`${cell} font-medium text-slate-900`}>
                          {editing ? (
                            <div className="flex items-center gap-1">
                              <input
                                autoFocus
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') commitRename()
                                  if (e.key === 'Escape') cancelRename()
                                }}
                                className="input-sm flex-1"
                                aria-label="New name"
                              />
                              <Tooltip label="Save name">
                                <button
                                  type="button"
                                  className="icon-btn-sm"
                                  onClick={commitRename}
                                  aria-label="Save name"
                                >
                                  <Check size={15} />
                                </button>
                              </Tooltip>
                              <Tooltip label="Cancel">
                                <button
                                  type="button"
                                  className="icon-btn-sm"
                                  onClick={cancelRename}
                                  aria-label="Cancel rename"
                                >
                                  <X size={15} />
                                </button>
                              </Tooltip>
                            </div>
                          ) : (
                            <span className="block max-w-[12rem] truncate" title={sq.name}>
                              {sq.name}
                            </span>
                          )}
                        </td>

                        {/* Query — the same summary the builder shows */}
                        <td className={`${cell} text-slate-600`}>
                          {summary ? (
                            <span className="block max-w-[22rem] truncate" title={summary}>
                              {summary}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>

                        {/* Updated */}
                        <td className={`${cell} whitespace-nowrap text-slate-500`}>
                          <span title={new Date(sq.updatedAt).toLocaleString()}>
                            {relativeTime(sq.updatedAt)}
                          </span>
                        </td>

                        {/* Actions */}
                        <td className={`${cell} whitespace-nowrap`}>
                          <div className="flex items-center justify-end gap-1">
                            <Tooltip label="Load into builder">
                              <button
                                type="button"
                                className="btn-ghost-sm"
                                onClick={() => load(sq)}
                              >
                                <Download size={14} />
                                Load
                              </button>
                            </Tooltip>
                            <Tooltip label="Rename">
                              <button
                                type="button"
                                className="icon-btn-sm"
                                onClick={() => startRename(sq)}
                                aria-label={`Rename ${sq.name}`}
                              >
                                <Pencil size={15} />
                              </button>
                            </Tooltip>
                            <Tooltip label="Edit query — loads it into the builder to edit, then re-save">
                              <button
                                type="button"
                                className="icon-btn-sm"
                                onClick={() => load(sq)}
                                aria-label={`Edit query for ${sq.name}`}
                              >
                                <SquarePen size={15} />
                              </button>
                            </Tooltip>
                            <Tooltip label="Delete">
                              <button
                                type="button"
                                className="icon-btn-sm icon-btn-danger"
                                onClick={() => remove(sq)}
                                aria-label={`Delete ${sq.name}`}
                              >
                                <Trash2 size={15} />
                              </button>
                            </Tooltip>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </Modal>
  )
}

export default SavedQueriesDialog
