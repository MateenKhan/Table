// The Excel-style letter <-> column mapping, and the live "letter space" it is
// built on.
//
// This module deliberately imports NOTHING. `tableModels.tsx` pulls in React
// cell components which reach back into `formula.ts`, so the formula engine can
// never import the column definitions directly without creating a cycle.
// Keeping the letter space here - plain arrays of strings plus a tiny registry -
// breaks that knot and makes the mapping trivially unit-testable.
//
// ------------------------------------------------------------------------
// ONE LETTER SPACE. THE HEADER AND THE ENGINE READ THE SAME ARRAY.
// ------------------------------------------------------------------------
// The letters a user reads off the top of the grid and the letters `=C2` binds
// have to be the same mapping. They used to be two, and the seam was silent:
// the engine resolved letters against a hard-coded list of the DEMO schema's
// columns, while the header fell back to on-screen position for any column that
// list did not mention. On a blank sheet (`col1..colN`) the grid therefore drew
// `A B C D E F` over columns the engine had never heard of - `=C2` resolved to
// `lastName`, which does not exist there, the read came back `undefined`, and
// `=C2+C3` quietly computed 0. A wrong answer with no error on it.
//
// So the letter space is REGISTERED from whatever schema is actually live (see
// `observeLetterColumn`), and every resolver below reads that one array. Blank
// sheets, imported schemas and columns added at runtime all land in it.
//
// ------------------------------------------------------------------------
// LETTERS STILL TRACK DEFINITION ORDER, NOT VISUAL ORDER. THIS IS DELIBERATE.
// ------------------------------------------------------------------------
// `A` is "the first data column this sheet declared", not "whatever column is
// currently leftmost on screen". Columns in this app can be hidden, reordered,
// pinned, merged and deleted. If a letter tracked visible position, hiding one
// column would silently change what every existing `=A1+B2` in the sheet
// computes - a correctness bug, not a cosmetic one.
//
// Registration is therefore APPEND-ONLY: an id that is already in the space
// keeps the letter it has forever, and only genuinely new ids claim a letter,
// at the end. Two visible consequences, both preferred to re-lettering:
//   • deleting a middle column leaves a gap in the header row (`A B D E`)
//     rather than shifting `D` onto `C` and changing what `=C2` reads;
//   • a column inserted in the middle shows the NEXT free letter rather than
//     the one its position suggests.
// The one thing that does clear the space is a wholesale schema swap (nothing
// on screen is a column we have ever seen) - see `observeLetterColumn`.
//
// The leading `select` checkbox column carries no data, so it is excluded:
// `A` is the first *real* column.

// Non-data columns. Never claim a letter, wherever they appear.
export const NON_DATA_COLUMN_IDS = ['select']

// The built-in demo schema's data columns, in definition order - matching the
// leaf columns in `tableModels.tsx`, top to bottom:
//   Name  -> avatar, firstName, lastName, fullName
//   Info  -> age, More Info -> visits, status, progress, salary, attachment
//
// This is the DEFAULT letter space: what headless callers (the unit tests, the
// custom-function body validator, any evaluation that runs before the grid has
// painted once) resolve against until a live schema registers itself.
// `columnOrder.test.ts` guards it against drifting from `tableModels`.
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

/**
 * The letter space every sheet saved BEFORE the space went live was authored
 * against: the demo schema, frozen. This is a separate copy of the array above
 * on purpose - appending a column to `tableModels` must not retroactively
 * change what an `=C2` stored last year meant. `migrateLegacyA1Formulas` in
 * `formula.ts` reads it to rewrite those references; nothing else should.
 */
