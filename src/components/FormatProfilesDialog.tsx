import React from 'react'
import { Check, Paintbrush, Pencil, RefreshCw, Trash2, X } from 'lucide-react'
import {
  formatProfiles,
  useFormatProfilesVersion,
  FormatProfile,
} from '../formatProfiles'
import { Modal, useConfirm, useToast } from '../piranha'
import { Tooltip } from '../piranha/Tooltip'

// ─────────────────────────────────────────────────────────────────────────────
// FormatProfilesDialog — CRUD for named bundles of the grid's FORMATTING (never
// its data), inside the shared piranha Modal. Two regions: "Save current format"
// (name + Save, with an overwrite confirm), and a searchable, column-SORTABLE
// mini-table for finding, applying, renaming, re-snapshotting and deleting
// profiles. A profile captures a snapshot of BOTH the `tableFormatting` and
// `columnTypeOverrides` stores; applying one restores the whole look in one go.
//
// Self-contained: both stores are global singletons, so this needs NO data props
// — the parent only owns the trigger. Mutations flow through `formatProfiles`;
// `useFormatProfilesVersion` keeps this list in sync with them.
// ─────────────────────────────────────────────────────────────────────────────

export type FormatProfilesDialogProps = {
  open: boolean
  onClose: () => void
}

type SortKey = 'name' | 'summary' | 'updated'
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

// Counts folded out of a profile's two snapshots — the size of each map.
const formattedCount = (p: FormatProfile): number =>
  Object.keys(p.formatting).length
const typedCount = (p: FormatProfile): number =>
  Object.keys(p.columnTypes).length

/** "N formatted cells · M typed columns", pluralised, for the summary column. */
function summaryText(p: FormatProfile): string {
  const f = formattedCount(p)
  const t = typedCount(p)
  const fPart = `${f} formatted cell${f === 1 ? '' : 's'}`
  const tPart = `${t} typed column${t === 1 ? '' : 's'}`
  return `${fPart} · ${tPart}`
}

