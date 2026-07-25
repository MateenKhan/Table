import { Cell, FilterFn, Row } from '@tanstack/react-table'
import { rankItem } from '@tanstack/match-sorter-utils'
import {
  ColumnType,
  isAttachmentType,
  isNumericType,
  parseTypedValue,
  TypeOptions,
} from './columnTypes'

export type SelectedValue = {
  columnId: string
  value: string
}

/* ----------------------------------------------------------- the rule model */

// Everything below is plain, serialisable data: no functions, no column or
// table references, so a whole query round-trips through JSON.stringify.

export type Combinator = 'and' | 'or'

// A "Top N" / "Bottom N" view limit: rank the rows by one numeric column and
// keep only the N highest (`top`) or lowest (`bottom`). It is a *view* concern,
// not a row predicate, so it lives beside the rules rather than inside them.
export type RankDir = 'top' | 'bottom'

export type RankLimit = {
  columnId: string
  dir: RankDir
  n: number
}

export type RuleOperator =
  // text
  | 'contains'
  | 'notContains'
  | 'equals'
  | 'notEquals'
  | 'startsWith'
  | 'endsWith'
  | 'isNotEmpty'
  // numeric
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  // both
  | 'isEmpty'

export type QueryRule = {
  // Stable key for React and for editing a rule in place. Not part of the
  // semantics - two rules that differ only by id mean the same thing.
  id: string
  columnId: string
  operator: RuleOperator
  // Operands stay strings: what the user typed is what is persisted, and it is
  // parsed against the column's type at evaluation time.
  value: string
  // Second operand, `between` only.
  value2?: string
}

export type OperatorDef = {
  id: RuleOperator
  label: string
  // How many operand inputs the rule needs: `is empty` takes none, `between`
  // takes two.
  operands: 0 | 1 | 2
}

export const TEXT_OPERATORS: OperatorDef[] = [
  { id: 'contains', label: 'contains', operands: 1 },
  { id: 'notContains', label: 'does not contain', operands: 1 },
  { id: 'equals', label: 'equals', operands: 1 },
  { id: 'notEquals', label: 'not equals', operands: 1 },
  { id: 'startsWith', label: 'starts with', operands: 1 },
  { id: 'endsWith', label: 'ends with', operands: 1 },
  { id: 'isEmpty', label: 'is empty', operands: 0 },
  { id: 'isNotEmpty', label: 'is not empty', operands: 0 },
]

export const NUMERIC_OPERATORS: OperatorDef[] = [
  { id: 'eq', label: '=', operands: 1 },
  { id: 'ne', label: '≠', operands: 1 },
  { id: 'gt', label: '>', operands: 1 },
  { id: 'gte', label: '≥', operands: 1 },
  { id: 'lt', label: '<', operands: 1 },
  { id: 'lte', label: '≤', operands: 1 },
  { id: 'between', label: 'between', operands: 2 },
  { id: 'isEmpty', label: 'is empty', operands: 0 },
]

const OPERATOR_BY_ID = new Map<RuleOperator, OperatorDef>(
  [...TEXT_OPERATORS, ...NUMERIC_OPERATORS].map((def) => [def.id, def]),
)

// The column's declared type is the only thing that decides which operators
// exist - exactly the same declaration that drives formatting and editing.
export const operatorsForType = (type?: ColumnType): OperatorDef[] =>
  isNumericType(type) ? NUMERIC_OPERATORS : TEXT_OPERATORS

export const operatorDef = (operator: RuleOperator) =>
  OPERATOR_BY_ID.get(operator)

export const operandCount = (operator: RuleOperator): 0 | 1 | 2 =>
  operatorDef(operator)?.operands ?? 1

// The human label the token builder prints on an operator chip (`contains`, `≥`,
// `is empty`), falling back to the raw id if the operator is unknown.
export const operatorLabel = (operator: RuleOperator): string =>
  operatorDef(operator)?.label ?? operator

export const defaultOperatorForType = (type?: ColumnType): RuleOperator =>
  isNumericType(type) ? 'eq' : 'contains'

/* --------------------------------------------- suggestion / ranking helpers */

// Where a typed query matches a candidate, and how well. Higher is better; -1
// means "no match at all". This is what makes the *best* match the highlighted,
// commit-on-Tab option rather than merely the first one in declaration order.
export function matchScore(haystack: string, needle: string): number {
  if (!needle) return 0
  const h = haystack.toLowerCase()
  const n = needle.toLowerCase()
  if (h === n) return 100
  const idx = h.indexOf(n)
  if (idx < 0) return -1
  if (idx === 0) return 60
  // A match that starts a word reads as stronger than one buried mid-token.
  if (/\s/.test(h.charAt(idx - 1))) return 40
  return 20
}

