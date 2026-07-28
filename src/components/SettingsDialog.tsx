import React from 'react'
import {
  Check,
  Download,
  FileArchive,
  FileJson,
  FileUp,
  Link2,
  Paintbrush,
  Pencil,
  RefreshCw,
  Share2,
  SlidersHorizontal,
  SquarePen,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import {
  GlobalSearchValue,
  querySummary,
  isGlobalSearchEmpty,
} from '../globalSearch'
import {
  formatProfiles,
  useFormatProfilesVersion,
  FormatProfile,
} from '../formatProfiles'
import {
  savedQueries,
  useSavedQueriesVersion,
  SavedQuery,
} from '../savedQueries'
import {
  AppSnapshot,
  downloadSnapshotJson,
  downloadShareHtml,
  downloadZipExport,
  embedSnapshotAttachments,
  getAppUrl,
  parseSnapshotFile,
  parseShareHtml,
  parseZipImport,
} from '../snapshot'
import { Modal, useConfirm, useToast } from '../ui'
import { Tooltip } from '../ui/Tooltip'

// ─────────────────────────────────────────────────────────────────────────────
// SettingsDialog — one home for the grid's saved state, inside the shared
// the shared UI Modal, split across three tabs:
//   • Format profiles — named bundles of the grid's LOOK (colours, types,
//     borders, fonts), saved to this browser and re-applied later. Never data.
//   • Saved queries — named GlobalSearchValues, saved and recalled here.
//   • Export & share — take the whole VIEW (data + formatting + layout) out as a
//     lossless .json, or a self-opening .html share page; and bring one back in.
//
// The two CRUD tabs reproduce FormatProfilesDialog / SavedQueriesDialog inline
// (same table / search / sort / inline-rename), reading and writing the same
// global singleton stores; the export tab drives snapshot.ts. Props-driven: the
// App owns the snapshot builder and the query wiring.
// ─────────────────────────────────────────────────────────────────────────────

export type SettingsDialogProps = {
  open: boolean
  onClose: () => void
  /** Build the current view (data + formatting + layout) for export/share. */
  buildSnapshot: () => AppSnapshot
  /** Load an imported snapshot back into the app. */
  onImportSnapshot: (s: AppSnapshot) => void
  /** Max bytes per attachment inline-embedded on export (undefined = no cap). */
  exportEmbedLimit?: number
  /** The query currently in the builder — subject of "save current query". */
  currentQuery: unknown
  /** Apply a saved query back into the builder. */
  onLoadQuery: (value: unknown) => void
}

type TabId = 'profiles' | 'queries' | 'export'
type SortDir = 'asc' | 'desc'

/* --------------------------------------------------------------- shared bits */

/** Short, human "time since" — "just now", "5m ago", "2d ago", or a date once
 *  it is older than a week. Shared by both CRUD tabs. */
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

const cell = 'px-3 py-2 align-middle border-b border-slate-100'

/** A sortable column header cell — active column shows an accent arrow. */
function SortableTh<K extends string>({
  sortKey,
  label,
  active,
  dir,
  onToggle,
  align = 'left',
}: {
  sortKey: K
  label: string
  active: boolean
  dir: SortDir
  onToggle: (key: K) => void
  align?: 'left' | 'right'
}) {
  return (
    <th
      className={`sticky top-0 z-10 bg-white border-b border-slate-200 p-0 font-semibold ${
        align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      <button
        type="button"
        onClick={() => onToggle(sortKey)}
        className="flex w-full items-center gap-1 px-3 py-2 text-slate-700 sm:hover:bg-slate-50 transition-colors"
        aria-label={`Sort by ${label}`}
      >
        <span>{label}</span>
        <span
          className={`text-2xs leading-none ${active ? 'text-accent-600' : 'text-transparent'}`}
          aria-hidden="true"
        >
          {active ? (dir === 'asc' ? '▲' : '▼') : '▲'}
        </span>
      </button>
    </th>
  )
}

/* ══════════════════════════════════════════════════════════ Format profiles */

const formattedCount = (p: FormatProfile): number => Object.keys(p.formatting).length
const typedCount = (p: FormatProfile): number => Object.keys(p.columnTypes).length

function profileSummary(p: FormatProfile): string {
  const f = formattedCount(p)
  const t = typedCount(p)
  return `${f} formatted cell${f === 1 ? '' : 's'} · ${t} typed column${t === 1 ? '' : 's'}`
}

type ProfileSortKey = 'name' | 'summary' | 'updated'

function FormatProfilesTab() {
  const confirm = useConfirm()
  const toast = useToast()
  const version = useFormatProfilesVersion()

  const [name, setName] = React.useState('')
  const [search, setSearch] = React.useState('')
  const [sort, setSort] = React.useState<{ key: ProfileSortKey; dir: SortDir }>({
    key: 'updated',
    dir: 'desc',
  })
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [editName, setEditName] = React.useState('')

  const all = React.useMemo(() => formatProfiles.list(), [version])
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

  const rows = React.useMemo(() => {
    const needle = search.trim().toLowerCase()
    const filtered = needle
      ? all.filter(
          (p) =>
            p.name.toLowerCase().includes(needle) ||
            profileSummary(p).toLowerCase().includes(needle),
        )
      : all
    const dir = sort.dir === 'asc' ? 1 : -1
    const compare = (a: FormatProfile, b: FormatProfile): number => {
      switch (sort.key) {
        case 'name':
          return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
        case 'summary':
          return (
            formattedCount(a) - formattedCount(b) || typedCount(a) - typedCount(b)
          )
        case 'updated':
        default:
          return a.updatedAt - b.updatedAt
      }
    }
    return [...filtered].sort((a, b) => compare(a, b) * dir)
  }, [all, search, sort])

  const toggleSort = (key: ProfileSortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'updated' ? 'desc' : 'asc' },
    )
  }

  return (
    <div className="flex flex-col gap-5">
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
          Saves the VIEW only — every colour, border, font and alignment plus each
          column's chosen type. Never the table's data.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <div className="eyebrow">Saved ({all.length})</div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name…"
          className="input-sm"
          aria-label="Search format profiles"
        />
        <div className="max-h-[46vh] overflow-auto custom-scrollbar rounded-lg border border-slate-200 bg-white">
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
                  <SortableTh
                    sortKey="name"
                    label="Name"
                    active={sort.key === 'name'}
                    dir={sort.dir}
                    onToggle={toggleSort}
                  />
                  <SortableTh
                    sortKey="summary"
                    label="Contents"
                    active={sort.key === 'summary'}
                    dir={sort.dir}
                    onToggle={toggleSort}
                  />
                  <SortableTh
                    sortKey="updated"
                    label="Updated"
                    active={sort.key === 'updated'}
                    dir={sort.dir}
                    onToggle={toggleSort}
                  />
                  <th className="sticky top-0 z-10 bg-white border-b border-slate-200 px-3 py-2 text-right font-semibold text-slate-700">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const summary = profileSummary(p)
                  const editing = editingId === p.id
                  return (
                    <tr key={p.id} className="sm:hover:bg-slate-50 transition-colors">
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
                      <td className={`${cell} text-slate-600`}>
                        <span className="block max-w-[22rem] truncate" title={summary}>
                          {summary}
                        </span>
                      </td>
                      <td className={`${cell} whitespace-nowrap text-slate-500`}>
                        <span title={new Date(p.updatedAt).toLocaleString()}>
                          {relativeTime(p.updatedAt)}
                        </span>
                      </td>
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
  )
}

/* ═══════════════════════════════════════════════════════════ Saved queries */

type QuerySortKey = 'name' | 'query' | 'updated'

function SavedQueriesTab({
  currentQuery,
  onLoadQuery,
  onClose,
}: {
  currentQuery: GlobalSearchValue
  onLoadQuery: (value: GlobalSearchValue) => void
  onClose: () => void
}) {
  const confirm = useConfirm()
  const toast = useToast()
  const version = useSavedQueriesVersion()

  const [name, setName] = React.useState('')
  const [search, setSearch] = React.useState('')
  const [sort, setSort] = React.useState<{ key: QuerySortKey; dir: SortDir }>({
    key: 'updated',
    dir: 'desc',
  })
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [editName, setEditName] = React.useState('')

  const all = React.useMemo(() => savedQueries.list(), [version])
  const summaryText = (v: GlobalSearchValue) => querySummary(v)
  const currentEmpty = isGlobalSearchEmpty(currentQuery)
  const canSave = !currentEmpty && name.trim().length > 0

  const saveCurrent = async () => {
    const trimmed = name.trim()
    if (!trimmed || currentEmpty) return
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
      savedQueries.replace(existing.id, currentQuery)
      toast.success('Saved query updated', existing.name)
    } else {
      savedQueries.save(trimmed, currentQuery)
      toast.success('Query saved', trimmed)
    }
    setName('')
  }

  const load = (sq: SavedQuery) => {
    onLoadQuery(sq.value)
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
          return summaryText(a.value).localeCompare(summaryText(b.value), undefined, {
            sensitivity: 'base',
          })
        case 'updated':
        default:
          return a.updatedAt - b.updatedAt
      }
    }
    return [...filtered].sort((a, b) => compare(a, b) * dir)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, search, sort])

  const toggleSort = (key: QuerySortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'updated' ? 'desc' : 'asc' },
    )
  }

  return (
    <div className="flex flex-col gap-5">
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
        {currentEmpty ? (
          <p className="text-xs text-slate-500">
            Build a query first — there is nothing to save yet.
          </p>
        ) : (
          <p
            className="text-xs text-slate-500 truncate"
            title={summaryText(currentQuery)}
          >
            {summaryText(currentQuery)}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <div className="eyebrow">Saved ({all.length})</div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or query…"
          className="input-sm"
          aria-label="Search saved queries"
        />
        <div className="max-h-[46vh] overflow-auto custom-scrollbar rounded-lg border border-slate-200 bg-white">
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
                  <SortableTh
                    sortKey="name"
                    label="Name"
                    active={sort.key === 'name'}
                    dir={sort.dir}
                    onToggle={toggleSort}
                  />
                  <SortableTh
                    sortKey="query"
                    label="Query"
                    active={sort.key === 'query'}
                    dir={sort.dir}
                    onToggle={toggleSort}
                  />
                  <SortableTh
                    sortKey="updated"
                    label="Updated"
                    active={sort.key === 'updated'}
                    dir={sort.dir}
                    onToggle={toggleSort}
                  />
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
                      <td className={`${cell} text-slate-600`}>
                        {summary ? (
                          <span className="block max-w-[22rem] truncate" title={summary}>
                            {summary}
                          </span>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className={`${cell} whitespace-nowrap text-slate-500`}>
                        <span title={new Date(sq.updatedAt).toLocaleString()}>
                          {relativeTime(sq.updatedAt)}
                        </span>
                      </td>
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
  )
}

/* ══════════════════════════════════════════════════════════ Export & share */

function ExportShareTab({
  buildSnapshot,
  onImportSnapshot,
  exportEmbedLimit,
  onClose,
}: {
  buildSnapshot: () => AppSnapshot
  onImportSnapshot: (s: AppSnapshot) => void
  exportEmbedLimit?: number
  onClose: () => void
}) {
  const toast = useToast()
  const fileRef = React.useRef<HTMLInputElement>(null)
  const appUrl = getAppUrl()
  const [busy, setBusy] = React.useState(false)

  // Uploaded media lives in session-scoped blob: URLs; embed it as data: URLs so
  // the exported file carries its images/videos/files to any machine. A note is
  // shown when some attachments were too big to inline (see exportEmbedLimit).
  const embeddedSnapshot = async () => {
    const { snapshot, embedded, referenced } = await embedSnapshotAttachments(
      buildSnapshot(),
      exportEmbedLimit,
    )
    return { snapshot, embedded, referenced }
  }

  const embedNote = (embedded: number, referenced: number) => {
    const parts: string[] = []
    if (embedded) parts.push(`${embedded} media file(s) embedded`)
    if (referenced)
      parts.push(`${referenced} too large to embed — kept as reference`)
    return parts.join(' · ') || undefined
  }

  const exportJson = async () => {
    setBusy(true)
    try {
      const { snapshot, embedded, referenced } = await embeddedSnapshot()
      downloadSnapshotJson(snapshot)
      toast.success('View exported', embedNote(embedded, referenced) ?? 'Saved as a .json file')
    } catch (err) {
      toast.fromError('Export failed', err)
    } finally {
      setBusy(false)
    }
  }

  const exportHtml = async () => {
    setBusy(true)
    try {
      const { snapshot, embedded, referenced } = await embeddedSnapshot()
      downloadShareHtml(snapshot, appUrl)
      toast.success(
        'Shareable page created',
        embedNote(embedded, referenced) ?? 'Saved as a .html file',
      )
    } catch (err) {
      toast.fromError('Could not create share page', err)
    } finally {
      setBusy(false)
    }
  }

  // The media-friendly path: real files in a folder, referenced by name from
  // view.json. `buildSnapshot()` is used as-is — the zip builder pulls the bytes
  // and rewrites each attachment to an archive path itself.
  const exportZip = async () => {
    setBusy(true)
    try {
      const { bundled, missing } = await downloadZipExport(buildSnapshot())
      const parts = [`${bundled} media file(s) bundled`]
      if (missing) parts.push(`${missing} unavailable`)
      toast.success('View exported', parts.join(' · '))
    } catch (err) {
      toast.fromError('Export failed', err)
    } finally {
      setBusy(false)
    }
  }

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget
    const file = input.files?.[0]
    // Reset immediately so re-picking the same file fires change again.
    input.value = ''
    if (!file) return
    setBusy(true)
    try {
      const lower = file.name.toLowerCase()
      // A .zip bundle carries its media as real files; read it as bytes and let
      // parseZipImport rehydrate the attachments from `files/`.
      const isZip = lower.endsWith('.zip') || file.type === 'application/zip'
      let snapshot: AppSnapshot | null
      let kind: 'zip' | 'html' | 'json'
      if (isZip) {
        kind = 'zip'
        snapshot = parseZipImport(new Uint8Array(await file.arrayBuffer()))
      } else {
        const text = await file.text()
        const isHtml =
          lower.endsWith('.html') || /^\s*<!doctype html/i.test(text)
        kind = isHtml ? 'html' : 'json'
        snapshot = isHtml ? parseShareHtml(text) : parseSnapshotFile(text)
      }
      if (!snapshot) {
        toast.error(
          'Could not import',
          kind === 'zip'
            ? "This .zip doesn't contain a view.json bundle."
            : kind === 'html'
              ? "This .html file doesn't contain a shareable view."
              : 'This file is not a valid exported view.',
        )
        return
      }
      onImportSnapshot(snapshot)
      toast.success('View imported', `${snapshot.data.length} row(s) loaded`)
      onClose()
    } catch (err) {
      toast.fromError('Import failed', err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-3">
        <div className="eyebrow">Export this view</div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <FileJson size={16} className="text-slate-500 shrink-0" />
              Export view + data (.json)
            </div>
            <p className="text-xs text-slate-500 mt-1">
              A complete, lossless copy — rows, formulas, formatting (colors,
              fonts, borders, alignment), column types, layout and merges. Media
              is inlined as base64. One self-contained file, any size.
            </p>
          </div>
          <button
            type="button"
            className="btn-primary-sm shrink-0"
            onClick={exportJson}
            disabled={busy}
          >
            <Download size={14} />
            {busy ? 'Exporting…' : 'Export .json'}
          </button>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <FileArchive size={16} className="text-slate-500 shrink-0" />
              Export view + media (.zip)
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Best for images, video and files: a <code>view.json</code> plus a{' '}
              <code>files/</code> folder of the actual media, linked by name.
              Re-import the whole <code>.zip</code> to restore everything.
            </p>
          </div>
          <button
            type="button"
            className="btn-ghost-sm shrink-0"
            onClick={exportZip}
            disabled={busy}
          >
            <FileArchive size={14} />
            {busy ? 'Bundling…' : 'Export .zip'}
          </button>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <Share2 size={16} className="text-slate-500 shrink-0" />
              Create shareable page (.html)
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Opening it opens{' '}
              <span className="inline-flex items-center gap-1 font-medium text-slate-700">
                <Link2 size={12} />
                {appUrl || 'this app'}
              </span>{' '}
              and loads this exact view — data and formatting. Great for sending to
              someone. Best-effort for reasonably sized views.
            </p>
          </div>
          <button
            type="button"
            className="btn-ghost-sm shrink-0"
            onClick={exportHtml}
            disabled={busy}
          >
            <Share2 size={14} />
            {busy ? 'Working…' : 'Create .html'}
          </button>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="eyebrow">Import a view</div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <FileUp size={16} className="text-slate-500 shrink-0" />
              Import a view…
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Load a previously exported{' '}
              <code className="text-slate-600">.json</code>,{' '}
              <code className="text-slate-600">.zip</code> (with its media), or a
              shared <code className="text-slate-600">.html</code> page. This
              replaces the current view with the imported one.
            </p>
          </div>
          <button
            type="button"
            className="btn-ghost-sm shrink-0"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
          >
            <Upload size={14} />
            {busy ? 'Reading…' : 'Choose file…'}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,.html,.zip"
            className="hidden"
            onChange={onPickFile}
          />
        </div>
        <p className="text-2xs text-slate-500">
          Media round-trips both ways: a <code>.zip</code> keeps it as real files
          in a <code>files/</code> folder linked by name; a <code>.json</code>/
          <code>.html</code> inlines it as <code>data:</code> URLs (large files
          above <code>exportEmbedLimit</code> are kept as references).
        </p>
      </section>
    </div>
  )
}

/* ══════════════════════════════════════════════════════════════ the dialog */

export function SettingsDialog({
  open,
  onClose,
  buildSnapshot,
  onImportSnapshot,
  exportEmbedLimit,
  currentQuery,
  onLoadQuery,
}: SettingsDialogProps) {
  const [tab, setTab] = React.useState<TabId>('profiles')

  // Land on the first tab each time the dialog opens.
  React.useEffect(() => {
    if (open) setTab('profiles')
  }, [open])

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'profiles', label: 'Format profiles', icon: <Paintbrush size={14} /> },
    { id: 'queries', label: 'Saved queries', icon: <SlidersHorizontal size={14} /> },
    { id: 'export', label: 'Export & share', icon: <Share2 size={14} /> },
  ]

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title="Settings"
      subtitle="Saved formats, saved queries, and exporting or sharing this view."
      maxW="sm:max-w-2xl"
    >
      <div className="flex flex-col gap-4">
        {/* Tab strip — active tab carries the accent text + underline. */}
        <div
          role="tablist"
          aria-label="Settings sections"
          className="flex items-center gap-1 border-b border-slate-200 -mt-1"
        >
          {tabs.map((t) => {
            const active = tab === t.id
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-3 py-2 text-sm font-semibold -mb-px border-b-2 transition-colors ${
                  active
                    ? 'border-accent-600 text-accent-700'
                    : 'border-transparent text-slate-500 sm:hover:text-slate-800'
                }`}
              >
                {t.icon}
                <span>{t.label}</span>
              </button>
            )
          })}
        </div>

        <div>
          {tab === 'profiles' && <FormatProfilesTab />}
          {tab === 'queries' && (
            <SavedQueriesTab
              currentQuery={currentQuery as GlobalSearchValue}
              onLoadQuery={(v) => onLoadQuery(v)}
              onClose={onClose}
            />
          )}
          {tab === 'export' && (
            <ExportShareTab
              buildSnapshot={buildSnapshot}
              onImportSnapshot={onImportSnapshot}
              exportEmbedLimit={exportEmbedLimit}
              onClose={onClose}
            />
          )}
        </div>
      </div>
    </Modal>
  )
}

export default SettingsDialog
