/**
 * Sentence → rules.
 *
 * Compiles `name contains mateen and salary > 19900` into the same
 * `QueryRule[]` + `Combinator[]` the click-by-click builder produces. Nothing
 * here executes or evaluates: it only translates, so a parsed query and a
 * built one are indistinguishable downstream.
 *
 * Why this exists: the staged picker is precise but demands you already know
 * it is staged. People reach for a sentence first — including the person who
 * wrote the picker. This accepts the sentence and hands back the same chips.
 *
 * Deliberately NOT a general expression language: no parentheses, no nesting,
 * no arithmetic. `A and B or C` groups exactly the way `evaluateRuleSet`
 * already groups it (AND binds tighter), so what you type and what filters
 * agree without a second set of precedence rules to learn.
 */

import {
  NUMERIC_OPERATORS,
  operandCount,
  operatorsForType,
  type Combinator,
  type OperatorDef,
  type QueryRule,
  type RuleOperator,
} from './globalSearch'
import type { ColumnType } from './columnTypes'

/** A column as far as the parser cares: something with a name and a type. */
export type ParsableColumn = {
  id: string
  label: string
  type?: ColumnType
}

export type ParsedQuery = {
  ok: boolean
  rules: Omit<QueryRule, 'id'>[]
  connectors: Combinator[]
  /** Human-readable reason the parse stopped. */
  error?: string
  /** Character offset the failure starts at, for underlining the input. */
  errorAt?: number
  /**
   * What the parser expected next. Drives suggestions while typing rather
   * than only reporting failure after the fact.
   */
  expecting?: 'column' | 'operator' | 'value' | 'connector'
  /** The partial token being typed, so suggestions can be filtered by it. */
  partial?: string
  /** The column in scope when the parse stopped, if any. */
  contextColumnId?: string
}

/**
 * Operator spellings accepted in a sentence, longest first so `does not
 * contain` wins over `contains` and `>=` over `>`.
 *
 * Symbols are listed alongside words because people mix them freely —
 * `salary > 19900 and name is bob` is one sentence, two notations.
 */
const OPERATOR_WORDS: Array<{ words: string; op: RuleOperator }> = [
  { words: 'does not contain', op: 'notContains' },
  { words: 'not contains', op: 'notContains' },
  { words: 'doesnt contain', op: 'notContains' },
  { words: 'is not empty', op: 'isNotEmpty' },
  { words: 'not empty', op: 'isNotEmpty' },
  { words: 'is empty', op: 'isEmpty' },
  { words: 'starts with', op: 'startsWith' },
  { words: 'begins with', op: 'startsWith' },
  { words: 'ends with', op: 'endsWith' },
  { words: 'not equals', op: 'notEquals' },
  { words: 'greater than or equal', op: 'gte' },
  { words: 'less than or equal', op: 'lte' },
  { words: 'greater than', op: 'gt' },
  { words: 'less than', op: 'lt' },
  { words: 'not equal', op: 'notEquals' },
  { words: 'contains', op: 'contains' },
  { words: 'includes', op: 'contains' },
  { words: 'between', op: 'between' },
  { words: 'equals', op: 'equals' },
  { words: 'is', op: 'equals' },
  { words: '>=', op: 'gte' },
  { words: '<=', op: 'lte' },
  { words: '!=', op: 'notEquals' },
  { words: '<>', op: 'notEquals' },
  { words: '==', op: 'equals' },
  { words: '=', op: 'equals' },
  { words: '>', op: 'gt' },
  { words: '<', op: 'lt' },
]

const CONNECTORS: Array<{ word: string; value: Combinator }> = [
  { word: 'and', value: 'and' },
  { word: 'or', value: 'or' },
]

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * Text operators and numeric operators share ids (`equals` vs `eq`), so a
 * sentence-level operator has to be re-pointed at whatever the column's type
 * actually offers. `salary is 5` means `eq`, `name is bob` means `equals`.
 */