// The minimal, table-free view of a column the common-suggestion builder needs.
export type ColumnSchema = {
  columnId: string
  header: string
  type?: ColumnType
}

// A schema-driven shortcut such as "Top 10 Salary". `header` is carried through
// so the label always tracks the column's *current* header rather than baking a
// literal in - rename the column and the shortcut renames itself.
export type CommonSuggestion = {
  id: string
  kind: RankDir
  columnId: string
  header: string
  n: number
  label: string
}

/**
 * Build the "common" suggestions purely from the column schema: every numeric
 * column earns a `Top N` and a `Bottom N` shortcut. Nothing here reads a single
 * data value - the list is derived from types and headers alone, so it is
 * stable as the data changes and safe to unit test without a table.
 */
export function buildCommonSuggestions(
  columns: ColumnSchema[],
  n = 10,
): CommonSuggestion[] {
  const out: CommonSuggestion[] = []
  for (const column of columns ?? []) {
    if (!column || !column.columnId) continue
    if (!isNumericType(column.type)) continue
    const header = (column.header ?? '').trim() || column.columnId
    out.push({
      id: `top:${column.columnId}`,
      kind: 'top',
      columnId: column.columnId,
      header,
      n,
      label: `Top ${n} ${header}`,
    })
    out.push({
      id: `bottom:${column.columnId}`,
      kind: 'bottom',
      columnId: column.columnId,
      header,
      n,
      label: `Bottom ${n} ${header}`,
    })
  }
  return out
}

/**
 * The pure heart of the rank limit: given a column of numbers, return the
 * indices of the `n` highest (`top`) or lowest (`bottom`), plus the boundary
 * value that survived (the display threshold, e.g. `≥ $85,000`). Non-finite
 * entries (blank cells, `#ERROR`) are ignored rather than sorted as `NaN`, and
 * `n` larger than the data simply returns everything.
 */
export function selectTopN(
  values: number[],
  n: number,
  dir: RankDir,
): { indices: number[]; threshold: number | null } {
  if (n <= 0) return { indices: [], threshold: null }
  const pairs: { i: number; v: number }[] = []
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (typeof v === 'number' && Number.isFinite(v)) pairs.push({ i, v })
  }
  // Stable within ties so the same rows win each time the data is unchanged.
  pairs.sort((a, b) => (dir === 'top' ? b.v - a.v : a.v - b.v) || a.i - b.i)
  const picked = pairs.slice(0, n)
  return {
    indices: picked.map((p) => p.i),
    threshold: picked.length ? picked[picked.length - 1].v : null,
  }
}

// Text operators compare against a written word, so their operand reads best
// quoted in a summary (`firstName contains "Rashawn"`); numeric operators
// compare against a bare number (`salary ≥ 20`) and must not be quoted.
const TEXT_VALUE_OPERATORS = new Set<RuleOperator>(
  TEXT_OPERATORS.filter((def) => def.operands > 0).map((def) => def.id),
)

/**
 * Human summary of a rule as `column <operator-label> value`, e.g.
 * `firstName contains "Rashawn"`, `salary ≥ 20`, `age between 20 and 40`,
 * `lastName is empty`. This is the chip/summary text the builder shows, and it
 * always makes the operator explicit rather than collapsing to `column: value`.
 * An unfinished rule renders its blanks as `…` rather than an empty string.
 */
export function ruleSummary(rule: QueryRule): string {
  if (!rule.columnId) return '…'
  const label = operatorDef(rule.operator)?.label ?? rule.operator
  const operands = operandCount(rule.operator)
  if (operands === 0) return `${rule.columnId} ${label}`

  const quote = (raw: string) => {
    const v = raw.trim()
    if (!v) return '…'
    return TEXT_VALUE_OPERATORS.has(rule.operator) ? `"${v}"` : v
  }

  if (operands === 2) {
    return `${rule.columnId} ${label} ${quote(rule.value)} and ${quote(
      rule.value2 ?? '',
    )}`
  }
  return `${rule.columnId} ${label} ${quote(rule.value)}`
}

