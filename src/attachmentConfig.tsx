// Configuration + event surface for the `file` / `image` attachment cells.
//
// Cell renderers only receive TanStack's CellContext, so everything a consumer
// wires from <SpreadsheetTable/> props (size limits, the upload-to-server hook,
// the low-level DOM events) reaches the cell through this context rather than
// prop-drilling. App mounts the provider from its props; AttachmentCell and
// FileDropzone read it. All fields are optional — the default is an inert
// config, so the grid behaves exactly as before when nothing is supplied.

import React from 'react'
import type { Attachment } from './attachments'

/** Which cell an upload interaction happened in. */
export type UploadCellInfo = { rowIndex: number; columnId: string }

/** Payload for the size-limit flow. `limit` is the resolved cap in bytes. */
export type FileSizeLimitInfo = {
  file: File
  limit: number
  rowIndex: number
  columnId: string
}

/**
 * A consumer's decision when a file is over the limit: `true` keeps the file
 * (accept anyway), `false` rejects it (discard). May be async — return a
 * Promise to show your own dialog and resolve it later. When no handler is
 * supplied the grid shows a built-in, fully themeable agree/reject popup.
 */
export type FileSizeLimitDecision = boolean | Promise<boolean>

/** Payload for the (behaviour-free) upload-to-server button. */
export type UploadToServerInfo = {
  attachment: Attachment
  // The original File when the grid minted the attachment; null for a value
  // that arrived already as a data:/http URL (seed or imported).
  file: File | null
  rowIndex: number
  columnId: string
}

/** A low-level upload DOM event, with the cell it occurred in. */
export type UploadEventHandler<E> = (event: E, info: UploadCellInfo) => void

export type AttachmentConfig = {
  /**
   * Grid-wide max upload size in BYTES. A per-column `meta.maxFileSize` wins
   * over this. Undefined = no limit (there is no hard-coded default).
   */
  maxFileSize?: number
  /**
   * Called when a picked/dropped/pasted file exceeds the limit. Return (or
   * resolve) `true` to keep it, `false` to discard. Omit to get the built-in
   * agree/reject popup instead.
   */
  onFileSizeLimitExceeded?: (info: FileSizeLimitInfo) => FileSizeLimitDecision
  /**
   * When provided, an "upload to server" button appears on filled attachment
   * cells. Clicking it calls this with the attachment + original File. The grid
   * ships NO networking — you own the upload.
   */
  onUploadToServer?: (info: UploadToServerInfo) => void

  // ── Low-level upload interaction events (all optional) ──────────────────
  onUploadClick?: UploadEventHandler<React.MouseEvent>
  onUploadKeyDown?: UploadEventHandler<React.KeyboardEvent>
  onUploadMouseDown?: UploadEventHandler<React.MouseEvent>
  onUploadMouseUp?: UploadEventHandler<React.MouseEvent>
  onUploadDrop?: UploadEventHandler<React.DragEvent>
}

const EMPTY: AttachmentConfig = {}

const AttachmentConfigCtx = React.createContext<AttachmentConfig>(EMPTY)

export function AttachmentConfigProvider({
  config,
  children,
}: {
  config: AttachmentConfig
  children: React.ReactNode
}) {
  return (
    <AttachmentConfigCtx.Provider value={config}>
      {children}
    </AttachmentConfigCtx.Provider>
  )
}

/** Read the attachment config (never null — defaults to an inert config). */
export const useAttachmentConfig = (): AttachmentConfig =>
  React.useContext(AttachmentConfigCtx)

/** The effective size limit for a column: per-column meta wins over grid-wide. */
export const resolveMaxFileSize = (
  columnLimit: number | undefined,
  gridLimit: number | undefined,
): number | undefined => columnLimit ?? gridLimit
