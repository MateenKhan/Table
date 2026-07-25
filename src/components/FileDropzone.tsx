import React from 'react'
import { useDropzone, type Accept } from 'react-dropzone'
import { UploadCloud } from 'lucide-react'

// State handed to a render-prop child so callers can wire their own affordances
// (e.g. a "replace" button) to the file dialog without owning a hidden input.
export type FileDropzoneState = {
  isDragActive: boolean
  open: () => void
}

export type FileDropzoneProps = {
  // Picker-style accept string, e.g. 'image/*' or '.pdf,.doc'. Undefined = any.
  accept?: string
  // Called with the files the drop / picker yielded. The caller stores them
  // (here: via attachments.ts). Rejected files (wrong type) never arrive.
  onFiles: (files: File[]) => void
  // Resting content: a thumbnail, a file chip, an empty-state hint. May be a
  // render prop so the child can reach `open` (used by the re-upload button).
  children?: React.ReactNode | ((state: FileDropzoneState) => React.ReactNode)
  className?: string
  multiple?: boolean
  // Disable click-to-open on the whole area. Use when clicking the resting
  // content means something else (opening a lightbox) and a dedicated control
  // calls `open` instead.
  noClick?: boolean
  // Passthroughs for the resting box.
  title?: string
  style?: React.CSSProperties
  // Centred hint shown only while a file is dragged over the area.
  overlayLabel?: string
}

// react-dropzone v14 wants accept as Record<mime, ext[]>, not the picker's
// comma string. Bare extensions attach to each listed mime, or to a permissive
// binary bucket when only extensions were given (attr-accept still matches them
// by extension, so the filtering stays correct).
function toAcceptProp(accept?: string): Accept | undefined {
  if (!accept) return undefined
  const mimes: string[] = []
  const exts: string[] = []
  for (const raw of accept.split(',')) {
    const token = raw.trim()
    if (!token) continue
    if (token.includes('/')) mimes.push(token)
    else if (token.startsWith('.')) exts.push(token)
  }
  const map: Accept = {}
  if (mimes.length) {
    for (const mime of mimes) map[mime] = exts.length ? [...exts] : []
  } else if (exts.length) {
    map['application/octet-stream'] = exts
  }
  return Object.keys(map).length ? map : undefined
}

// A headless react-dropzone wrapper, the shared UI-styled: a hairline-friendly drop
// target that flips to an accent "landing" highlight while a file is over it.
// The highlight is a pure colour/outline change (no looping motion), so it is
// reduced-motion safe on its own; the shared transition-colors is zeroed by the
// global prefers-reduced-motion rule anyway.
export function FileDropzone({
  accept,
  onFiles,
  children,
  className,
  multiple = false,
  noClick = false,
  title,
  style,
  overlayLabel = 'Drop here',
}: FileDropzoneProps) {
  const acceptProp = React.useMemo(() => toAcceptProp(accept), [accept])

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    accept: acceptProp,
    multiple,
    noClick,
    // The grid owns keyboard nav / paste-to-upload, so the drop area must never
    // grab focus or claim Enter / Space (that would also keep it out of the tab
    // order, matching the cell's original behaviour).
    noKeyboard: true,
    // Stop drag / drop events at this element so the grid's own <td> handlers do
    // not also react to the same drop (react-dropzone only does this when asked).
    noDragEventsBubbling: true,
    onDrop: (acceptedFiles) => {
      if (acceptedFiles.length) onFiles(acceptedFiles as File[])
    },
  })

  const rootClassName = [
    'relative',
    className,
    isDragActive
      ? 'outline-dashed outline-2 outline-offset-2 outline-accent-500 bg-accent-500/10'
      : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      {...getRootProps({
        className: rootClassName,
        title,
        style,
      })}
    >
      <input {...getInputProps()} />
      {typeof children === 'function'
        ? children({ isDragActive, open })
        : children}

      {isDragActive ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-1 overflow-hidden rounded-lg text-2xs font-medium text-accent-600"
        >
          <UploadCloud size={14} strokeWidth={2} />
          <span className="truncate">{overlayLabel}</span>
        </div>
      ) : null}
    </div>
  )
}

export default FileDropzone
