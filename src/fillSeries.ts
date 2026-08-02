// Series inference for the fill handle — the "what comes next?" half of a fill.
//
// WHY this is its own module: `useCellSelection` is already the grid's
// selection, keyboard, clipboard, formula and rendering layer. Pattern
// inference, by contrast, is pure data work with no React and no table instance
// in it, and the only honest way to be confident about the dozen small rules a
// spreadsheet has accreted here (a single number copies but a single `Item 1`
// increments; `1/1` then `2/1` is a MONTH step, not a 31-day one; `Fri, Mon` is
// a 3-day weekday cycle) is to unit-test them directly. So this file stays
// dependency-free the way `formula.ts` is, and `fillSeries.test.ts` exercises it
// without a browser. The only import is a TYPE, which erases at compile time.
//
// The contract with the caller is deliberately narrow: hand in the values of one
// line of the source block (a column when filling down, a row when filling
// across) and get back a plan that can answer "what value belongs at position
// p?" for any p — including negative p, because a fill handle drags upwards and
// leftwards too.

import type { ColumnType } from './columnTypes'

/** Which pattern was recognised. `copy` means "no series — repeat the block". */
export type SeriesKind =
  | 'copy'
  | 'number'
  | 'date'
  | 'weekday'
  | 'month'
  | 'text'

export type SeriesPlan = {
  kind: SeriesKind
  // How many source values the plan was inferred from.
  length: number
  // The value belonging at `position`, an index relative to the START of the
  // source block: 0…length-1 are the block itself, `length` and beyond
  // extrapolate forwards, negatives extrapolate backwards.
  valueAt: (position: number) => unknown
}

export type SeriesOptions = {
  // The declared type of the column the values came from, when they all came
  // from ONE column. Date stepping is gated on this: a text column that happens
  // to hold something date-shaped is left alone, which is what stops a fill
  // across mixed columns from inventing dates.
  type?: ColumnType
}

/* ------------------------------------------------------------------ helpers */

/**
 * Where `position` lands inside a block of `length` when the block is repeated
 * cyclically in both directions — the classic copy-fill mapping, and the
 * fallback every unrecognised pattern degrades to. Exported because the grid's
 * copy path needs exactly the same mapping to pick its SOURCE cell (it has to
 * copy the formula / attachment of that cell, not just its value).
 */
export const cyclicIndex = (position: number, length: number): number => {
  if (length <= 0) return 0
  return ((position % length) + length) % length
}

const isBlank = (value: unknown) =>
  value === null || value === undefined || value === ''

// Floats accumulate error, so steps are compared with a tolerance scaled to the
// magnitude of the numbers involved rather than an absolute epsilon.
const nearly = (a: number, b: number) =>
  Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))

// `0.1 + 0.1 + 0.1` is 0.30000000000000004, which is a terrible thing to write
// into a cell. Twelve significant digits is well past any precision a user typed
// and short of the noise floor.
const tidy = (n: number) =>
  Number.isFinite(n) ? Number(Number(n).toPrecision(12)) : n

/** The one step every consecutive pair shares, or null when they disagree. */
const constantStep = (values: number[]): number | null => {
  if (values.length < 2) return null
  const step = values[1] - values[0]
  for (let i = 2; i < values.length; i++) {
    if (!nearly(values[i] - values[i - 1], step)) return null
  }
  return step
}

const copyPlan = (values: unknown[]): SeriesPlan => ({
  kind: 'copy',
  length: values.length,
  valueAt: (position) => values[cyclicIndex(position, values.length)],
})

/* ------------------------------------------------------------------ numbers */

type NumericCell = {
  n: number
  // True when the cell held the number as TEXT (`'2'`, not `2`). The series then
  // writes text back, so a text column stays a text column.
  asText: boolean
  // Digit width to zero-pad back to, for `'007'`-style values. 0 = no padding.
  pad: number
}

const NUMERIC_TEXT = /^[-+]?(\d+(\.\d+)?|\.\d+)$/

