// TSV serialisation plus the browser clipboard plumbing behind Ctrl+C / X / V.
//
// TSV (tab between cells, newline between rows, Excel-style quoting) is the
// lingua franca of spreadsheets: it is what Excel, Google Sheets and Numbers
// all put on the clipboard as `text/plain`, so writing it is what makes a range
// copied here paste there and vice versa.
//
// This module deliberately touches `document` / `navigator` only from inside
// function bodies, so it can be imported by the node test runner.

export type ClipboardGrid = string[][]

// Excel quotes a field as soon as it contains a delimiter or a quote.
const NEEDS_QUOTES = /[\t\n\r"]/

const quoteField = (field: string) =>
  NEEDS_QUOTES.test(field) ? `"${field.replace(/"/g, '""')}"` : field

/** Rows of cell text -> one TSV string. Rows are joined with `\n`. */
export function serializeTSV(grid: ClipboardGrid): string {
  return grid.map((row) => row.map(quoteField).join('\t')).join('\n')
}

/**
 * TSV -> rows of cell text. Understands the quoting `serializeTSV` emits, which
 * is also what Excel and Sheets emit: a field that starts with `"` runs until
 * the matching close quote, `""` inside it is a literal quote, and tabs and
 * newlines inside the quotes are data rather than delimiters.
 *
 * Line endings may be `\n`, `\r\n` or a lone `\r`. A single trailing newline
 * (which Excel always appends) does not produce a phantom last row.
 */
export function parseTSV(text: string): ClipboardGrid {
  if (!text) return []

  const rows: ClipboardGrid = []
  let row: string[] = []
  let field = ''
  // Only a quote in the first position of a field opens a quoted field, so a
  // stray quote mid-value (`5" pipe`) stays literal.
  let atFieldStart = true
  let quoted = false
  let i = 0

  const endField = () => {
    row.push(field)
    field = ''
    atFieldStart = true
    quoted = false
  }

  while (i < text.length) {
    const char = text[i]

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        quoted = false
        atFieldStart = false
        i++
        continue
      }
      field += char
      i++
      continue
    }

    if (char === '"' && atFieldStart) {
      quoted = true
      atFieldStart = false
      i++
      continue
    }

    if (char === '\t') {
      endField()
      i++
      continue
    }

    if (char === '\n' || char === '\r') {
      endField()
      rows.push(row)
      row = []
      i += char === '\r' && text[i + 1] === '\n' ? 2 : 1
      continue
    }

    field += char
    atFieldStart = false
    i++
  }

  endField()
  rows.push(row)

  // Drop the empty row a trailing newline leaves behind.
  const last = rows[rows.length - 1]
  if (rows.length > 1 && last.length === 1 && last[0] === '') rows.pop()

  return rows
}

/* ------------------------------------------------------- internal payload */

// What was copied, in the grid's own terms. Custom clipboard MIME types are
// still not portable, so instead of trying to smuggle a second flavour past the
// browser we keep the payload here and match it back by its exact text. A paste
// whose text is byte-identical to what we last copied is ours (formulas and
// all); anything else came from another app and is treated as plain TSV.
export type InternalCell = {
  // Position inside the copied rectangle.
  rowOffset: number
  colOffset: number
  // Where it came from, so relative references can be translated on paste.
  dataIndex: number
  columnId: string
  value: unknown
  // Formula source, when the cell held one.
  formula?: string
}

export type InternalCopy = {
  text: string
  height: number
  width: number
  cells: InternalCell[]
  // True for Ctrl+X. Recorded for completeness; paste treats cut like copy.
  cut: boolean
}

let internalCopy: InternalCopy | null = null

export const rememberInternalCopy = (copy: InternalCopy | null) => {
  internalCopy = copy
}

/** The internal payload iff `text` is exactly what we put on the clipboard. */
export const takeInternalCopy = (text: string): InternalCopy | null =>
  internalCopy && internalCopy.text === text ? internalCopy : null

/** Last internal payload regardless of text - the clipboard-denied fallback. */
export const lastInternalCopy = (): InternalCopy | null => internalCopy

/* --------------------------------------------------------- browser access */

/**
 * Put `text` on the system clipboard. Tries the async Clipboard API first and
 * falls back to a hidden textarea + `document.execCommand('copy')` when it is
 * missing or the permission is refused. Resolves false when both fail, so the
 * caller can carry on rather than throwing into a keyboard handler.
 */
export async function writeClipboardText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Permission denied, insecure context, or the document lost focus.
  }
  return legacyCopy(text)
}

function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined' || !document.body) return false

  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  // Off-screen but still focusable: `display: none` would make `select()` a
  // no-op, and scrolling the page under the user would be worse than the copy
  // failing.
  area.style.position = 'fixed'
  area.style.top = '-1000px'
  area.style.left = '-1000px'
  area.style.opacity = '0'
  document.body.appendChild(area)

  const selection = document.getSelection()
  const previous =
    selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null

  area.select()
  let ok = false
  try {
    ok = document.execCommand('copy')
  } catch {
    ok = false
  }

  document.body.removeChild(area)
  if (previous && selection) {
    selection.removeAllRanges()
    selection.addRange(previous)
  }
  return ok
}

/**
 * Read the clipboard asynchronously. Only used when the native `paste` event
 * carried no text - that event needs no permission, `readText` does. Resolves
 * null when the read is unavailable or refused.
 */
export async function readClipboardText(): Promise<string | null> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
      const text = await navigator.clipboard.readText()
      return text || null
    }
  } catch {
    // Denied or unsupported - the caller falls back to the internal payload.
  }
  return null
}
