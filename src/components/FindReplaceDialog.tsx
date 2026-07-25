import React from 'react'
import { Search, Replace, AlertTriangle, CaseSensitive, Regex, SquareEqual } from 'lucide-react'
import { Modal, useToast, useConfirm } from '../ui'
import { Tooltip } from '../ui/Tooltip'

// ─────────────────────────────────────────────────────────────────────────────
// FindReplaceDialog — spreadsheet-wide find & replace, inside the shared the shared UI
// Modal. Fully props-driven: the parent owns the table data (`rows`/`columns`)
// and applies edits through `onApply` — this dialog NEVER mutates `rows`. It only
// scans the data, previews matches, and emits an `updates` array describing the
// new string value for each affected cell.
//
// Matching supports: substring OR whole-cell, case-sensitive/insensitive, and a
// raw JS regex (guarded — an invalid pattern shows an inline error, never throws).
// Read-only columns are excluded from both search and replace, and object-valued
// cells (e.g. attachments) that don't coerce to a meaningful string are skipped.
// ─────────────────────────────────────────────────────────────────────────────

type FindReplaceDialogProps = {
  open: boolean
  onClose: () => void
  rows: Record<string, unknown>[]
  columns: { id: string; label: string; readOnly?: boolean }[]
  onApply: (updates: { rowIndex: number; columnId: string; value: string }[]) => void
}

/** One cell that contains at least one match. `cellStr` is the coerced string we
 *  matched against; `ranges` are [start, end) offsets for highlighting. */
type MatchItem = {
  rowIndex: number
  columnId: string
  columnLabel: string
  cellStr: string
  count: number
  ranges: [number, number][]
}

// Preview is capped so a table-wide match set never renders tens of thousands of
// rows; replace still operates over the FULL set regardless of this cap.
const PREVIEW_CAP = 200
// Above this many affected cells, a replace is treated as destructive-scale and
// gated behind a confirm.
const LARGE_REPLACE = 50
// Defensive per-cell ceiling so a pathological regex can't explode one cell.
const MAX_MATCHES_PER_CELL = 1000

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Coerce a raw cell value to a string we can match against, or `null` to skip.
 *  Nullish → '' (nothing to match). Objects (attachments, etc.) that don't
 *  stringify meaningfully are skipped rather than matched as "[object Object]". */
function coerceCell(value: unknown): string | null {
  if (value === null || value === undefined) return ''
  const t = typeof value
  if (t === 'string') return value as string
  if (t === 'number' || t === 'boolean' || t === 'bigint') return String(value)
  // Objects / arrays / functions — not string-coercible in a useful way.
  return null
}