const asNumeric = (value: unknown): NumericCell | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? { n: value, asText: false, pad: 0 } : null
  }
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text || !NUMERIC_TEXT.test(text)) return null
  const n = Number(text)
  if (!Number.isFinite(n)) return null
  // Only a leading zero means the width is significant ('007', not '7').
  const digits = text.replace(/^[-+]/, '')
  const pad = /^0\d/.test(digits) ? digits.length : 0
  return { n, asText: true, pad }
}

// Render a stepped number back in the shape its source had: still a number for a
// numeric column, still text (optionally zero-padded) for a text one.
const renderNumber = (n: number, like: NumericCell): unknown => {
  const value = tidy(n)
  if (!like.asText) return value
  if (!like.pad) return String(value)
  const negative = value < 0
  const body = String(Math.abs(value)).padStart(like.pad, '0')
  return negative ? `-${body}` : body
}

const numberPlan = (values: unknown[]): SeriesPlan | null => {
  const parsed = values.map(asNumeric)
  if (parsed.some((cell) => cell === null)) return null
  const cells = parsed as NumericCell[]

  // A SINGLE number copies. This is Excel's behaviour and people lean on it
  // hard — dragging one `100` down a column to stamp it everywhere is a far more
  // common intent than asking for 101, 102, 103. A series needs at least two
  // cells to say what the step is.
  if (cells.length < 2) return null

  const step = constantStep(cells.map((cell) => cell.n))
  // Disagreeing gaps (1, 2, 5) are ambiguous: fitting a trend line through them
  // would be guessing, so they degrade to a repeat.
  if (step === null || step === 0) return null

  const base = cells[0].n
  return {
    kind: 'number',
    length: cells.length,
    valueAt: (position) => {
      if (position >= 0 && position < values.length) return values[position]
      // Extrapolation adopts the shape of the cell it continues from, so a
      // padded / textual block keeps producing padded text.
      const like = cells[cyclicIndex(position, cells.length)]
      return renderNumber(base + step * position, like)
    },
  }
}

/* -------------------------------------------------------------------- dates */

// A date-only value ('yyyy-MM-dd') is what `parseTypedValue` stores for a `date`
// column; a `datetime` column stores a full ISO instant. The distinction decides
// which of the two we write back.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

type DateCell = { ms: number; dateOnly: boolean }

const asDate = (value: unknown): DateCell | null => {
  if (value instanceof Date) {
    const ms = value.getTime()
    return Number.isFinite(ms) ? { ms, dateOnly: false } : null
  }
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text) return null
  const ms = Date.parse(text)
  if (!Number.isFinite(ms)) return null
  return { ms, dateOnly: DATE_ONLY.test(text) }
}

// Everything below works in UTC. Stored dates are UTC-anchored ISO strings, and
// staying in UTC means a day step is always exactly 24h — no DST cliff where
// a fill silently produces two March 31sts.
const renderDate = (ms: number, dateOnly: boolean): string => {
  const iso = new Date(ms).toISOString()
  return dateOnly ? iso.slice(0, 10) : iso
}

const addMonths = (ms: number, months: number): number => {
  const from = new Date(ms)
  const day = from.getUTCDate()
  const target = new Date(ms)
  target.setUTCDate(1)
  target.setUTCMonth(target.getUTCMonth() + months)
  // Clamp: one month on from Jan 31 is Feb 28/29, not March 3rd.
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate()
  target.setUTCDate(Math.min(day, lastDay))
  return target.getTime()
}