function reconcileOperator(op: RuleOperator, type?: ColumnType): RuleOperator | null {
  const allowed = operatorsForType(type)
  if (allowed.some((d) => d.id === op)) return op

  const numericTwin: Partial<Record<RuleOperator, RuleOperator>> = {
    equals: 'eq',
    notEquals: 'ne',
  }
  const textTwin: Partial<Record<RuleOperator, RuleOperator>> = {
    eq: 'equals',
    ne: 'notEquals',
  }

  const isNumericTarget = allowed === NUMERIC_OPERATORS
  const swapped = isNumericTarget ? numericTwin[op] : textTwin[op]
  if (swapped && allowed.some((d) => d.id === swapped)) return swapped

  // `>` on a text column, `starts with` on a number: no sensible equivalent.
  return null
}

/** Longest-label-first, so `first name` beats `name` when both could match. */
function matchColumn(
  input: string,
  columns: ParsableColumn[],
): { column: ParsableColumn; consumed: number } | null {
  const hay = norm(input)
  const candidates = columns
    .flatMap((c) => [
      { column: c, key: norm(c.label) },
      { column: c, key: norm(c.id) },
    ])
    .filter((c) => c.key.length > 0)
    .sort((a, b) => b.key.length - a.key.length)

  for (const { column, key } of candidates) {
    if (hay === key || hay.startsWith(key + ' ')) {
      return { column, consumed: key.length }
    }
  }
  return null
}

function matchOperator(
  input: string,
): { def: RuleOperator; consumed: number } | null {
  const hay = norm(input)
  for (const { words, op } of OPERATOR_WORDS) {
    // Symbols need no word boundary; words do, or `is` matches inside `island`.
    const isSymbol = !/^[a-z]/.test(words)
    if (isSymbol ? hay.startsWith(words) : hay === words || hay.startsWith(words + ' ')) {
      return { def: op, consumed: words.length }
    }
  }
  return null
}

/** Where does the next connector start? Returns -1 when there isn't one. */
function findConnector(input: string, from: number): { at: number; value: Combinator; len: number } | null {
  const hay = input.toLowerCase()
  let best: { at: number; value: Combinator; len: number } | null = null
  for (const { word, value } of CONNECTORS) {
    // Word boundaries on both sides: "brand" must not read as "and".
    const re = new RegExp(`(^|\\s)${word}(\\s|$)`, 'g')
    re.lastIndex = from
    const m = re.exec(hay)
    if (m && m.index >= from) {
      const at = m.index + m[1].length
      if (!best || at < best.at) best = { at, value, len: word.length }
    }
  }
  return best
}

/**
 * Values may be quoted to contain a connector word: `name is "salt and
 * pepper"`. Unquoted values run to the next connector, or to the end.
 */
function readValue(input: string, from: number): { value: string; end: number } {
  const rest = input.slice(from)
  const lead = rest.match(/^\s*/)?.[0].length ?? 0
  const start = from + lead
  const quote = input[start]

  if (quote === '"' || quote === "'") {
    const close = input.indexOf(quote, start + 1)
    if (close !== -1) return { value: input.slice(start + 1, close), end: close + 1 }
  }

  const connector = findConnector(input, start)
  const end = connector ? connector.at : input.length
  return { value: input.slice(start, end).trim(), end }
}

/**
 * Parse a whole sentence.
 *
 * Returns `ok: false` with `expecting` set for an *incomplete* query as well
 * as an invalid one — the caller uses that to drive suggestions mid-typing,
 * not just to show an error.
 */
