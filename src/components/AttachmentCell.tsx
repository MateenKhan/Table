import { CellContext, RowData } from '@tanstack/react-table'
import { UploadCloud } from 'lucide-react'
import React from 'react'
import {
  Attachment,
  createAttachment,
  fileForAttachment,
  fileIconFor,
  formatFileSize,
  initialsOf,
  isAttachment,
  isAudioAttachment,
  isImageAttachment,
  isVideoAttachment,
  releaseAttachment,
} from '../attachments'
import {
  resolveMaxFileSize,
  useAttachmentConfig,
  type UploadCellInfo,
} from '../attachmentConfig'
import { resolveColumnMeta } from '../columnTypeOverrides'
import { useThumbnailMetrics } from '../thumbnailSize'
import { useCellSelection } from '../useCellSelection'
import { useConfirm } from '../ui'
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
  // Effective options = base meta + any runtime type override, so a column
  // retyped to file/image (or given a maxFileSize) at runtime is respected.
  const options = resolveColumnMeta(column.id, column.columnDef.meta)
  const isImageColumn = options?.type === 'image'
  const metrics = useThumbnailMetrics()
  const selection = useCellSelection()
  const config = useAttachmentConfig()
  const confirm = useConfirm()

  const raw = getValue()
  const value = isAttachment(raw) ? raw : null

  // Which player the lightbox should use for the current value.
  const previewKind: 'image' | 'video' | 'audio' | null = !value
    ? null
    : isVideoAttachment(value)
      ? 'video'
      : isAudioAttachment(value)
        ? 'audio'
        : isImageColumn || isImageAttachment(value)
          ? 'image'
          : null

  // The cell this renderer is for, handed to every low-level upload event.
  const cellInfo: UploadCellInfo = { rowIndex: row.index, columnId: column.id }

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
  // Whether this cell has something the lightbox can show (image, video or
  // audio). Computed up front so the keyboard-preview effect below can read it
  // through a ref regardless of which branch renders.
  const canPreview = previewKind !== null

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

  // The effective size cap: per-column meta wins over the grid-wide prop, and
  // `undefined` means no limit (there is no built-in default).
  const limit = resolveMaxFileSize(options?.maxFileSize, config.maxFileSize)

  // Decide whether an over-limit file may be kept. A consumer
  // `onFileSizeLimitExceeded` handler wins (it may return a Promise so it can
  // show its own UI); otherwise the built-in, themeable agree/reject popup runs.
  const passesSizeGate = async (file: File): Promise<boolean> => {
    if (typeof limit !== 'number' || file.size <= limit) return true
    const info = { file, limit, rowIndex: row.index, columnId: column.id }
    if (config.onFileSizeLimitExceeded) {
      return !!(await config.onFileSizeLimitExceeded(info))
    }
    return confirm({
      tone: 'default',
      title: 'File is larger than allowed',
      message: `“${file.name}” is ${formatFileSize(file.size)}, over the ${formatFileSize(
        limit,
      )} limit for this column. Add it anyway?`,
      confirmLabel: 'Add anyway',
      cancelLabel: 'Reject',
    })
  }

  const takeFile = async (file: File | null | undefined) => {
    if (!file) return
    // An image column only ever accepts images, however the file arrived.
    if (isImageColumn && !file.type.startsWith('image/')) return
    if (!(await passesSizeGate(file))) return
    store(createAttachment(file))
  }

  // FileDropzone hands us the accepted files (drop or picker); these columns
  // hold a single attachment, so only the first is stored. It flows through the
  // same `createAttachment` -> `store` path as paste, so object-URL ownership
  // and revocation stay identical to before.
  const handleFiles = (files: File[]) => {
    void takeFile(files[0])
  }

  // Fire a low-level upload event, if the consumer wired one for this kind.
  const uploadEvents = {
    onClick: (e: React.MouseEvent) => config.onUploadClick?.(e, cellInfo),
    onKeyDown: (e: React.KeyboardEvent) => config.onUploadKeyDown?.(e, cellInfo),
    onMouseDown: (e: React.MouseEvent) =>
      config.onUploadMouseDown?.(e, cellInfo),
    onMouseUp: (e: React.MouseEvent) => config.onUploadMouseUp?.(e, cellInfo),
    onDrop: (e: React.DragEvent) => config.onUploadDrop?.(e, cellInfo),
  }

  // The upload-to-server button only exists when a consumer wired the hook.
  const emitUploadToServer = (event: React.MouseEvent) => {
    event.stopPropagation()
    if (!value) return
    config.onUploadToServer?.({
      attachment: value,
      file: fileForAttachment(value),
      rowIndex: row.index,
      columnId: column.id,
    })
  }

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
        onRootClick={uploadEvents.onClick}
        onRootKeyDown={uploadEvents.onKeyDown}
        onRootMouseDown={uploadEvents.onMouseDown}
        onRootMouseUp={uploadEvents.onMouseUp}
        onDropEvent={uploadEvents.onDrop}
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
  const uploadBtnClass = `${actionBtn} inline-flex items-center justify-center text-sky-600 sm:hover:bg-sky-50`

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
      {/* Upload-to-server: only present when the consumer wired the hook. The
          grid carries NO networking — clicking just emits onUploadToServer. */}
      {config.onUploadToServer ? (
        <button
          type="button"
          title="Upload to server"
          aria-label="Upload attachment to server"
          onClick={emitUploadToServer}
          className={uploadBtnClass}
        >
          <UploadCloud size={12} strokeWidth={2} />
        </button>
      ) : null}
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
  ) : canPreview ? (
    // Playable media (video / audio) in a `file` column: the chip opens the
    // lightbox player on click rather than downloading.
    <button
      type="button"
      title={`Play ${value.name}`}
      onClick={(event) => {
        event.stopPropagation()
        setIsPreviewOpen(true)
      }}
      className="flex items-center gap-1 min-w-0 flex-1 text-slate-900 bg-transparent cursor-zoom-in text-left"
    >
      <span className="text-base flex-none">{fileIconFor(value)}</span>
      <span className="truncate text-xs">{value.name}</span>
      {metrics.thumb >= 40 && value.size ? (
        <span className="text-2xs text-slate-500 flex-none">
          {formatFileSize(value.size)}
        </span>
      ) : null}
    </button>
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
      onRootClick={uploadEvents.onClick}
      onRootKeyDown={uploadEvents.onKeyDown}
      onRootMouseDown={uploadEvents.onMouseDown}
      onRootMouseUp={uploadEvents.onMouseUp}
      onDropEvent={uploadEvents.onDrop}
    >
      {({ open }) => (
        <>
          {thumbnail}
          {renderActions(open)}
          {isPreviewOpen && previewKind ? (
            <AttachmentLightbox
              src={value.url}
              name={value.name}
              kind={previewKind}
              onClose={closePreview}
            />
          ) : null}
        </>
      )}
    </FileDropzone>
  )
}

export default AttachmentCell