/**
 * Canonical one-line summary of the whole applied query, joining each complete
 * rule's `ruleSummary` with the *actual* per-gap connector between it and the
 * previous complete rule (falling back to the shared `combinator`), and
 * appending the free text if any. This is what the collapsed query bar shows,
 * so it reads exactly like the builder:
 *
 *   firstName does not contain "mateen"  AND  salary ≥ 20  OR  age < 30
 *
 * Incomplete rules are skipped; an empty query returns ''.
 */
export function querySummary(value: GlobalSearchValue): string {
  const allRules = value.rules ?? []
  const fallback: Combinator = value.combinator === 'or' ? 'or' : 'and'
  const connectors = value.connectors

  const connectorBefore = (originalIndex: number): Combinator => {
    const c = connectors?.[originalIndex - 1]
    return c === 'or' || c === 'and' ? c : fallback
  }

  let out = ''
  let first = true
  for (let i = 0; i < allRules.length; i++) {
    const rule = allRules[i]
    if (!isRuleComplete(rule)) continue
    const summary = ruleSummary(rule)
    if (first) {
      out = summary
      first = false
    } else {
      out += `  ${connectorBefore(i).toUpperCase()}  ${summary}`
    }
  }

  const text = (value.text ?? '').trim()
  if (text) {
    const textPart = `text contains "${text}"`
    out = out ? `${out}  AND  ${textPart}` : textPart
  }

  return out
}

// Attachment columns hold object URLs, not values anyone can query.
export const canRuleOnType = (type?: ColumnType) => !isAttachmentType(type)

/**
 * Keep a rule legal after its column changed: a `contains` rule pointed at a
 * currency column has no meaning, so the operator falls back to the new type's
 * default and the operands are dropped with it.
 */
export function coerceRuleToType(
  rule: QueryRule,
  type: ColumnType | undefined,
): QueryRule {
  const allowed = operatorsForType(type)
  if (allowed.some((def) => def.id === rule.operator)) return rule
  return {
    ...rule,
    operator: defaultOperatorForType(type),
    value: '',
    value2: '',
  }
}

let ruleSeq = 0

export const newRule = (): QueryRule => ({
  id: `rule-${++ruleSeq}-${Math.random().toString(36).slice(2, 7)}`,
  columnId: '',
  operator: 'contains',
  value: '',
  value2: '',
})

export type GlobalSearchValue = {
  // Free text currently typed into the box.
  text: string
  // Suggestions the user ticked. A row matches if it matches ANY of them.
  values: SelectedValue[]
  // Columns the search is restricted to. Empty means every column.
  columns: string[]
  // Structured rules, ANDed with the free text above.
  rules: QueryRule[]
  // The default / legacy combinator, used for any gap `connectors` does not
  // spell out. Kept for backward compatibility with values written before
  // per-gap connectors existed.
  combinator: Combinator
  // Per-gap combinators: `connectors[i]` joins `rules[i]` and `rules[i+1]`, so a
  // healthy array is `rules.length - 1` long. Missing entries fall back to
  // `combinator`. `AND` binds tighter than `OR` (see `evaluateRuleSet`), which
  // is what lets `A AND B OR C` mean `(A AND B) OR C`.
  connectors?: Combinator[]
  // Optional "Top N" / "Bottom N" view limit. Null (or absent) means no limit.
  // This does not participate in `globalSearchFilter`; it is applied to the
  // table's sorting + pagination by the UI, so a legacy value without it still
  // filters correctly.
  limit?: RankLimit | null
}

export const emptyGlobalSearch: GlobalSearchValue = {
  text: '',
  values: [],
  columns: [],
  rules: [],
  combinator: 'and',
  connectors: [],
  limit: null,
}

/* ------------------------------------------------------------- evaluation */

// What the evaluator needs to know about one column of one row. Keeping this an
// interface rather than a TanStack `Row` is what makes the rule engine a pure,
// table-free function that can be unit tested without building a table.
export type ResolvedColumn = {
  value: unknown
  options?: TypeOptions
}

// Returns undefined when the column is not on the table (merged away, say), in
// which case the rule referencing it is ignored rather than failing every row.
export type ColumnResolver = (columnId: string) => ResolvedColumn | undefined

const isBlank = (value: unknown) =>
  value === null || value === undefined || String(value).trim() === ''

const asText = (value: unknown) =>
  value === null || value === undefined ? '' : String(value).trim().toLowerCase()

/**
 * Turn an operand the user typed into a number. Numeric columns go through
 * `parseTypedValue`, so `$20,000`, `20 000` and `20000` all mean the same
 * thing. Note that an integer column truncates its operand, exactly as it would
 * when editing a cell.
 */
