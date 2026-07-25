import { CellContext, RowData } from '@tanstack/react-table'
import React from 'react'
import {
  Attachment,
  createAttachment,
  fileIconFor,
  formatFileSize,
  initialsOf,
  isAttachment,
  isImageAttachment,
  releaseAttachment,
} from '../attachments'
import { useThumbnailMetrics } from '../thumbnailSize'
import { useCellSelection } from '../useCellSelection'
import { TableMeta } from '../tableModels'
import AttachmentLightbox from './AttachmentLightbox'
import FileDropzone from './FileDropzone'

// Cell renderer for `image` and `file` columns. Uploads arrive three ways:
// clicking the cell (file picker via FileDropzone), dropping a file onto it, or
// pasting while the cell is the active one in the grid.
export function AttachmentCell<T extends RowData>({
  getValue,
  row,
  column,
  table,
}: CellContext<T, unknown>) {
  const options = column.columnDef.meta
  const isImageColumn = options?.type === 'image'
  const metrics = useThumbnailMetrics()
  const selection = useCellSelection()

  const raw = getValue()
  const value = isAttachment(raw) ? raw : null

  const [isBroken, setIsBroken] = React.useState(false)
  const [isPreviewOpen, setIsPreviewOpen] = React.useState(false)

  // The handlers below live in listeners and callbacks, so they read the
  // current value through a ref rather than a captured one.
  const valueRef = React.useRef(value)
  valueRef.current = value

  React.useEffect(() => {
    setIsBroken(false)
  }, [value?.url])

  const isActive = selection?.activeKey === `${row.id}::${column.id}`
  // Whether this cell has something the lightbox can show (an image value, or an
  // image column with any value). Computed up front so the keyboard-preview
  // effect below can read it through a ref regardless of which branch renders.
  const canPreview = !!value && (isImageColumn || isImageAttachment(value))

  // Keyboard preview: pressing Enter on the active attachment cell bumps the
  // selection layer's `previewNonce`; the active, previewable cell opens its
  // lightbox in response. Refs keep the effect keyed only on the nonce.
  const isActiveRef = React.useRef(isActive)
  isActiveRef.current = isActive
  const canPreviewRef = React.useRef(canPreview)
  canPreviewRef.current = canPreview
  const previewNonce = selection?.previewNonce ?? 0
  React.useEffect(() => {
    if (!previewNonce) return
    if (isActiveRef.current && canPreviewRef.current) setIsPreviewOpen(true)
  }, [previewNonce])

  // Closing returns focus to the grid sink so arrow-key navigation resumes
  // where the preview was opened from.
  const closePreview = () => {
    setIsPreviewOpen(false)
    selection?.focusGrid()
  }

  const store = (next: Attachment | null) => {
    const meta = table.options.meta as TableMeta | undefined
    if (!meta) return
    // Revoke before overwriting: the old blob is unreachable from here on.
    releaseAttachment(valueRef.current)
    meta.updateData(row.index, column.id, next)
  }

  const takeFile = (file: File | null | undefined) => {
    if (!file) return
    // An image column only ever accepts images, however the file arrived.
    if (isImageColumn && !file.type.startsWith('image/')) return
    store(createAttachment(file))
  }

  // FileDropzone hands us the accepted files (drop or picker); these columns
  // hold a single attachment, so only the first is stored. It flows through the
  // same `createAttachment` -> `store` path as paste, so object-URL ownership
  // and revocation stay identical to before.
  const handleFiles = (files: File[]) => takeFile(files[0])

  const accept = options?.accept ?? (isImageColumn ? 'image/*' : undefined)

  // Paste is a window-level event, so only the active cell may claim it.
  React.useEffect(() => {
    if (!isActive) return

    const onPaste = (event: ClipboardEvent) => {
      const file = event.clipboardData?.files?.[0]
      if (!file) return
      event.preventDefault()
      takeFile(file)
    }

    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [isActive, row.index, column.id])

  /* ------------------------------------------------------------ empty cell */

  if (!value) {
    // Aggregate rows have no backing data row, so there is nothing to upload
    // into - render a placeholder rather than an affordance that would write
    // to the wrong index.
    if (row.getIsGrouped()) return null

    return (
      <FileDropzone
        accept={accept}
        onFiles={handleFiles}
        title={isImageColumn ? 'Click, drop or paste an image' : 'Click, drop or paste a file'}
        overlayLabel={isImageColumn ? 'Drop image' : 'Drop file'}
        className="flex items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 text-xs text-slate-500 cursor-pointer select-none transition-colors sm:hover:border-slate-400"
        style={{ minHeight: metrics.thumb }}
      >
        {({ isDragActive }) =>
          isDragActive
            ? null
            : metrics.thumb >= 40
              ? isImageColumn
                ? '+ Image'
                : '+ File'
              : '+'
        }
      </FileDropzone>
    )
  }

  /* ------------------------------------------------------------ with value */

  const showsImage = isImageColumn || isImageAttachment(value)
  // Compact hairline action chips. Replace is neutral; remove is destructive,
  // so it carries the rose danger tone at rest (§2).
  const actionBtn =
    'rounded-lg border border-slate-300 bg-white text-2xs leading-none px-1 py-0.5 cursor-pointer transition-colors active:scale-[0.97]'
  const replaceBtnClass = `${actionBtn} text-slate-500 sm:hover:bg-slate-50`
  const removeBtnClass = `${actionBtn} text-rose-600 sm:hover:bg-rose-50`

  const renderActions = (open: () => void) => (
    <div
      style={{
        display: 'flex',
        flexDirection: metrics.thumb >= 40 ? 'column' : 'row',
        gap: '0.125rem',
        flex: '0 0 auto',
      }}
    >
      <button
        type="button"
        title="Replace"
        aria-label="Replace attachment"
        onClick={(event) => {
          event.stopPropagation()
          open()
        }}
        className={replaceBtnClass}
      >
        ↻
      </button>
      <button
        type="button"
        title="Remove"
        aria-label="Remove attachment"
        onClick={(event) => {
          event.stopPropagation()
          store(null)
        }}
        className={removeBtnClass}
      >
        ×
      </button>
    </div>
  )

  const thumbnail = showsImage ? (
    isBroken ? (
      <div
        onClick={(event) => {
          event.stopPropagation()
          setIsPreviewOpen(true)
        }}
        title={`${value.name} (preview unavailable)`}
        className="flex items-center justify-center rounded-lg border border-slate-300 bg-slate-100 text-slate-500 cursor-zoom-in select-none"
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
        onError={() => setIsBroken(true)}
        onClick={(event) => {
          event.stopPropagation()
          setIsPreviewOpen(true)
        }}
        className="block rounded-lg border border-slate-300 bg-slate-100 object-cover cursor-zoom-in"
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
      className="flex items-center gap-1 min-w-0 flex-1 text-slate-900 no-underline"
    >
      <span className="text-base flex-none">{fileIconFor(value)}</span>
      <span className="truncate text-xs">{value.name}</span>
      {metrics.thumb >= 40 && value.size ? (
        <span className="text-2xs text-slate-500 flex-none">
          {formatFileSize(value.size)}
        </span>
      ) : null}
    </a>
  )

  return (
    <FileDropzone
      accept={accept}
      onFiles={handleFiles}
      // Clicking the thumbnail opens the lightbox, so the drop area itself must
      // not open the picker; the re-upload (↻) button drives `open` instead.
      noClick
      overlayLabel={showsImage ? 'Drop to replace' : 'Drop file'}
      className="flex items-center gap-1 min-w-0"
    >
      {({ open }) => (
        <>
          {thumbnail}
          {renderActions(open)}
          {isPreviewOpen && showsImage ? (
            <AttachmentLightbox
              src={value.url}
              name={value.name}
              onClose={closePreview}
            />
          ) : null}
        </>
      )}
    </FileDropzone>
  )
}

export default AttachmentCell
