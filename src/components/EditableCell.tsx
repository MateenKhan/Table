import { CellContext, RowData } from '@tanstack/react-table'
import React from 'react'
import { format as formatDate, parseISO, isValid } from 'date-fns'
import { DayPicker } from 'react-day-picker'
import 'react-day-picker/style.css'
import { useCellSelection } from '../useCellSelection'
import { TableMeta } from '../tableModels'
import {
  alignmentFor,
  formatCellValue,
  isDateType,
  isNumericType,
} from '../columnTypes'
import {
  createAttachment,
  fileIconFor,
  initialsOf,
  isAttachment,
  isImageAttachment,
  releaseAttachment,
} from '../attachments'
import { useThumbnailMetrics } from '../thumbnailSize'
import { resolveFormat } from '../formatting'
import { extractReferences } from '../formula'
import { formulaRefs } from '../formulaRefs'
import FileDropzone from './FileDropzone'

// Coerce a stored value into a `Date` for the calendar / time editors. Tolerant
// of ISO dates ('yyyy-MM-dd'), full ISO instants and raw timestamps; returns
// undefined for anything that is not a usable date.
function toEditableDate(value: unknown): Date | undefined {
  if (value === null || value === undefined || value === '') return undefined
  if (value instanceof Date) return isValid(value) ? value : undefined
  if (typeof value === 'number') {
    const d = new Date(value)
    return isValid(d) ? d : undefined
  }
  if (typeof value !== 'string') return undefined
  const iso = parseISO(value)
  if (isValid(iso)) return iso
  const loose = new Date(value)
  return isValid(loose) ? loose : undefined
}

// Which picker `accept` string a mixed column's `acceptedTypes` implies: any
// file when it takes `file`, images only when it takes `image` (and not file),
// otherwise unrestricted.
function mixedAcceptFor(kinds?: string[]): string | undefined {
  if (!kinds || kinds.includes('file')) return undefined
  if (kinds.includes('image')) return 'image/*'
  return undefined
}