export function parseOperand(raw: string, options?: TypeOptions): number {
  const text = raw.trim()
  // `Number('')` is 0, so anything without a digit has to be rejected up front
  // or `> abc` would silently become `> 0`.
  if (!/\d/.test(text)) return NaN

  const parsed = isNumericType(options?.type)
    ? parseTypedValue(text, options, undefined)
    : Number(text.replace(/[^0-9.eE+-]/g, ''))

  const n = typeof parsed === 'number' ? parsed : NaN
  return Number.isFinite(n) ? n : NaN
}

// Cell side of the same coin. Numeric columns already hold real numbers; a
// blank cell or an `#ERROR` left by the formula engine is simply not a number.
function cellNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN
  if (value === null || value === undefined) return NaN
  const text = String(value).trim()
  if (!/\d/.test(text)) return NaN
  const n = Number(text.replace(/[^0-9.eE+-]/g, ''))
  return Number.isFinite(n) ? n : NaN
}

/**
 * Is the rule finished enough to mean anything? A half-typed rule is ignored
 * rather than treated as "match nothing", so the grid never blanks out while
 * the user is still picking a column or typing an operand.
 */
export function isRuleComplete(rule: QueryRule): boolean {
  if (!rule.columnId || !rule.operator) return false
  if (!OPERATOR_BY_ID.has(rule.operator)) return false

  const operands = operandCount(rule.operator)
  if (operands === 0) return true
  if (!rule.value.trim()) return false
  if (operands === 2 && !(rule.value2 ?? '').trim()) return false
  return true
}

export const completeRules = (value: GlobalSearchValue) =>
  (value.rules ?? []).filter(isRuleComplete)

/**
 * Why a rule cannot run yet, as a short human reason, or null when it is fine.
 * This is the message half of `isRuleComplete`: the builder uses it to explain
 * an "Invalid query" instead of just refusing to filter.
 */
export function invalidRuleReason(rule: QueryRule): string | null {
  if (!rule.columnId) return 'pick a column'
  if (!OPERATOR_BY_ID.has(rule.operator)) return 'unknown operator'
  const operands = operandCount(rule.operator)
  if (operands === 0) return null
  if (!rule.value.trim()) return 'this condition needs a value'
  if (operands === 2 && !(rule.value2 ?? '').trim())
    return 'a range needs two values'
  return null
}

/** One complete rule against one resolved cell. */
export function evaluateRule(rule: QueryRule, resolved: ResolvedColumn) {
  const { value, options } = resolved

  switch (rule.operator) {
    case 'isEmpty':
      return isBlank(value)
    case 'isNotEmpty':
      return !isBlank(value)
    default:
      break
  }

  const needle = rule.value.trim().toLowerCase()

  switch (rule.operator) {
    case 'contains':
      return asText(value).includes(needle)
    case 'notContains':
      return !asText(value).includes(needle)
    case 'equals':
      return asText(value) === needle
    case 'notEquals':
      return asText(value) !== needle
    case 'startsWith':
      return asText(value).startsWith(needle)
    case 'endsWith':
      return asText(value).endsWith(needle)
    default:
      break
  }

  const cell = cellNumber(value)
  const operand = parseOperand(rule.value, options)
  // An unparseable operand cannot select anything; completeness only checks
  // that something was typed.
  if (!Number.isFinite(cell) || !Number.isFinite(operand)) return false

  switch (rule.operator) {
    case 'eq':
      return cell === operand
    case 'ne':
      return cell !== operand
    case 'gt':
      return cell > operand
    case 'gte':
      return cell >= operand
    case 'lt':
      return cell < operand
    case 'lte':
      return cell <= operand
    case 'between': {
      const other = parseOperand(rule.value2 ?? '', options)
      if (!Number.isFinite(other)) return false
      // Inclusive, and tolerant of the bounds being typed the wrong way round.
      return (
        cell >= Math.min(operand, other) && cell <= Math.max(operand, other)
      )
    }
    default:
      return true
  }
}

/**
 * The whole rule set against one row. Rules that are incomplete, or that point
 * at a column the table no longer has, are dropped before combining - dropping
 * them is neutral under AND *and* under OR, whereas answering true or false for
 * them would not be.
 *
 * An empty (or entirely unusable) rule set means "no opinion" and returns true.
 */