const datePlan = (
  values: unknown[],
  options: SeriesOptions,
): SeriesPlan | null => {
  // Gated on the column actually being a date column. A text column holding
  // '2024-01-01' is text as far as the user is concerned, and quietly turning a
  // drag into a date series there would be the wrong kind of clever.
  if (options.type !== 'date' && options.type !== 'datetime') return null

  const parsed = values.map(asDate)
  if (parsed.some((cell) => cell === null)) return null
  const cells = parsed as DateCell[]
  const dateOnly = cells.every((cell) => cell.dateOnly)
  const base = cells[0]

  // A single date DOES step, unlike a single number: a date column is a
  // timeline, and one date dragged down a column means "and the days after it"
  // in every spreadsheet there is.
  if (cells.length === 1) {
    return {
      kind: 'date',
      length: 1,
      valueAt: (position) =>
        position === 0
          ? values[0]
          : renderDate(base.ms + position * 86400000, dateOnly),
    }
  }

  const dates = cells.map((cell) => new Date(cell.ms))
  const sameDayOfMonth = dates.every(
    (d) => d.getUTCDate() === dates[0].getUTCDate(),
  )
  // Month first, and only when the day-of-month is held constant: 1 Jan → 1 Feb
  // is a month step, not a 31-day one, and reading it as days would land on
  // 3 March next. Whole-year steps fall out of this as a step of 12.
  if (sameDayOfMonth) {
    const monthIndex = dates.map(
      (d) => d.getUTCFullYear() * 12 + d.getUTCMonth(),
    )
    const monthStep = constantStep(monthIndex)
    if (monthStep !== null && monthStep !== 0) {
      return {
        kind: 'date',
        length: cells.length,
        valueAt: (position) =>
          position >= 0 && position < values.length
            ? values[position]
            : renderDate(addMonths(base.ms, monthStep * position), dateOnly),
      }
    }
  }

  // Otherwise any constant interval will do — a day, a week, or (for a datetime
  // column) an hour or fifteen minutes.
  const step = constantStep(cells.map((cell) => cell.ms))
  if (step === null || step === 0) return null

  return {
    kind: 'date',
    length: cells.length,
    valueAt: (position) =>
      position >= 0 && position < values.length
        ? values[position]
        : renderDate(base.ms + step * position, dateOnly),
  }
}

/* ------------------------------------------------------------- name cycles */

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

type NameCell = {
  index: number
  // The source wrote the short form ('Mon'), so the series writes short too.
  abbreviated: boolean
  casing: 'upper' | 'lower' | 'title'
}

const casingOf = (text: string): NameCell['casing'] => {
  if (text === text.toUpperCase() && text !== text.toLowerCase()) return 'upper'
  if (text === text.toLowerCase()) return 'lower'
  return 'title'
}

const applyCasing = (name: string, casing: NameCell['casing']) =>
  casing === 'upper'
    ? name.toUpperCase()
    : casing === 'lower'
      ? name.toLowerCase()
      : name

const asName = (value: unknown, names: string[]): NameCell | null => {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text) return null
  const lower = text.toLowerCase()
  const full = names.findIndex((name) => name.toLowerCase() === lower)
  if (full >= 0) {
    return { index: full, abbreviated: false, casing: casingOf(text) }
  }
  // Short form: the canonical 3-letter abbreviation, plus 'Sept', which enough
  // people write that rejecting it would read as a bug.
  const short = names.findIndex(
    (name) =>
      name.slice(0, 3).toLowerCase() === lower ||
      (name === 'September' && lower === 'sept'),
  )
  if (short >= 0) {
    return { index: short, abbreviated: true, casing: casingOf(text) }
  }
  return null
}

const renderName = (index: number, names: string[], like: NameCell) => {
  const name = names[((index % names.length) + names.length) % names.length]
  return applyCasing(like.abbreviated ? name.slice(0, 3) : name, like.casing)
}

const namePlan = (
  values: unknown[],
  names: string[],
  kind: SeriesKind,
): SeriesPlan | null => {
  const parsed = values.map((value) => asName(value, names))
  if (parsed.some((cell) => cell === null)) return null
  const cells = parsed as NameCell[]

  // A lone 'Mon' means Tue, Wed, Thu — a name is a position in a known cycle, so
  // unlike a bare number there is nothing to infer and nothing ambiguous.
  let step = 1
  if (cells.length > 1) {
    // Compared modulo the cycle so Fri → Mon reads as +3 rather than -4, and
    // Dec → Jan as +1.
    const gaps = cells
      .slice(1)
      .map((cell, i) => (cell.index - cells[i].index + names.length) % names.length)
    if (gaps.some((gap) => gap !== gaps[0]) || gaps[0] === 0) return null
    step = gaps[0]
  }

  const base = cells[0].index
  return {
    kind,
    length: cells.length,
    valueAt: (position) => {
      if (position >= 0 && position < values.length) return values[position]
      const like = cells[cyclicIndex(position, cells.length)]
      return renderName(base + step * position, names, like)
    },
  }
}

