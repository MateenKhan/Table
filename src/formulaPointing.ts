// Excel-style formula POINT MODE: the text half.
//
// ---------------------------------------------------------------------------
// WHAT POINT MODE IS
// ---------------------------------------------------------------------------
// In a spreadsheet, typing `=` and then pressing an arrow key does NOT move the
// text caret. It moves a *reference cursor* over the grid and writes the cell it
// lands on into the formula: `=` + ArrowUp gives `=C4`, another ArrowUp gives
// `=C3` (the ref is REPLACED, not appended), Shift+ArrowDown grows it to
// `=C3:C4`, and typing `+` ends that reference so the next arrow starts a NEW
// one. It is the single most-used way formulas are actually written, and this
// grid had none of it — arrows moved the caret inside the <input>.
//
// ---------------------------------------------------------------------------
// WHY THIS MODULE OWNS NOTHING BUT TEXT
// ---------------------------------------------------------------------------
// Point mode straddles three things that must not be entangled: the draft
// STRING (the editor's <input>), the reference CURSOR (screen coordinates, and
// therefore the grid's business), and the A1 SPELLING of a cell (the live
// letter space in `columnOrder.ts`). Only the middle one needs React or grid
// geometry.
//
// So this file is deliberately import-free and side-effect-free: it decides
// where a reference is legal, how a target is spelled, how the spelling is
// spliced into the draft, and how F4 cycles the `$` anchors. It is handed
// already-resolved A1 coordinates (`letters` + 1-based `rowNumber`) by the
// grid, which is the ONLY place that may translate a screen cell into them —
// through `lettersForColumnId` / `dataIndexAt`, i.e. the live letter space.
// That indirection is the whole reason point mode is safe to build now: before
// the letter space went live, an emitted `C4` could name a column that did not
// exist on a blank sheet and quietly evaluate to 0.
//
// Everything here is pure, so `formulaPointing.test.ts` covers the state
// machine without a DOM, a table or a React tree.

/** One end of a pointed reference, already in A1 terms. */
export type PointRefEnd = {
  /** Spreadsheet letters from the LIVE letter space. Never ''. */
  letters: string
  /** 1-based DATA row (screen rows are meaningless to the formula engine). */
  rowNumber: number
}

/** What the reference cursor currently covers. */
export type PointTarget = {
  from: PointRefEnd
  to: PointRefEnd
  /** True once Shift+arrow (or a drag) has made the two ends differ. */
  isRange: boolean
}

/**
 * Which halves of a reference are `$`-anchored. The names are the *anchored*
 * half, so `row` means `C$3` (row anchored, column free).
 */
export type AbsMode = 'relative' | 'both' | 'row' | 'col'

// Excel's F4 order: C3 → $C$3 → C$3 → $C3 → C3.
const ABS_CYCLE: AbsMode[] = ['relative', 'both', 'row', 'col']

export const nextAbsMode = (mode: AbsMode): AbsMode =>
  ABS_CYCLE[(ABS_CYCLE.indexOf(mode) + 1) % ABS_CYCLE.length]

/**
 * A live pointing session: the span of the draft the reference cursor owns and
 * rewrites in place as it moves.
 *
 * `start`/`length` are a slice of the draft string. The session exists only
 * while the arrows are driving the cursor; ANY other keystroke ends it, which
 * is exactly what makes requirement 5 ("`+` then arrow starts a NEW ref")
 * fall out for free rather than needing a rule of its own.
 */
export type PointSession = {
  start: number
  length: number
  mode: AbsMode
  /** The last target written, so F4 can respell it without moving anything. */
  target: PointTarget | null
}

/* ------------------------------------------------------------- ref legality */

// The characters after which an OPERAND may begin. This is the whole of the
// grammar's operand position: after the leading `=`, after any binary or unary
// operator, after `(`, after an argument separator, and after the `:` of a
// half-typed range. Anything else — a digit, a letter, `$`, `)` — means the
// caret is sitting inside a literal, a name or a completed reference, where
// inserting a second reference would produce garbage (`=12C4`).
const OPERAND_OPENERS = '+-*/^(,:'

/**
 * May a cell reference be inserted at `caret` in `draft`?
 *
 * Decided purely from the character immediately before the caret, ignoring
 * trailing spaces (`=1 + ` is still an operand position). This is a lexical
 * test rather than a parse because the draft is half-typed by definition — it
 * usually does not parse at all — and because the answer must be stable while
 * the user types: a rule that flickered would make the arrow keys feel random.
 *
 * Non-formula drafts always answer false, which is what keeps ordinary text
 * editing (including plain arrow-key caret movement) completely untouched.
 */
export function referenceAllowedAt(draft: string, caret: number): boolean {
  if (typeof draft !== 'string') return false
  if (!draft.trimStart().startsWith('=')) return false
  if (caret < 0 || caret > draft.length) return false

  const eq = draft.indexOf('=')
  // Inside (or before) the leading `=` there is no formula body yet.
  if (caret <= eq) return false

  const before = draft.slice(eq + 1, caret).trimEnd()
  if (!before) return true
  return OPERAND_OPENERS.includes(before[before.length - 1])
}

/* ------------------------------------------------------------- ref spelling */

const anchors = (mode: AbsMode) => ({
  col: mode === 'both' || mode === 'col' ? '$' : '',
  row: mode === 'both' || mode === 'row' ? '$' : '',
})