export function evaluateRuleSet(
  search: GlobalSearchValue,
  resolve: ColumnResolver,
): boolean {
  const allRules = search.rules ?? []
  const fallback: Combinator = search.combinator === 'or' ? 'or' : 'and'
  const connectors = search.connectors

  // The connector sitting in the gap *before* the rule at `originalIndex`.
  // Anything the array does not spell out (or spells out wrongly) falls back to
  // the shared combinator, so a legacy value with no `connectors` behaves
  // exactly as before.
  const connectorBefore = (originalIndex: number): Combinator => {
    const c = connectors?.[originalIndex - 1]
    return c === 'or' || c === 'and' ? c : fallback
  }

  // Usable rules are complete and resolvable, kept in order, each tagged with
  // the connector that joins it to the previous one. Incomplete or merged-away
  // rules are dropped - neutral under both AND and OR - rather than answering
  // true/false for a rule that means nothing.
  const usable: { pass: boolean; join: Combinator }[] = []
  for (let i = 0; i < allRules.length; i++) {
    const rule = allRules[i]
    if (!isRuleComplete(rule)) continue
    const resolved = resolve(rule.columnId)
    if (!resolved) continue
    usable.push({ pass: evaluateRule(rule, resolved), join: connectorBefore(i) })
  }

  if (!usable.length) return true

  // AND binds tighter than OR, so the whole set is an OR of AND-groups: an `and`
  // join extends the current group, an `or` join closes it and opens a new one.
  // `A AND B OR C` is therefore `(A AND B) OR C`.
  let anyGroupPassed = false
  let groupPass = usable[0].pass
  for (let i = 1; i < usable.length; i++) {
    if (usable[i].join === 'or') {
      anyGroupPassed = anyGroupPassed || groupPass
      groupPass = usable[i].pass
    } else {
      groupPass = groupPass && usable[i].pass
    }
  }
  return anyGroupPassed || groupPass
}

export function isGlobalSearchEmpty(value: GlobalSearchValue) {
  return (
    !value.text &&
    value.values.length === 0 &&
    !(value.rules ?? []).some(isRuleComplete)
  )
}

export function isValueSelected(
  value: GlobalSearchValue,
  columnId: string,
  candidate: string,
) {
  return value.values.some(
    (selected) =>
      selected.columnId === columnId && selected.value === candidate,
  )
}

/**
 * The free-text half: fuzzy text ORed with the ticked suggestions, judged one
 * column at a time. "No text and no chips" is an opinion-free true, so a
 * rules-only query is not narrowed by it.
 */
export function matchesFreeText(
  row: Row<any>,
  columnId: string,
  search: GlobalSearchValue,
) {
  const hasText = !!search.text
  const hasValues = search.values.length > 0
  if (!hasText && !hasValues) return true

  // Column scoping only ever constrained the free text, so it is checked here
  // rather than around the rules.
  if (search.columns.length && !search.columns.includes(columnId)) return false

  const cellValue = row.getValue(columnId)

  // Ticked suggestions match exactly, and only against their own column.
  if (hasValues && isValueSelected(search, columnId, String(cellValue))) {
    return true
  }

  if (hasText) return rankItem(cellValue, search.text).passed

  return false
}

// Lazily indexes the row's cells, so a query with no rules never pays for it.
function rowResolver(row: Row<any>): ColumnResolver {
  let cells: Record<string, Cell<any, unknown>> | null = null

  return (columnId) => {
    if (!cells) {
      cells = {}
      for (const cell of row.getAllCells()) cells[cell.column.id] = cell
    }
    const cell = cells[columnId]
    if (!cell) return undefined
    return { value: cell.getValue(), options: cell.column.columnDef.meta }
  }
}

/**
 * Global filter.
 *
 * TanStack runs this once per globally-filterable column and keeps the row as
 * soon as one column returns true, so the function is really answering "does
 * this row survive *because of* this column?".
 *
 * A rule set is row-level - `firstName contains X AND salary >= 20` cannot be
 * judged one column at a time - so it is evaluated against the whole row and
 * returns the same verdict whichever column is asking. ANDing that
 * column-independent verdict with the per-column free-text verdict makes the
 * OR TanStack performs collapse to:
 *
 *   (rules match the row) AND (some column matches the free text)
 *
 * which is the intended semantics: two ANDed rules on different columns cannot
 * be satisfied by a row that only matches one of them.
 */
export const globalSearchFilter: FilterFn<any> = (row, columnId, filterValue) => {
  const search = filterValue as GlobalSearchValue | undefined
  if (!search || isGlobalSearchEmpty(search)) return true

  if (!evaluateRuleSet(search, rowResolver(row))) return false

  return matchesFreeText(row, columnId, search)
}