/* -------------------------------------------------- text with a number in it */

type TextCell = {
  prefix: string
  suffix: string
  n: number
  pad: number
}

// Two shapes only: a number at the end ('Item 1', 'Q1 2024' → no, that has both,
// see below) or a number at the start ('1st draft'). The digit run is captured
// with whatever text sits on either side of it, and every value in the block has
// to agree on that surrounding text — 'Item 1' and 'Task 2' are not a series.
const TRAILING = /^(.*?)(\d+)$/
const LEADING = /^(\d+)(.*)$/

const asText = (value: unknown, leading: boolean): TextCell | null => {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text) return null
  const match = leading ? LEADING.exec(text) : TRAILING.exec(text)
  if (!match) return null
  const digits = leading ? match[1] : match[2]
  const prefix = leading ? '' : match[1]
  const suffix = leading ? match[2] : ''
  // A bare number is the numeric branch's business, not this one.
  if (!prefix && !suffix) return null
  const n = Number(digits)
  if (!Number.isFinite(n)) return null
  return {
    prefix,
    suffix,
    n,
    pad: /^0\d/.test(digits) ? digits.length : 0,
  }
}

const textPlan = (values: unknown[], leading: boolean): SeriesPlan | null => {
  const parsed = values.map((value) => asText(value, leading))
  if (parsed.some((cell) => cell === null)) return null
  const cells = parsed as TextCell[]

  const { prefix, suffix } = cells[0]
  if (cells.some((cell) => cell.prefix !== prefix || cell.suffix !== suffix)) {
    return null
  }

  // A single 'Item 1' becomes Item 2, Item 3 — the number is clearly a counter
  // here, which is exactly what makes a single BARE number different.
  let step = 1
  if (cells.length > 1) {
    const found = constantStep(cells.map((cell) => cell.n))
    if (found === null || found === 0) return null
    step = found
  }

  const base = cells[0].n
  return {
    kind: 'text',
    length: cells.length,
    valueAt: (position) => {
      if (position >= 0 && position < values.length) return values[position]
      const like = cells[cyclicIndex(position, cells.length)]
      const n = base + step * position
      const negative = n < 0
      const body = like.pad
        ? String(Math.abs(n)).padStart(like.pad, '0')
        : String(Math.abs(n))
      return `${like.prefix}${negative ? '-' : ''}${body}${like.suffix}`
    },
  }
}

/* --------------------------------------------------------------- the engine */

/**
 * Read a pattern out of one line of the source block.
 *
 * Always returns a plan: when nothing is recognised — pure text, a mixture, a
 * block with a hole in it — the plan's kind is `copy` and it repeats the block
 * cyclically, which is both the previous behaviour and the right answer for
 * text. Callers should check `kind === 'copy'` and take their own copy path when
 * they need to carry more than a value across (a formula, an attachment).
 *
 * Order matters. Dates are tried first so a date column never falls through to
 * the numeric branch; names before text-with-a-number so 'Q1' style values do
 * not shadow 'Mon'; text-with-a-number last, because it is the loosest rule.
 */
export function inferSeries(
  values: unknown[],
  options: SeriesOptions = {},
): SeriesPlan {
  if (!values.length) return copyPlan(values)

  // A hole anywhere in the block makes the pattern ambiguous (is the blank part
  // of the rhythm, or missing data?), and objects — attachments — are not values
  // any series can step. Both degrade to a repeat rather than a guess.
  if (values.some((value) => isBlank(value) || typeof value === 'object')) {
    return copyPlan(values)
  }

  return (
    datePlan(values, options) ??
    numberPlan(values) ??
    namePlan(values, WEEKDAYS, 'weekday') ??
    namePlan(values, MONTHS, 'month') ??
    textPlan(values, false) ??
    textPlan(values, true) ??
    copyPlan(values)
  )
}

/** A short label for the drag preview: what a release would produce right now. */
export const describeSeries = (kind: SeriesKind): string =>
  kind === 'copy' ? 'Copy' : 'Series'