/** `{letters:'C', rowNumber:3}` + `'both'` → `'$C$3'`. */
export function refText(end: PointRefEnd, mode: AbsMode = 'relative'): string {
  const { col, row } = anchors(mode)
  return `${col}${end.letters}${row}${end.rowNumber}`
}

/**
 * The A1 text for a target: a single ref, or `C3:C4` for a range. Both ends
 * share the anchor mode, matching what F4 does to a pointed range in Excel.
 */
export function targetText(
  target: PointTarget,
  mode: AbsMode = 'relative',
): string {
  return target.isRange
    ? `${refText(target.from, mode)}:${refText(target.to, mode)}`
    : refText(target.from, mode)
}

// `$C$3` and friends. Bounded lengths so a runaway scan can never match.
const REF_TEXT = /^(\$?)([A-Za-z]{1,7})(\$?)([0-9]{1,7})$/

export type ParsedRefText = PointRefEnd & { mode: AbsMode }

/** Read an A1 ref back out of its text. Null when it is not one. */
export function parseRefText(text: string): ParsedRefText | null {
  const m = REF_TEXT.exec(text)
  if (!m) return null
  const colAbs = m[1] === '$'
  const rowAbs = m[3] === '$'
  const mode: AbsMode = colAbs
    ? rowAbs
      ? 'both'
      : 'col'
    : rowAbs
      ? 'row'
      : 'relative'
  return { letters: m[2], rowNumber: Number(m[4]), mode }
}

/** F4 on a bare ref: `C3` → `$C$3` → `C$3` → `$C3` → `C3`. Null if not a ref. */
export function cycleRefText(text: string): string | null {
  const parsed = parseRefText(text)
  if (!parsed) return null
  return refText(parsed, nextAbsMode(parsed.mode))
}

/* ------------------------------------------------- finding a ref at the caret */

// Everything an A1 reference can be spelled with. `:` is excluded on purpose,
// so scanning outwards from the caret inside `C3:C4` finds the ONE end the
// caret is next to rather than the whole range — "the ref adjacent to the
// caret", which is what F4 acts on outside a pointing session.
const REF_CHAR = /[A-Za-z0-9$]/

export type RefSpan = { start: number; end: number; text: string }

/**
 * The A1 reference the caret is sitting in or immediately after, if any.
 * Scans outwards over reference characters and then VALIDATES the run, so a
 * function name (`SUM`), a bare number (`12`) or a column name (`age`) — all of
 * which are made of the same characters — correctly answer null.
 */
export function refSpanAtCaret(draft: string, caret: number): RefSpan | null {
  if (typeof draft !== 'string') return null
  const at = Math.max(0, Math.min(caret, draft.length))
  let start = at
  while (start > 0 && REF_CHAR.test(draft[start - 1])) start--
  let end = at
  while (end < draft.length && REF_CHAR.test(draft[end])) end++
  if (end <= start) return null
  const text = draft.slice(start, end)
  return parseRefText(text) ? { start, end, text } : null
}

/* ---------------------------------------------------------- splicing a draft */

export type SplicedDraft = { draft: string; caret: number }

/**
 * Replace `[start, start+length)` of `draft` with `text`, leaving the caret at
 * the end of what was written. This single operation covers all three writes
 * point mode makes — the first insertion (`length` 0), every subsequent move of
 * the same session (`length` = the previous spelling), and an F4 respell — which
 * is why moving the cursor REPLACES the reference instead of appending one.
 */
export function spliceRef(
  draft: string,
  start: number,
  length: number,
  text: string,
): SplicedDraft {
  const head = draft.slice(0, start)
  const tail = draft.slice(start + length)
  return { draft: `${head}${text}${tail}`, caret: start + text.length }
}

/* ---------------------------------------------------------- the transitions */

/**
 * Open a session at the caret. The caller has already established that a
 * reference is legal there (`referenceAllowedAt`); this only records where the
 * cursor's text will live.
 */
export const beginSession = (caret: number): PointSession => ({
  start: caret,
  length: 0,
  mode: 'relative',
  target: null,
})

/**
 * Write `target` into the session's span. Returns the new draft, the caret to
 * restore, and the advanced session.
 */
export function writeTarget(
  draft: string,
  session: PointSession,
  target: PointTarget,
): SplicedDraft & { session: PointSession } {
  const text = targetText(target, session.mode)
  const spliced = spliceRef(draft, session.start, session.length, text)
  return {
    ...spliced,
    session: { ...session, length: text.length, target },
  }
}

/**
 * F4 inside a live session: respell the SAME target one step further round the
 * anchor cycle. Nothing moves, so the reference cursor and its marching ants
 * stay exactly where they are.
 */
export function cycleSession(
  draft: string,
  session: PointSession,
): (SplicedDraft & { session: PointSession }) | null {
  if (!session.target) return null
  const mode = nextAbsMode(session.mode)
  return writeTarget(draft, { ...session, mode }, session.target)
}

/**
 * F4 with no session: cycle the reference next to the caret, in place. This is
 * the path that lets an already-typed or already-pointed `=C3+C4` be anchored
 * afterwards, which is how F4 is used most of the time.
 */
export function cycleAtCaret(
  draft: string,
  caret: number,
): SplicedDraft | null {
  const span = refSpanAtCaret(draft, caret)
  if (!span) return null
  const next = cycleRefText(span.text)
  if (next === null) return null
  return spliceRef(draft, span.start, span.end - span.start, next)
}