export function parseQuerySentence(
  input: string,
  columns: ParsableColumn[],
): ParsedQuery {
  const rules: Omit<QueryRule, 'id'>[] = []
  const connectors: Combinator[] = []

  let cursor = 0
  const fail = (error: string, expecting?: ParsedQuery['expecting'], extra?: Partial<ParsedQuery>) => ({
    ok: false,
    rules,
    connectors,
    error,
    errorAt: cursor,
    expecting,
    ...extra,
  })

  if (!input.trim()) {
    return { ok: false, rules, connectors, expecting: 'column', partial: '' }
  }

  for (;;) {
    // ── column ──────────────────────────────────────────────────────────
    while (input[cursor] === ' ') cursor++
    const columnSlice = input.slice(cursor)
    if (!columnSlice.trim()) {
      return fail('Expected a column name.', 'column', { partial: '' })
    }

    const col = matchColumn(columnSlice, columns)
    if (!col) {
      // Everything up to the next space is what they're part-way through.
      const partial = columnSlice.split(/\s/)[0]
      return fail(`No column matches "${partial}".`, 'column', { partial })
    }
    cursor += col.consumed

    // ── operator ────────────────────────────────────────────────────────
    while (input[cursor] === ' ') cursor++
    const opSlice = input.slice(cursor)
    if (!opSlice.trim()) {
      return fail('Expected an operator.', 'operator', {
        partial: '',
        contextColumnId: col.column.id,
      })
    }

    const opMatch = matchOperator(opSlice)
    if (!opMatch) {
      const partial = opSlice.split(/\s/)[0]
      return fail(`"${partial}" is not an operator.`, 'operator', {
        partial,
        contextColumnId: col.column.id,
      })
    }

    const operator = reconcileOperator(opMatch.def, col.column.type)
    if (!operator) {
      return fail(
        `"${opMatch.def}" does not apply to ${col.column.label}.`,
        'operator',
        { contextColumnId: col.column.id },
      )
    }
    cursor += opMatch.consumed

    // ── value(s) ────────────────────────────────────────────────────────
    const operands = operandCount(operator)
    let value = ''
    let value2 = ''

    if (operands >= 1) {
      const read = readValue(input, cursor)
      if (!read.value) {
        return fail('Expected a value.', 'value', {
          partial: '',
          contextColumnId: col.column.id,
        })
      }

      if (operands === 2) {
        // `between 10 and 20` — the FIRST `and` separates the two operands,
        // it is not a connector. readValue stops at it, so re-read here
        // spanning past it to the *second* connector (or the end).
        const separator = findConnector(input, cursor)
        if (!separator || separator.value !== 'and') {
          return fail('`between` needs two values: `between 10 and 20`.', 'value', {
            contextColumnId: col.column.id,
          })
        }
        const afterSeparator = separator.at + separator.len
        const next = findConnector(input, afterSeparator)
        const end = next ? next.at : input.length

        value = input.slice(cursor, separator.at).trim()
        value2 = input.slice(afterSeparator, end).trim()
        if (!value || !value2) {
          return fail('`between` needs two values: `between 10 and 20`.', 'value', {
            contextColumnId: col.column.id,
          })
        }
        cursor = end
      } else {
        value = read.value
        cursor = read.end
      }
    }

    rules.push({ columnId: col.column.id, operator, value, value2 })

    // ── connector, or we're done ────────────────────────────────────────
    while (input[cursor] === ' ') cursor++
    if (cursor >= input.length) break

    // Match at the cursor directly. findConnector needs a leading boundary,
    // which the cursor sits *after* — so asking it here would skip this
    // connector and find the next one, then reject the gap it just stepped
    // over.
    const here = /^(and|or)(\s|$)/i.exec(input.slice(cursor))
    if (!here) {
      const partial = input.slice(cursor).split(/\s/)[0]
      return fail(`Expected "and" or "or", found "${partial}".`, 'connector', { partial })
    }
    connectors.push(here[1].toLowerCase() as Combinator)
    cursor += here[1].length
  }

  return { ok: rules.length > 0, rules, connectors }
}

/** Operator spellings offered for a column, for the suggestion list. */
export function operatorSuggestions(type?: ColumnType): OperatorDef[] {
  return operatorsForType(type)
}

/**
 * True when the text looks like a sentence rather than a bare column name —
 * i.e. it already contains an operator. Used to decide whether to offer the
 * sentence path at all, so typing a column name alone still drives the
 * staged picker unchanged.
 */
export function looksLikeSentence(input: string, columns: ParsableColumn[]): boolean {
  const col = matchColumn(input, columns)
  if (!col) return false
  const rest = input.slice(col.consumed)
  return matchOperator(rest) !== null
}