export const LEGACY_LETTER_SPACE: readonly string[] = [
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

/* ---------------------------------------------------------- the letter space */

// The live space, plus an id -> index map so the hot resolvers stay O(1).
let letterSpace: string[] = [...DATA_COLUMN_IDS]
let letterIndex = new Map<string, number>(letterSpace.map((id, i) => [id, i]))

/** The ordered column ids letters currently map onto. Read-only by contract. */
export const getLetterSpace = (): readonly string[] => letterSpace

/** How many letters currently resolve to a real column. */
export const letterSpaceLength = (): number => letterSpace.length

/**
 * Replace the letter space outright. Duplicates and non-data ids are dropped so
 * a caller can hand over a raw leaf-id list without pre-cleaning it. This is the
 * blunt instrument - `observeLetterColumn` is what the running grid uses.
 */
export function setLetterSpace(ids: readonly string[]): void {
  const next: string[] = []
  const seen = new Set<string>()
  for (const id of ids) {
    if (!id || seen.has(id) || NON_DATA_COLUMN_IDS.includes(id)) continue
    seen.add(id)
    next.push(id)
  }
  letterSpace = next
  letterIndex = new Map(next.map((id, i) => [id, i]))
}

/** Back to the built-in schema. Used by tests to undo a `setLetterSpace`. */
export const resetLetterSpace = (): void => setLetterSpace(DATA_COLUMN_IDS)

// Buffer for the in-flight header pass (see below).
let pass: string[] = []

/**
 * Register one column of the header's letter row into the letter space.
 *
 * THIS IS THE SEAM. The grid renders its letter row left to right, one call per
 * data column, with `positionalIndex` counting data columns only - so index 0
 * opens a fresh pass and the calls after it enumerate the live schema in order.
 * Registering from the very function that decides what letter to *draw* is what
 * makes "the letter on screen" and "the letter `=C2` binds" the same fact by
 * construction; they cannot drift again without this function being bypassed.
 *
 * Merge rules (see the append-only note at the top of the file):
 *  - an id already in the space keeps its letter, so hiding, reordering or
 *    deleting a column never re-letters its neighbours;
 *  - a new id claims the next free letter at the end;
 *  - a pass in which NOTHING is a column we have seen means the schema was
 *    replaced wholesale (Delete-all into a blank sheet, or an imported clone),
 *    and the old letters describe columns that no longer exist - so the space
 *    starts over. This is also what keeps a stale space self-healing: whatever
 *    is actually on screen always wins in the end.
 *
 * Cheap and idempotent: the common case is a few `Map.has` lookups per column
 * per render, and re-registering an unchanged schema mutates nothing.
 */
export function observeLetterColumn(columnId: string, positionalIndex: number): void {
  if (!columnId || NON_DATA_COLUMN_IDS.includes(columnId)) return
  if (!Number.isInteger(positionalIndex) || positionalIndex < 0) return

  // Truncate rather than push, so a render that is interrupted and restarted
  // part way through cannot leave a stale tail in the buffer.
  if (positionalIndex === 0) pass = []
  else if (pass.length > positionalIndex) pass.length = positionalIndex
  pass[positionalIndex] = columnId

  const live = pass.filter(Boolean)
  if (!live.length) return

  if (!live.some((id) => letterIndex.has(id))) {
    setLetterSpace(live)
    return
  }

  const additions = live.filter((id) => !letterIndex.has(id))
  if (additions.length) setLetterSpace([...letterSpace, ...additions])
}

type ColumnDefLike = { id?: unknown; accessorKey?: unknown; columns?: unknown }

/**
 * The data column ids of a column tree, leaves in document order - the order
 * letters are assigned in. Accepts anything shaped like a TanStack `ColumnDef`
 * or a serialised `ColumnSchemaNode`; both carry `id` / `accessorKey` /
 * `columns`, which is what lets the persistence and snapshot loaders work out a
 * stored sheet's own letter space without importing either module (and without
 * this file growing its first import).
 */
export function dataColumnIdsFromDefs(defs: unknown): string[] {
  const out: string[] = []

  const walk = (nodes: unknown): void => {
    if (!Array.isArray(nodes)) return
    for (const raw of nodes) {
      if (!raw || typeof raw !== 'object') continue
      const def = raw as ColumnDefLike
      if (Array.isArray(def.columns) && def.columns.length) {
        walk(def.columns)
        continue
      }
      const id = typeof def.id === 'string' ? def.id : def.accessorKey
      if (typeof id !== 'string' || !id) continue
      if (NON_DATA_COLUMN_IDS.includes(id) || out.includes(id)) continue
      out.push(id)
    }
  }

  walk(defs)
  return out
}

/* ------------------------------------------------------------- the mapping */

/** True when `id` is a data column of the LIVE schema (so it owns a letter). */
export const isKnownColumnId = (id: string): boolean => letterIndex.has(id)

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
 * the end of the letter space, which callers must treat as `#ERROR`.
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
  index >= 0 && index < letterSpace.length ? letterSpace[index] : ''

/** Column id for spreadsheet letters, or '' when they resolve to nothing. */
export const columnIdFromLetters = (letters: string): string =>
  columnIdAtIndex(lettersToIndex(letters))

/**
 * 0-based letter index of a column id, or -1 when it holds no letter (`select`,
 * or a combined column the user built at runtime). This is the space A1 column
 * references live in, so it - not the on-screen position - is what a horizontal
 * fill has to measure its column delta in.
 */
export const columnIndexForId = (id: string): number =>
  letterIndex.get(id) ?? -1

/** Letters for a column id, or '' when the id holds no letter. */
export const lettersForColumnId = (id: string): string => {
  const index = columnIndexForId(id)
  return index < 0 ? '' : columnLetters(index)
}

/**
 * Column delta between two column ids, in A1 letter space. 0 when either side
 * holds no letter, which leaves formulas unshifted rather than pointing them
 * somewhere arbitrary.
 */
export function columnDeltaBetween(fromId: string, toId: string): number {
  const from = columnIndexForId(fromId)
  const to = columnIndexForId(toId)
  return from < 0 || to < 0 ? 0 : to - from
}