export function FormatProfilesDialog({ open, onClose }: FormatProfilesDialogProps) {
  const confirm = useConfirm()
  const toast = useToast()
  const version = useFormatProfilesVersion()

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
  const all = React.useMemo(() => formatProfiles.list(), [version])

  // Reset transient UI each time the dialog opens, so a stale inline-edit or
  // half-typed name never lingers into the next session.
  React.useEffect(() => {
    if (!open) return
    setName('')
    setSearch('')
    setEditingId(null)
    setEditName('')
  }, [open])

  const canSave = name.trim().length > 0

  const saveCurrent = async () => {
    const trimmed = name.trim()
    if (!trimmed) return

    const existing = all.find(
      (p) => p.name.trim().toLowerCase() === trimmed.toLowerCase(),
    )
    if (existing) {
      const ok = await confirm({
        title: 'Overwrite format profile?',
        message: `A profile named "${existing.name}" already exists. Replace its saved format with the grid's current look?`,
        confirmLabel: 'Overwrite',
        tone: 'default',
      })
      if (!ok) return
      formatProfiles.updateCurrent(existing.id)
      toast.success('Format profile updated', existing.name)
    } else {
      formatProfiles.saveCurrent(trimmed)
      toast.success('Format profile saved', trimmed)
    }
    setName('')
  }

  const apply = (p: FormatProfile) => {
    formatProfiles.apply(p.id)
    toast.success('Format applied', p.name)
    onClose()
  }

  const updateCurrent = (p: FormatProfile) => {
    formatProfiles.updateCurrent(p.id)
    toast.success('Profile updated to current format', p.name)
  }

  const startRename = (p: FormatProfile) => {
    setEditingId(p.id)
    setEditName(p.name)
  }

  const commitRename = () => {
    if (!editingId) return
    const trimmed = editName.trim()
    if (trimmed) {
      formatProfiles.rename(editingId, trimmed)
      toast.success('Renamed', trimmed)
    }
    setEditingId(null)
    setEditName('')
  }

  const cancelRename = () => {
    setEditingId(null)
    setEditName('')
  }

  const remove = async (p: FormatProfile) => {
    const ok = await confirm({
      title: 'Delete format profile?',
      message: `"${p.name}" will be removed from this browser. This cannot be undone.`,
      confirmLabel: 'Delete',
      tone: 'danger',
    })
    if (!ok) return
    formatProfiles.remove(p.id)
    toast.success('Format profile deleted', p.name)
  }

  // Filter by name OR by the summary text, then sort by the active column.
  const rows = React.useMemo(() => {
    const needle = search.trim().toLowerCase()
    const filtered = needle
      ? all.filter(
          (p) =>
            p.name.toLowerCase().includes(needle) ||
            summaryText(p).toLowerCase().includes(needle),
        )
      : all

    const dir = sort.dir === 'asc' ? 1 : -1
    const compare = (a: FormatProfile, b: FormatProfile): number => {
      switch (sort.key) {
        case 'name':
          return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
        case 'summary':
          // Sort by the amount of formatting captured (formatted, then typed).
          return (
            formattedCount(a) - formattedCount(b) ||
            typedCount(a) - typedCount(b)
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
      title="Format profiles"
      subtitle="Save the grid's current formatting in this browser and re-apply it later."
      maxW="sm:max-w-2xl"
    >
      <div className="flex flex-col gap-5">
        {/* ── Region 1: Save current format ─────────────────────────────── */}
        <section className="flex flex-col gap-2">
          <div className="eyebrow">Save current format</div>
          <div className="flex items-center gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && canSave) saveCurrent()
              }}
              placeholder="Name this format profile…"
              className="input-sm flex-1"
              aria-label="Name for the current format profile"
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
          <p className="text-xs text-slate-500">
            Captures every colour, border, font and alignment plus each column's
            chosen type — not the table's data.
          </p>
        </section>

        {/* ── Region 2: Find / apply profiles ──────────────────────────── */}
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <div className="eyebrow">Saved ({all.length})</div>
          </div>

          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name…"
            className="input-sm"
            aria-label="Search format profiles"
          />

          <div className="max-h-[50vh] overflow-auto custom-scrollbar rounded-lg border border-slate-200 bg-white">
            {all.length === 0 ? (
              <div className="px-3 py-10 text-center text-sm text-slate-500">
                No format profiles yet.
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
                    {th('summary', 'Contents')}
                    {th('updated', 'Updated')}
                    <th className="sticky top-0 z-10 bg-white border-b border-slate-200 px-3 py-2 text-right font-semibold text-slate-700">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => {
                    const summary = summaryText(p)
                    const editing = editingId === p.id
                    return (
                      <tr key={p.id} className="sm:hover:bg-slate-50 transition-colors">
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
                            <span className="block max-w-[12rem] truncate" title={p.name}>
                              {p.name}
                            </span>
                          )}
                        </td>

                        {/* Contents — the snapshot's size summary */}
                        <td className={`${cell} text-slate-600`}>
                          <span className="block max-w-[22rem] truncate" title={summary}>
                            {summary}
                          </span>
                        </td>

                        {/* Updated */}
                        <td className={`${cell} whitespace-nowrap text-slate-500`}>
                          <span title={new Date(p.updatedAt).toLocaleString()}>
                            {relativeTime(p.updatedAt)}
                          </span>
                        </td>

                        {/* Actions */}
                        <td className={`${cell} whitespace-nowrap`}>
                          <div className="flex items-center justify-end gap-1">
                            <Tooltip label="Apply this format to the grid">
                              <button
                                type="button"
                                className="btn-ghost-sm"
                                onClick={() => apply(p)}
                              >
                                <Paintbrush size={14} />
                                Apply
                              </button>
                            </Tooltip>
                            <Tooltip label="Update — re-save the grid's current format into this profile">
                              <button
                                type="button"
                                className="icon-btn-sm"
                                onClick={() => updateCurrent(p)}
                                aria-label={`Update ${p.name} to current format`}
                              >
                                <RefreshCw size={15} />
                              </button>
                            </Tooltip>
                            <Tooltip label="Rename">
                              <button
                                type="button"
                                className="icon-btn-sm"
                                onClick={() => startRename(p)}
                                aria-label={`Rename ${p.name}`}
                              >
                                <Pencil size={15} />
                              </button>
                            </Tooltip>
                            <Tooltip label="Delete">
                              <button
                                type="button"
                                className="icon-btn-sm icon-btn-danger"
                                onClick={() => remove(p)}
                                aria-label={`Delete ${p.name}`}
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

export default FormatProfilesDialog
