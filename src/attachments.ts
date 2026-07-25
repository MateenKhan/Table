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
}

export const isAttachment = (value: unknown): value is Attachment =>
  !!value &&
  typeof value === 'object' &&
  typeof (value as Attachment).url === 'string' &&
  typeof (value as Attachment).name === 'string'

// Every object URL we have handed out and not yet revoked. Cells unmount all
// the time (pagination, filtering), so ownership has to live outside React.
const owned = new Set<string>()

export function createAttachment(file: File): Attachment {
  const url = URL.createObjectURL(file)
  owned.add(url)
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
  URL.revokeObjectURL(value.url)
}

// Used when the whole dataset is thrown away (refresh) and on unmount.
export function releaseAllAttachments() {
  owned.forEach((url) => URL.revokeObjectURL(url))
  owned.clear()
}

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i

export const isImageAttachment = (value: Attachment) =>
  value.mime.startsWith('image/') || IMAGE_EXTENSIONS.test(value.name)

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
