// The canonical, ordered list of data-bearing columns, plus the Excel-style
// letter <-> column mapping built on top of it.
//
// This module deliberately imports NOTHING. `tableModels.tsx` pulls in React
// cell components which reach back into `formula.ts`, so the formula engine can
// never import the column definitions directly without creating a cycle.
// Keeping the ordered id list here - as a plain array of strings - breaks that
// knot and makes the letter mapping trivially unit-testable.
//
// ------------------------------------------------------------------------
// LETTERS TRACK DEFINITION ORDER, NOT VISUAL ORDER. THIS IS DELIBERATE.
// ------------------------------------------------------------------------
// `A` is "the first data column as declared below", not "whatever column is
// currently leftmost on screen". Columns in this app can be hidden, reordered,
// pinned and merged. If a letter tracked visible position, hiding one column
// would silently change what every existing `=A1+B2` in the sheet computes -
// a correctness bug, not a cosmetic one. So the mapping is frozen to the base
// definition order and is completely blind to table state.
//
// The leading `select` checkbox column carries no data, so it is excluded:
// `A` is the first *real* column (`avatar`).

// Non-data columns, listed only to document why they are absent below.
export const NON_DATA_COLUMN_IDS = ['select']

// Order must match the leaf columns in `tableModels.tsx`, top to bottom:
//   Name  -> avatar, firstName, lastName, fullName
//   Info  -> age, More Info -> visits, status, progress, salary, attachment
//
// Appending a new column at the end is safe (it just claims the next letter).
// Inserting one in the middle re-letters everything after it, so don't.
export const DATA_COLUMN_IDS = [
  'avatar',
  'firstName',
  'lastName',
  'fullName',
  'age',
  'visits',
  'status',
  'progress',
  'salary',
  'attachment',
]

// Columns whose cell value is an `Attachment` object rather than a scalar.
// Referencing one from a formula is always `#ERROR`: `[object Object]` has no
// sensible numeric reading, and silently yielding 0 would hide the mistake.
export const ATTACHMENT_COLUMN_IDS = ['avatar', 'attachment']

// Columns produced by an `accessorFn` and therefore absent from the raw row
// objects the formula engine reads. Listing their inputs lets a reference to
// `fullName` read something meaningful (`"Ann Smith"`, which then fails
// arithmetic as text should) instead of silently reading 0.
export const DERIVED_COLUMNS: Record<string, string[]> = {
  fullName: ['firstName', 'lastName'],
}

const KNOWN = new Set(DATA_COLUMN_IDS)

export const isKnownColumnId = (id: string): boolean => KNOWN.has(id)

export const isAttachmentColumnId = (id: string): boolean =>
  ATTACHMENT_COLUMN_IDS.includes(id)

// Longer than this is never a real column and is usually a typo that would
// otherwise turn into an absurdly large index.
const MAX_LETTERS = 7

/**
 * 0-based column index -> spreadsheet letters. Bijective base 26, so
 * 0 -> 'A', 25 -> 'Z', 26 -> 'AA', 701 -> 'ZZ', 702 -> 'AAA'.
 * Returns '' for anything that is not a non-negative integer.
 */
export function columnLetters(index: number): string {
  if (!Number.isInteger(index) || index < 0) return ''
  let n = index
  let out = ''
  while (n >= 0) {
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  }
  return out
}

/**
 * Spreadsheet letters -> 0-based column index. Case-insensitive.
 * Returns -1 when `letters` is not a plain run of A-Z of sane length.
 * Note this is a pure letter->number conversion: the index may still be past
 * the end of `DATA_COLUMN_IDS`, which callers must treat as `#ERROR`.
 */
export function lettersToIndex(letters: string): number {
  if (!letters || letters.length > MAX_LETTERS) return -1
  let n = 0
  for (let i = 0; i < letters.length; i++) {
    const code = letters.toUpperCase().charCodeAt(i)
    if (code < 65 || code > 90) return -1
    n = n * 26 + (code - 64)
  }
  return n - 1
}

/** Column id for a 0-based index, or '' when the index is out of range. */
export const columnIdAtIndex = (index: number): string =>
  index >= 0 && index < DATA_COLUMN_IDS.length ? DATA_COLUMN_IDS[index] : ''

/** Column id for spreadsheet letters, or '' when they resolve to nothing. */
export const columnIdFromLetters = (letters: string): string =>
  columnIdAtIndex(lettersToIndex(letters))

/**
 * 0-based letter index of a column id, or -1 when it is not a data column
 * (`select`, or a combined column the user built at runtime). This is the
 * space A1 column references live in, so it - not the on-screen position - is
 * what a horizontal fill has to measure its column delta in.
 */
export const columnIndexForId = (id: string): number =>
  DATA_COLUMN_IDS.indexOf(id)

/** Letters for a column id, or '' when the id is not a known data column. */
export const lettersForColumnId = (id: string): string => {
  const index = columnIndexForId(id)
  return index < 0 ? '' : columnLetters(index)
}

/**
 * Column delta between two column ids, in A1 letter space. 0 when either side
 * is not a data column, which leaves formulas unshifted rather than pointing
 * them somewhere arbitrary.
 */
export function columnDeltaBetween(fromId: string, toId: string): number {
  const from = columnIndexForId(fromId)
  const to = columnIndexForId(toId)
  return from < 0 || to < 0 ? 0 : to - from
}
