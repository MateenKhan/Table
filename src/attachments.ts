// The value stored in `file` / `image` columns. Deliberately a plain,
// serialisable object so it can sit in `data` beside every other cell value.
export type Attachment = {
  name: string
  // MIME type as reported by the browser; '' when unknown.
  mime: string
  size: number
  url: string
  // True only for URLs we minted with URL.createObjectURL, i.e. the ones we
  // are responsible for revoking. Seeded data: / http: URLs are not ours.
  isObjectUrl: boolean
  // Set only inside a .zip export's `view.json`: the archive-relative path
  // (e.g. `files/photo/0-avatar.png`) where this attachment's bytes live. Import
  // reads the bytes back from that path and rebuilds a live URL. Absent at
  // runtime and in a plain .json export.
  archivePath?: string
}

export const isAttachment = (value: unknown): value is Attachment =>
  !!value &&
  typeof value === 'object' &&
  typeof (value as Attachment).url === 'string' &&
  typeof (value as Attachment).name === 'string'

// Every object URL we have handed out and not yet revoked. Cells unmount all
// the time (pagination, filtering), so ownership has to live outside React.
const owned = new Set<string>()

// The original File behind each object URL we minted, kept so callbacks
// (`onUploadToServer`) and the export embedder can reach the real bytes without
// re-reading the blob: URL. Keyed by url; cleared alongside `owned` on release.
const files = new Map<string, File>()

/** The original File for an attachment we minted, or null (seed / imported). */
export const fileForAttachment = (value: unknown): File | null => {
  if (!isAttachment(value)) return null
  return files.get(value.url) ?? null
}

export function createAttachment(file: File): Attachment {
  const url = URL.createObjectURL(file)
  owned.add(url)
  files.set(url, file)
  return {
    name: file.name,
    mime: file.type,
    size: file.size,
    url,
    isObjectUrl: true,
  }
}

// Seed / remote attachments: nothing to revoke, so they are never registered.
export function linkAttachment(
  name: string,
  mime: string,
  url: string,
  size = 0,
): Attachment {
  return { name, mime, size, url, isObjectUrl: false }
}

/**
 * Release the object URL behind a value that is about to be replaced or
 * cleared. Safe to call with anything - empty cells, plain strings and seeded
 * data: URLs are all ignored.
 */
export function releaseAttachment(value: unknown) {
  if (!isAttachment(value) || !value.isObjectUrl) return
  if (!owned.delete(value.url)) return
  files.delete(value.url)
  URL.revokeObjectURL(value.url)
}

// Used when the whole dataset is thrown away (refresh) and on unmount.
//
// `keep` is the set of URLs the INCOMING data still references — import mints its
// new blobs (see `attachmentFromBytes` / the .zip path) BEFORE the old view is
// torn down, so a blanket revoke here would kill the very attachments we are
// about to show. Anything in `keep` is left live; everything else is revoked.
export function releaseAllAttachments(keep?: ReadonlySet<string>) {
  for (const url of [...owned]) {
    if (keep?.has(url)) continue
    URL.revokeObjectURL(url)
    owned.delete(url)
    files.delete(url)
  }
}

/** Every object URL referenced by an attachment value across `data`. */
export function collectAttachmentUrls(
  data: readonly Record<string, unknown>[],
): Set<string> {
  const urls = new Set<string>()
  for (const row of data) {
    for (const value of Object.values(row)) {
      if (isAttachment(value) && value.url) urls.add(value.url)
    }
  }
  return urls
}

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i
const VIDEO_EXTENSIONS = /\.(mp4|webm|ogv|ogg|mov|m4v|mkv|avi)$/i
const AUDIO_EXTENSIONS = /\.(mp3|wav|m4a|aac|flac|oga|opus)$/i

export const isImageAttachment = (value: Attachment) =>
  value.mime.startsWith('image/') || IMAGE_EXTENSIONS.test(value.name)

export const isVideoAttachment = (value: Attachment) =>
  value.mime.startsWith('video/') || VIDEO_EXTENSIONS.test(value.name)

export const isAudioAttachment = (value: Attachment) =>
  value.mime.startsWith('audio/') || AUDIO_EXTENSIONS.test(value.name)

// The broad media bucket the lightbox can play/preview inline.
export const isMediaAttachment = (value: Attachment) =>
  isImageAttachment(value) ||
  isVideoAttachment(value) ||
  isAudioAttachment(value)

/* ------------------------------------------------------------ export embed */

// True for a URL whose bytes already travel with the value: `data:` (inline
// base64) and `http(s):` (a real remote address). A `blob:` object URL is
// session-scoped and dead on any other machine, so it is the only kind the
// export embedder has to turn into a `data:` URL.
const isPortableUrl = (url: string) =>
  url.startsWith('data:') || url.startsWith('http:') || url.startsWith('https:')