export function FindReplaceDialog({ open, onClose, rows, columns, onApply }: FindReplaceDialogProps) {
  const toast = useToast()
  const confirm = useConfirm()

  const [find, setFind] = React.useState('')
  const [replace, setReplace] = React.useState('')
  const [matchCase, setMatchCase] = React.useState(false)
  const [wholeCell, setWholeCell] = React.useState(false)
  const [useRegex, setUseRegex] = React.useState(false)
  const [scope, setScope] = React.useState('all')

  // Reset transient UI each time the dialog opens.
  React.useEffect(() => {
    if (!open) return
    setScope('all')
  }, [open])

  // Only non-read-only columns are ever searched or replaced.
  const inScopeColumns = React.useMemo(
    () => columns.filter((c) => !c.readOnly),
    [columns],
  )

  // The columns actually scanned: all in-scope, or the single selected one.
  const searchColumns = React.useMemo(() => {
    if (scope === 'all') return inScopeColumns
    const one = inScopeColumns.find((c) => c.id === scope)
    return one ? [one] : inScopeColumns
  }, [scope, inScopeColumns])

  // Build the matching regex once. Invalid regex → inline error, never a throw.
  // `g` flag lets us count/highlight every occurrence; whole-cell anchors it.
  const compiled = React.useMemo<{ re: RegExp | null; error: string | null }>(() => {
    if (!find) return { re: null, error: null }
    try {
      const flags = 'g' + (matchCase ? '' : 'i')
      const body = useRegex ? find : escapeRegExp(find)
      const source = wholeCell ? `^(?:${body})$` : body
      return { re: new RegExp(source, flags), error: null }
    } catch (e) {
      return {
        re: null,
        error: e instanceof Error ? e.message : 'Invalid regular expression',
      }
    }
  }, [find, matchCase, useRegex, wholeCell])

  // Scan rows × in-scope columns → matching cells (full set, not capped).
  const matches = React.useMemo(() => {
    const re = compiled.re
    if (!re) return { items: [] as MatchItem[], total: 0 }

    const items: MatchItem[] = []
    let total = 0

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex]
      for (const col of searchColumns) {
        const cellStr = coerceCell(row[col.id])
        if (cellStr === null || cellStr === '') continue

        re.lastIndex = 0
        const ranges: [number, number][] = []
        let m: RegExpExecArray | null
        let guard = 0
        while ((m = re.exec(cellStr)) !== null) {
          // Ignore zero-width matches (e.g. `a*` against "bbb") — they carry no
          // highlightable text and would otherwise spin the loop.
          if (m[0].length > 0) {
            ranges.push([m.index, m.index + m[0].length])
          } else {
            re.lastIndex++
          }
          if (++guard >= MAX_MATCHES_PER_CELL) break
        }

        if (ranges.length === 0) continue
        total += ranges.length
        items.push({
          rowIndex,
          columnId: col.id,
          columnLabel: col.label,
          cellStr,
          count: ranges.length,
          ranges,
        })
      }
    }

    return { items, total }
  }, [compiled.re, rows, searchColumns])

  const cellCount = matches.items.length
  const canAct = !!compiled.re && !compiled.error && inScopeColumns.length > 0
  const hasMatches = canAct && cellCount > 0

  // Build the replacement value for one cell across ALL its matches.
  const replaceAllInCell = React.useCallback(
    (cellStr: string): string => {
      const re = compiled.re
      if (!re) return cellStr
      re.lastIndex = 0
      return cellStr.replace(re, replace)
    },
    [compiled.re, replace],
  )

  const doReplaceAll = async () => {
    if (!hasMatches) return

    const updates = matches.items.map((it) => ({
      rowIndex: it.rowIndex,
      columnId: it.columnId,
      value: replaceAllInCell(it.cellStr),
    }))

    if (updates.length > LARGE_REPLACE) {
      const ok = await confirm({
        title: 'Replace across many cells?',
        message: `This will replace ${matches.total} match${matches.total === 1 ? '' : 'es'} across ${updates.length} cells. You can undo it afterwards, but it changes a lot at once.`,
        confirmLabel: `Replace ${updates.length}`,
        tone: 'default',
        details: [
          `${matches.total} matches will be substituted`,
          `${updates.length} cells will change`,
          'Read-only columns are left untouched',
        ],
      })
      if (!ok) return
    }

    onApply(updates)
    toast.success(
      'Replaced',
      `${matches.total} match${matches.total === 1 ? '' : 'es'} across ${updates.length} cell${updates.length === 1 ? '' : 's'}`,
    )
  }

  // Replace only the first remaining match (uses a non-global regex so capture
  // groups in `replace` still work, but only the first occurrence is touched).
  const doReplaceNext = () => {
    if (!hasMatches) return
    const first = matches.items[0]
    let single: RegExp
    try {
      const flags = matchCase ? '' : 'i'
      const body = useRegex ? find : escapeRegExp(find)
      const source = wholeCell ? `^(?:${body})$` : body
      single = new RegExp(source, flags)
    } catch {
      return
    }
    const value = first.cellStr.replace(single, replace)
    onApply([{ rowIndex: first.rowIndex, columnId: first.columnId, value }])
    toast.success('Replaced one', `Row ${first.rowIndex + 1} · ${first.columnLabel}`)
  }

  // Render a cell's text with its matched spans highlighted.
  const renderHighlighted = (cellStr: string, ranges: [number, number][]) => {
    const parts: React.ReactNode[] = []
    let last = 0
    ranges.slice(0, 100).forEach(([s, e], i) => {
      if (s > last) parts.push(cellStr.slice(last, s))
      parts.push(
        <mark
          key={i}
          className="rounded bg-accent-500/20 px-0.5 font-medium text-accent-800"
        >
          {cellStr.slice(s, e)}
        </mark>,
      )
      last = e
    })
    if (last < cellStr.length) parts.push(cellStr.slice(last))
    return parts
  }

  const preview = matches.items.slice(0, PREVIEW_CAP)

  const footer = (
    <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
      <span className="mr-auto text-xs text-slate-500" aria-live="polite">
        {compiled.error ? (
          <span className="text-rose-600">Fix the pattern to search</span>
        ) : !find ? (
          'Enter a term to find'
        ) : (
          <>
            <span className="font-semibold text-slate-700">{matches.total}</span>{' '}
            match{matches.total === 1 ? '' : 'es'} in{' '}
            <span className="font-semibold text-slate-700">{cellCount}</span> cell
            {cellCount === 1 ? '' : 's'}
          </>
        )}
      </span>
      <button type="button" className="btn-ghost-sm" onClick={doReplaceNext} disabled={!hasMatches}>
        Replace next
      </button>
      <button type="button" className="btn-primary-sm" onClick={doReplaceAll} disabled={!hasMatches}>
        <Replace size={14} />
        Replace all
      </button>
    </div>
  )

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title="Find & replace"
      subtitle="Search every cell in scope and substitute matches — read-only columns are left untouched."
      icon={<Search size={18} />}
      maxW="sm:max-w-2xl"
      footer={footer}
    >
      <div className="flex flex-col gap-4">
        {/* ── Find / Replace inputs ─────────────────────────────────────── */}
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="eyebrow">Find</span>
            <input
              autoFocus
              value={find}
              onChange={(e) => setFind(e.target.value)}
              onKeyDown={(e) => {
                // Enter triggers a replace-all (Find is already live-scanned).
                if (e.key === 'Enter' && hasMatches) doReplaceAll()
              }}
              placeholder={useRegex ? 'Regular expression…' : 'Text to find…'}
              className={`input-sm ${compiled.error ? '!border-rose-300' : ''}`}
              aria-label="Find"
              aria-invalid={!!compiled.error}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="eyebrow">Replace with</span>
            <input
              value={replace}
              onChange={(e) => setReplace(e.target.value)}
              placeholder="Replacement text…"
              className="input-sm"
              aria-label="Replace with"
            />
          </label>

          {compiled.error && (
            <p className="flex items-start gap-1.5 text-xs text-rose-600" role="alert">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              <span>Invalid regex: {compiled.error}</span>
            </p>
          )}
        </div>

        {/* ── Options ───────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Tooltip label="Match upper/lower case exactly">
            <label className="flex cursor-pointer items-center gap-1.5 text-sm text-slate-700">
              <input
                type="checkbox"
                className="accent-accent-500"
                checked={matchCase}
                onChange={(e) => setMatchCase(e.target.checked)}
              />
              <CaseSensitive size={15} className="text-slate-500" />
              Match case
            </label>
          </Tooltip>

          <Tooltip label="Match only when the entire cell equals the term">
            <label className="flex cursor-pointer items-center gap-1.5 text-sm text-slate-700">
              <input
                type="checkbox"
                className="accent-accent-500"
                checked={wholeCell}
                onChange={(e) => setWholeCell(e.target.checked)}
              />
              <SquareEqual size={15} className="text-slate-500" />
              Whole cell
            </label>
          </Tooltip>

          <Tooltip label="Treat Find as a JavaScript regular expression">
            <label className="flex cursor-pointer items-center gap-1.5 text-sm text-slate-700">
              <input
                type="checkbox"
                className="accent-accent-500"
                checked={useRegex}
                onChange={(e) => setUseRegex(e.target.checked)}
              />
              <Regex size={15} className="text-slate-500" />
              Regex
            </label>
          </Tooltip>

          <label className="ml-auto flex items-center gap-1.5 text-sm text-slate-700">
            <span className="text-slate-500">In</span>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              className="input-sm !w-auto"
              aria-label="Column scope"
              disabled={inScopeColumns.length === 0}
            >
              <option value="all">All columns</option>
              {inScopeColumns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* ── Results preview ───────────────────────────────────────────── */}
        {inScopeColumns.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-8 text-center text-sm text-slate-500">
            No searchable columns — every column here is read-only.
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <span className="eyebrow">Matches</span>
              {cellCount > PREVIEW_CAP && (
                <span className="text-2xs text-slate-400">
                  Showing first {PREVIEW_CAP} of {cellCount}
                </span>
              )}
            </div>

            <div className="max-h-[40vh] overflow-auto custom-scrollbar rounded-lg border border-slate-200 bg-white">
              {!find ? (
                <div className="px-3 py-8 text-center text-sm text-slate-500">
                  Type a term above to see matches.
                </div>
              ) : compiled.error ? (
                <div className="px-3 py-8 text-center text-sm text-slate-500">
                  Waiting for a valid pattern…
                </div>
              ) : preview.length === 0 ? (
                <div className="px-3 py-8 text-center text-sm text-slate-500">
                  No matches.
                </div>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {preview.map((it) => (
                    <li
                      key={`${it.rowIndex}:${it.columnId}`}
                      className="flex items-baseline gap-2 px-3 py-1.5 text-sm sm:hover:bg-slate-50 transition-colors"
                    >
                      <span className="shrink-0 text-2xs font-semibold uppercase tracking-wide text-slate-400">
                        Row {it.rowIndex + 1}
                      </span>
                      <span className="shrink-0 max-w-[8rem] truncate text-2xs font-medium text-accent-700" title={it.columnLabel}>
                        {it.columnLabel}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-slate-700" title={it.cellStr}>
                        {renderHighlighted(it.cellStr, it.ranges)}
                      </span>
                      {it.count > 1 && (
                        <span className="shrink-0 text-2xs text-slate-400">×{it.count}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

export default FindReplaceDialog