// The default cell renderer. Outside edit mode it shows the *computed* value
// (formulas store their result in `data`); while editing it shows the raw
// `=...` source so the formula can be changed.
export function EditableCell<T extends RowData>({
  getValue,
  row,
  column,
  table,
}: CellContext<T, unknown>) {
  const selection = useCellSelection()
  const dataIndex = row.index
  const columnId = column.id
  const isEditing = selection?.editingKey === `${row.id}::${columnId}`
  const readOnlyColumn = selection?.isReadOnlyColumn(columnId) ?? false
  // The column's declared type drives formatting, alignment and what the
  // editor will accept.
  const typeOptions = column.columnDef.meta
  const numeric = isNumericType(typeOptions?.type)

  const value = getValue()
  const formula = selection?.getFormula(dataIndex, columnId)

  // The cell's effective formatting (column < row < cell). CustomTable subscribes
  // to the store's version and re-renders, so reading it here is enough — the
  // input has its own text color/alignment, which would otherwise mask the <td>.
  const fmt = resolveFormat(columnId, dataIndex)

  const [draft, setDraft] = React.useState('')
  const inputRef = React.useRef<HTMLInputElement>(null)
  const draftRef = React.useRef('')
  draftRef.current = draft
  const wasEditing = React.useRef(false)
  const cancelled = React.useRef(false)
  const pendingSelect = React.useRef(false)

  // Extra editors: a `date` popover anchored to the cell, and a mixed-cell
  // thumbnail. These hooks run for every cell (rules-of-hooks) but only matter
  // for the relevant column type.
  const metrics = useThumbnailMetrics()
  const dateType = isDateType(typeOptions?.type)
  const isDatetime = typeOptions?.type === 'datetime'
  const mixed = typeOptions?.type === 'mixed'
  // Time-of-day for a `datetime` cell while it is being edited (HH:mm).
  const [timeStr, setTimeStr] = React.useState('00:00')
  // Container for the date popover, so the input's blur can tell "focus moved
  // into my own calendar" (keep editing) from "focus left the cell" (commit).
  const popoverRef = React.useRef<HTMLDivElement>(null)
  // Broken-image fallback for mixed image thumbnails.
  const [imgBroken, setImgBroken] = React.useState(false)
  const attachmentUrl = isAttachment(value) ? value.url : null
  React.useEffect(() => {
    setImgBroken(false)
  }, [attachmentUrl])

  // Standalone fallback for when no selection provider is mounted: behave like
  // the original plain editable input.
  const [fallback, setFallback] = React.useState(value)
  React.useEffect(() => {
    if (!selection) setFallback(value)
  }, [value, selection])

  // Layout effect (not rAF) so focus lands even when the tab is throttled -
  // otherwise a cell can get stuck in edit mode with nothing focused.
  React.useLayoutEffect(() => {
    if (isEditing) {
      wasEditing.current = true
      cancelled.current = false
      const typed = selection?.takeInitialInput() ?? null
      // F2 asks for the caret at the end (value preserved, not selected); Enter
      // and double-click select all. Typing supplies its own char, so no select.
      const caret = selection?.takeEditCaret() ?? false
      // Date columns seed the editor with the formatted display (e.g.
      // '2026-07-25') rather than the raw stored ISO, so typing stays natural;
      // every other type keeps its exact stored text.
      const seed =
        dateType && value ? formatCellValue(value, typeOptions) : String(value ?? '')
      setDraft(typed ?? formula ?? seed)
      // Seed the time editor from the stored instant when a datetime cell opens.
      if (isDatetime) {
        const d = toEditableDate(value)
        setTimeStr(d ? formatDate(d, 'HH:mm') : '00:00')
      }
      pendingSelect.current = typed === null && !caret
      inputRef.current?.focus()
      return
    }

    if (wasEditing.current) {
      wasEditing.current = false
      // Hand focus back to the grid's focus sink so its keyboard navigation
      // (which ignores events targeted at inputs) takes over again — blurring to
      // the bare document would leave nav with nowhere to run.
      if (document.activeElement === inputRef.current) {
        inputRef.current?.blur()
        selection?.focusGrid()
      }
      if (!cancelled.current) {
        selection?.commitEdit(dataIndex, columnId, draftRef.current)
      }
      cancelled.current = false
    }
  }, [isEditing])

  // `draft` is only populated on the render after editing starts, so the
  // select-all has to wait for it to land.
  React.useLayoutEffect(() => {
    if (!isEditing || !pendingSelect.current) return
    pendingSelect.current = false
    inputRef.current?.select()
  }, [isEditing, draft])

  // Live formula-reference highlight. While this cell is being edited with a
  // formula draft (`=…`), publish the cells the formula reads so CustomTable can
  // outline them live as they are typed; a non-formula draft clears it. Only the
  // editing cell ever writes the shared store (this body no-ops otherwise), so a
  // non-editing cell can never stomp the active draft's highlight.
  React.useEffect(() => {
    if (!isEditing) return
    if (draft.trimStart().startsWith('=')) {
      formulaRefs.set(extractReferences(draft, dataIndex))
    } else {
      formulaRefs.clear()
    }
  }, [isEditing, draft, dataIndex])

  // Clear the highlight when editing ends (commit / cancel / navigation) or the
  // cell unmounts. Gated on `isEditing` so the cleanup only ever runs for the
  // cell that was actually editing.
  React.useEffect(() => {
    if (!isEditing) return
    return () => formulaRefs.clear()
  }, [isEditing])

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      cancelled.current = true
      selection?.stopEditing()
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      selection?.stopEditing('down')
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      selection?.stopEditing('right')
    }
  }

  if (!selection) {
    const commitFallback = () => {
      ;(table.options.meta as TableMeta).updateData(
        dataIndex,
        columnId,
        fallback,
      )
    }

    return (
      <input
        className="input-sm"
        value={fallback as string}
        onChange={(event) => setFallback(event.target.value)}
        onBlur={commitFallback}
      />
    )
  }

  // Outside edit mode the value is shown through the column's formatter
  // (thousands separators, currency symbol, fixed decimals); editing always
  // exposes the raw number so it can be retyped.
  const display = formatCellValue(value, typeOptions)

  /**
   * While editing, the draft accepts anything. Validation happens on commit.
   *
   * This used to drop any keystroke that left the draft failing the column's
   * type check, and drop it *silently* — no beep, no rejection, the character
   * simply never appeared. On a numeric column that made formulas impossible
   * to type over an existing value: editing `166` and typing `=100+200` gives
   * the intermediate draft `166=`, which is not a valid number, so the `=` was
   * discarded — and every digit after it just concatenated onto the old value,
   * turning the cell into `166100200`.
   *
   * Per-keystroke type checking cannot work, because valid input passes
   * through invalid intermediate states. It is also not how a spreadsheet
   * behaves: Excel and Sheets let you type freely and decide what the value is
   * when you commit. `coerceValue` already does exactly that here.
   */
  const onDraftChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setDraft(event.target.value)
  }

  // Committing an edit while focus is still inside the cell's own date popover
  // must NOT close it (clicking the calendar / time control moves focus there);
  // only focus leaving the cell commits. Non-date cells keep the old behaviour.
  const onInputBlur = (event: React.FocusEvent<HTMLInputElement>) => {
    if (dateType && popoverRef.current?.contains(event.relatedTarget as Node)) {
      return
    }
    selection.stopEditing()
  }

  const textInput = (
    <input
      ref={inputRef}
      value={isEditing ? draft : display}
      readOnly={!isEditing}
      tabIndex={isEditing ? 0 : -1}
      title={formula && !isEditing ? formula : undefined}
      inputMode={numeric ? 'decimal' : undefined}
      onChange={onDraftChange}
      onKeyDown={onKeyDown}
      onBlur={onInputBlur}
      className={`w-full bg-transparent outline-none${
        formula && !isEditing ? ' italic' : ''
      }`}
      style={{
        // Store colour/alignment/font win over the type default so a
        // column/row/cell format set from the popup shows on editor cells too,
        // not just the bg.
        color: fmt.fg || '#0f172a',
        textAlign: fmt.align ?? alignmentFor(typeOptions?.type),
        ...(fmt.fontSize ? { fontSize: fmt.fontSize } : {}),
        ...(fmt.fontFamily ? { fontFamily: fmt.fontFamily } : {}),
        // Let mouse events fall through to the <td> so click-drag selection and
        // the fill handle keep working; the input is only interactive in edit
        // mode.
        pointerEvents: isEditing ? 'auto' : 'none',
        cursor: readOnlyColumn ? 'default' : 'cell',
      }}
    />
  )

  /* ------------------------------------------------------------ date editor */

  if (dateType) {
    // Flush a picked value through the existing edit-teardown path: seed the
    // draft, then stopEditing flips `isEditing` off, and the teardown effect
    // commits `draftRef` (now the picked value) via `commitEdit`, which runs
    // `parseTypedValue` and normalises it to a stored ISO string.
    const commitDate = (raw: string) => {
      setDraft(raw)
      selection.stopEditing('down')
    }
    const handleDatePick = (day?: Date) => {
      if (!day) return
      const dayStr = formatDate(day, 'yyyy-MM-dd')
      commitDate(isDatetime ? `${dayStr}T${timeStr || '00:00'}` : dayStr)
    }
    const onTimeChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const next = event.target.value
      setTimeStr(next)
      // Keep the draft in step so an Enter / outside-click commits the new time
      // even when the day is not re-picked.
      const day = toEditableDate(value)
      if (day) setDraft(`${formatDate(day, 'yyyy-MM-dd')}T${next || '00:00'}`)
    }

    return (
      <>
        {textInput}
        {isEditing ? (
          <div
            ref={popoverRef}
            className="absolute left-0 top-full z-[90] mt-1 flex gap-2 rounded-lg border border-slate-200 bg-white p-2 text-sm shadow-lg"
          >
            <DayPicker
              mode="single"
              selected={toEditableDate(value)}
              defaultMonth={toEditableDate(value)}
              onSelect={handleDatePick}
            />
            {isDatetime ? (
              <input
                type="time"
                value={timeStr}
                onChange={onTimeChange}
                className="input-sm h-8 self-start"
                aria-label="Time"
              />
            ) : null}
          </div>
        ) : null}
      </>
    )
  }

  /* ----------------------------------------------------------- mixed editor */

  if (mixed) {
    const tableMeta = table.options.meta as TableMeta | undefined
    const accept = mixedAcceptFor(typeOptions?.acceptedTypes)

    const storeFile = (files: File[]) => {
      const file = files[0]
      if (!file || !tableMeta) return
      // Revoke the outgoing object URL before overwriting, mirroring
      // AttachmentCell's ownership handling.
      releaseAttachment(value)
      tableMeta.updateData(dataIndex, columnId, createAttachment(file))
    }
    const removeValue = () => {
      if (!tableMeta) return
      releaseAttachment(value)
      tableMeta.updateData(dataIndex, columnId, '')
    }

    // A stored attachment renders as media; while the cell is being edited the
    // text editor takes over so it can be replaced with typed text.
    if (isAttachment(value) && !isEditing) {
      const showsImage = isImageAttachment(value)
      return (
        <FileDropzone
          accept={accept}
          onFiles={storeFile}
          noClick
          overlayLabel={showsImage ? 'Drop to replace' : 'Drop file'}
          className="flex min-w-0 items-center gap-1"
        >
          {() => (
            <>
              {showsImage ? (
                imgBroken ? (
                  <div
                    title={`${value.name} (preview unavailable)`}
                    className="flex select-none items-center justify-center rounded-lg border border-slate-300 bg-slate-100 text-slate-500"
                    style={{
                      width: metrics.thumb,
                      height: metrics.thumb,
                      flex: '0 0 auto',
                      fontSize: Math.max(9, Math.round(metrics.thumb / 3)),
                    }}
                  >
                    {initialsOf(value.name)}
                  </div>
                ) : (
                  <img
                    src={value.url}
                    alt={value.name}
                    title={value.name}
                    draggable={false}
                    onError={() => setImgBroken(true)}
                    className="block rounded-lg border border-slate-300 bg-slate-100 object-cover"
                    style={{
                      width: metrics.thumb,
                      height: metrics.thumb,
                      flex: '0 0 auto',
                    }}
                  />
                )
              ) : (
                <a
                  href={value.url}
                  download={value.name}
                  title={`Download ${value.name}`}
                  onClick={(event) => event.stopPropagation()}
                  className="flex min-w-0 flex-1 items-center gap-1 text-slate-900 no-underline"
                >
                  <span className="flex-none text-base">
                    {fileIconFor(value)}
                  </span>
                  <span className="truncate text-xs">{value.name}</span>
                </a>
              )}
              <button
                type="button"
                aria-label="Remove attachment"
                title="Remove"
                onClick={(event) => {
                  event.stopPropagation()
                  removeValue()
                }}
                className="flex-none rounded-lg border border-slate-300 bg-white px-1 py-0.5 text-2xs leading-none text-rose-600 transition-colors sm:hover:bg-rose-50"
              >
                ×
              </button>
            </>
          )}
        </FileDropzone>
      )
    }

    // Text / empty (or editing over an attachment): the normal editor, but a
    // dropped file is captured as an attachment through the same store path.
    return (
      <FileDropzone
        accept={accept}
        onFiles={storeFile}
        noClick
        overlayLabel="Drop file"
        className="w-full"
      >
        {textInput}
      </FileDropzone>
    )
  }

  return textInput
}

export default EditableCell