/**
 * The raw bytes behind an attachment, or null when they cannot be reached (a
 * dead session blob on another machine). Uses the retained File when we have it,
 * else fetches the URL (works for blob: / data: / same-origin http).
 */
export async function attachmentBytes(
  value: Attachment,
): Promise<Uint8Array | null> {
  const file = files.get(value.url)
  if (file) return new Uint8Array(await file.arrayBuffer())
  try {
    const buf = await (await fetch(value.url)).arrayBuffer()
    return new Uint8Array(buf)
  } catch {
    return null
  }
}

/**
 * Build a live attachment from raw bytes (the .zip import path). Mints an owned
 * object URL and keeps a File beside it so `onUploadToServer` and a later
 * re-export still have the real bytes.
 */
export function attachmentFromBytes(
  bytes: Uint8Array,
  name: string,
  mime: string,
): Attachment {
  const blob = new Blob([bytes as BlobPart], { type: mime || undefined })
  const url = URL.createObjectURL(blob)
  owned.add(url)
  files.set(url, new File([blob], name || 'file', { type: mime || '' }))
  return { name, mime, size: bytes.byteLength, url, isObjectUrl: true }
}

/** Read any Blob/File into a base64 `data:` URL. Rejects on read error. */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('read failed'))
    reader.readAsDataURL(blob)
  })
}

export type EmbedOutcome =
  | { kind: 'inline'; attachment: Attachment } // now carries data: URL bytes
  | { kind: 'referenced'; attachment: Attachment } // left as-is (too big / remote)
  | { kind: 'unavailable'; attachment: Attachment } // blob gone; can't embed

/**
 * Produce an export-safe copy of an attachment. A `blob:` object URL is read
 * back into a `data:` URL so the exported value survives to another machine —
 * unless its size exceeds `embedLimit` (bytes), in which case it is left as a
 * reference so the export file does not balloon. `embedLimit` of `undefined`
 * (the library default) embeds regardless of size — no hard-coded cap.
 * Portable URLs (`data:` / `http(s):`) are returned untouched.
 */
export async function embedAttachment(
  value: Attachment,
  embedLimit?: number,
): Promise<EmbedOutcome> {
  if (isPortableUrl(value.url)) return { kind: 'inline', attachment: value }

  if (typeof embedLimit === 'number' && value.size > embedLimit) {
    return { kind: 'referenced', attachment: value }
  }

  // Prefer the retained File; fall back to re-fetching the blob: URL.
  let blob: Blob | null = files.get(value.url) ?? null
  if (!blob) {
    try {
      blob = await (await fetch(value.url)).blob()
    } catch {
      blob = null
    }
  }
  if (!blob) return { kind: 'unavailable', attachment: value }

  try {
    const url = await blobToDataUrl(blob)
    return {
      kind: 'inline',
      attachment: { ...value, url, isObjectUrl: false },
    }
  } catch {
    return { kind: 'unavailable', attachment: value }
  }
}

export const extensionOf = (name: string) => {
  const at = name.lastIndexOf('.')
  return at < 0 ? '' : name.slice(at + 1).toLowerCase()
}

// Emoji rather than an icon font, so there is nothing to load and nothing to
// break when the page is offline.
const ICONS: Record<string, string> = {
  pdf: '📕',
  doc: '📘',
  docx: '📘',
  xls: '📗',
  xlsx: '📗',
  csv: '📗',
  ppt: '📙',
  pptx: '📙',
  zip: '🗜️',
  rar: '🗜️',
  '7z': '🗜️',
  txt: '📄',
  md: '📄',
  json: '🧾',
  mp3: '🎵',
  wav: '🎵',
  mp4: '🎬',
  mov: '🎬',
}

export function fileIconFor(value: Attachment) {
  if (isImageAttachment(value)) return '🖼️'
  return ICONS[extensionOf(value.name)] ?? '📎'
}

const UNITS = ['B', 'KB', 'MB', 'GB']

export function formatFileSize(bytes: number) {
  if (!bytes) return ''
  let size = bytes
  let unit = 0
  while (size >= 1024 && unit < UNITS.length - 1) {
    size /= 1024
    unit++
  }
  return `${size < 10 && unit > 0 ? size.toFixed(1) : Math.round(size)} ${UNITS[unit]}`
}

// First letters of the file name, used as the fallback when an image URL will
// not load (no network, revoked blob, bad file).
export function initialsOf(name: string) {
  const words = name.replace(/\.[^.]+$/, '').split(/[\s._-]+/).filter(Boolean)
  if (!words.length) return '?'
  return words
    .slice(0, 2)
    .map((word) => word[0]!.toUpperCase())
    .join('')
}
