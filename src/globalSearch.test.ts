// Dependency-free unit tests for the query builder's rule engine.
// Run with:  npx tsx src/globalSearch.test.ts
import type { Row } from '@tanstack/react-table'
import {
  buildCommonSuggestions,
  canRuleOnType,
  coerceRuleToType,
  ColumnResolver,
  emptyGlobalSearch,
  evaluateRule,
  evaluateRuleSet,
  globalSearchFilter,
  GlobalSearchValue,
  invalidRuleReason,
  isGlobalSearchEmpty,
  isRuleComplete,
  matchScore,
  NUMERIC_OPERATORS,
  operandCount,
  operatorLabel,
  operatorsForType,
  parseOperand,
  QueryRule,
  querySummary,
  RuleOperator,
  selectTopN,
  TEXT_OPERATORS,
} from './globalSearch'
import type { TypeOptions } from './columnTypes'

/* ------------------------------------------------------------- the fixture */

type TestRow = Record<string, unknown>

// The same column types tableModels declares.
const COLUMN_OPTIONS: Record<string, TypeOptions> = {
  firstName: { type: 'text' },
  lastName: { type: 'text' },
  status: { type: 'text' },
  age: { type: 'number' },
  visits: { type: 'number' },
  progress: { type: 'decimal', decimals: 1, suffix: '%' },
  salary: { type: 'currency', currency: 'USD', decimals: 2 },
}

const COLUMN_IDS = Object.keys(COLUMN_OPTIONS)

const resolverFor =
  (row: TestRow): ColumnResolver =>
  (columnId) =>
    columnId in COLUMN_OPTIONS
      ? { value: row[columnId], options: COLUMN_OPTIONS[columnId] }
      : undefined

// Enough of a TanStack row for the real FilterFn to run against.
const fakeRow = (row: TestRow) =>
  ({
    getValue: (columnId: string) => row[columnId],
    getAllCells: () =>
      COLUMN_IDS.map((columnId) => ({
        column: { id: columnId, columnDef: { meta: COLUMN_OPTIONS[columnId] } },
        getValue: () => row[columnId],
      })),
  }) as unknown as Row<any>

// Exactly what getFilteredRowModel does: ask every globally-filterable column
// and keep the row as soon as one says yes.
const rowSurvives = (row: TestRow, search: GlobalSearchValue) =>
  COLUMN_IDS.some((columnId) =>
    globalSearchFilter(fakeRow(row), columnId, search, () => {}),
  )

const ann: TestRow = {
  firstName: 'Ann',
  lastName: 'Archer',
  status: 'single',
  age: 30,
  visits: 100,
  progress: 55.5,
  salary: 20000,
}
const bob: TestRow = {
  firstName: 'Bob',
  lastName: 'Barker',
  status: 'complicated',
  age: 12,
  visits: 0,
  progress: 5,
  salary: 500,
}
const blank: TestRow = {
  firstName: '',
  lastName: null,
  status: '   ',
  age: undefined,
  visits: 0,
  progress: 0,
  salary: '',
}

let seq = 0
const rule = (
  columnId: string,
  operator: RuleOperator,
  value = '',
  value2 = '',
): QueryRule => ({ id: `t${++seq}`, columnId, operator, value, value2 })

const query = (
  rules: QueryRule[],
  combinator: 'and' | 'or' = 'and',
  extra: Partial<GlobalSearchValue> = {},
): GlobalSearchValue => ({
  ...emptyGlobalSearch,
  ...extra,
  rules,
  combinator,
})

/* ------------------------------------------------------------ the harness */

let passed = 0
let failed = 0

const check = (label: string, actual: unknown, expected: unknown) => {
  if (Object.is(actual, expected)) {
    passed++
    console.log(`  ok   ${label}  ->  ${String(actual)}`)
  } else {
    failed++
    console.log(
      `  FAIL ${label}  ->  got ${String(actual)}, want ${String(expected)}`,
    )
  }
}

const evalOne = (row: TestRow, r: QueryRule) =>
  evaluateRule(r, resolverFor(row)(r.columnId)!)

const evalSet = (row: TestRow, search: GlobalSearchValue) =>
  evaluateRuleSet(search, resolverFor(row))

/* ------------------------------------------------- text operators, one rule */

console.log('\ntext operators')
check('contains', evalOne(ann, rule('firstName', 'contains', 'nn')), true)
check(
  'contains is case-insensitive',
  evalOne(ann, rule('firstName', 'contains', 'ANN')),
  true,
)
check('contains misses', evalOne(bob, rule('firstName', 'contains', 'nn')), false)
check(
  'does not contain',
  evalOne(bob, rule('firstName', 'notContains', 'nn')),
  true,
)
check(
  'does not contain misses',
  evalOne(ann, rule('firstName', 'notContains', 'nn')),
  false,
)
check('equals', evalOne(ann, rule('firstName', 'equals', 'ann')), true)
check(
  'equals is not a substring match',
  evalOne(ann, rule('firstName', 'equals', 'an')),
  false,
)
check('not equals', evalOne(ann, rule('firstName', 'notEquals', 'bob')), true)
check(
  'not equals misses',
  evalOne(ann, rule('firstName', 'notEquals', 'Ann')),
  false,
)
check('starts with', evalOne(bob, rule('lastName', 'startsWith', 'bar')), true)
check(
  'starts with misses',
  evalOne(bob, rule('lastName', 'startsWith', 'ker')),
  false,
)
check('ends with', evalOne(bob, rule('lastName', 'endsWith', 'ker')), true)
check(
  'ends with misses',
  evalOne(bob, rule('lastName', 'endsWith', 'bar')),
  false,
)
check('is empty on ""', evalOne(blank, rule('firstName', 'isEmpty')), true)
check('is empty on null', evalOne(blank, rule('lastName', 'isEmpty')), true)
check(
  'is empty on whitespace',
  evalOne(blank, rule('status', 'isEmpty')),
  true,
)
check('is empty misses', evalOne(ann, rule('firstName', 'isEmpty')), false)
check('is not empty', evalOne(ann, rule('firstName', 'isNotEmpty')), true)
check(
  'is not empty misses',
  evalOne(blank, rule('firstName', 'isNotEmpty')),
  false,
)

/* --------------------------------------------- numeric operators, one rule */

console.log('\nnumeric operators')
check('=', evalOne(ann, rule('age', 'eq', '30')), true)
check('= misses', evalOne(ann, rule('age', 'eq', '31')), false)
check('≠', evalOne(ann, rule('age', 'ne', '31')), true)
check('≠ misses', evalOne(ann, rule('age', 'ne', '30')), false)
check('>', evalOne(ann, rule('age', 'gt', '29')), true)
check('> is strict', evalOne(ann, rule('age', 'gt', '30')), false)
check('≥', evalOne(ann, rule('age', 'gte', '30')), true)
check('≥ misses', evalOne(ann, rule('age', 'gte', '31')), false)
check('<', evalOne(bob, rule('age', 'lt', '13')), true)
check('< is strict', evalOne(bob, rule('age', 'lt', '12')), false)
check('≤', evalOne(bob, rule('age', 'lte', '12')), true)
check('≤ misses', evalOne(bob, rule('age', 'lte', '11')), false)
check('decimal column compares', evalOne(ann, rule('progress', 'gt', '55')), true)
check(
  'numeric is empty on undefined',
  evalOne(blank, rule('age', 'isEmpty')),
  true,
)
check(
  'numeric is empty on 0 is false',
  evalOne(blank, rule('visits', 'isEmpty')),
  false,
)
check(
  'a blank cell fails a comparison rather than throwing',
  evalOne(blank, rule('age', 'gt', '1')),
  false,
)
check(
  'a non-numeric cell (formula #ERROR) fails a comparison',
  evalOne({ age: '#ERROR' }, rule('age', 'gt', '1')),
  false,
)
check(
  'a non-numeric operand selects nothing',
  evalOne(ann, rule('age', 'gt', 'abc')),
  false,
)

/* ---------------------------------------------------------------- between */

console.log('\nbetween')
check('between includes', evalOne(ann, rule('age', 'between', '20', '40')), true)
check(
  'between is inclusive at the low bound',
  evalOne(ann, rule('age', 'between', '30', '40')),
  true,
)
check(
  'between is inclusive at the high bound',
  evalOne(ann, rule('age', 'between', '20', '30')),
  true,
)
check(
  'between excludes',
  evalOne(bob, rule('age', 'between', '20', '40')),
  false,
)
check(
  'between tolerates reversed bounds',
  evalOne(ann, rule('age', 'between', '40', '20')),
  true,
)
check(
  'between on currency with symbols',
  evalOne(ann, rule('salary', 'between', '$10,000', '$30,000')),
  true,
)

/* -------------------------------------------------------- operand coercion */

console.log('\noperand coercion')
check('plain digits', parseOperand('20000', COLUMN_OPTIONS.salary), 20000)
check('currency symbol', parseOperand('$20,000', COLUMN_OPTIONS.salary), 20000)
check('thousands separator', parseOperand('20,000', COLUMN_OPTIONS.salary), 20000)
check('surrounding spaces', parseOperand('  20000  ', COLUMN_OPTIONS.salary), 20000)
check('currency keeps decimals', parseOperand('$1.50', COLUMN_OPTIONS.salary), 1.5)
check(
  'an integer column truncates its operand, like its editor',
  parseOperand('20.7', COLUMN_OPTIONS.age),
  20,
)
check('a decimal column keeps a decimal', parseOperand('55.5', COLUMN_OPTIONS.progress), 55.5)
check('a suffixed operand still parses', parseOperand('55.5%', COLUMN_OPTIONS.progress), 55.5)
check('no digits is not a number', Number.isNaN(parseOperand('abc', COLUMN_OPTIONS.age)), true)
check('empty is not a number', Number.isNaN(parseOperand('   ', COLUMN_OPTIONS.age)), true)
check(
  '$20,000 and 20000 mean the same thing',
  evalOne(ann, rule('salary', 'eq', '$20,000')) &&
    evalOne(ann, rule('salary', 'eq', '20000')),
  true,
)

/* --------------------------------------------- AND / OR across two columns */

console.log('\ncombinators across columns')
// The correctness bar: `firstName contains ann AND salary >= 20000`.
const bothRules = [
  rule('firstName', 'contains', 'ann'),
  rule('salary', 'gte', '20000'),
]
const partial: TestRow = { ...ann, salary: 10 }

check('AND: a row matching both passes', evalSet(ann, query(bothRules)), true)
check(
  'AND: a row matching only one column is excluded',
  evalSet(partial, query(bothRules)),
  false,
)
check(
  'AND: a row matching neither is excluded',
  evalSet(bob, query(bothRules)),
  false,
)
check('OR: a row matching only one column is kept', evalSet(partial, query(bothRules, 'or')), true)
check('OR: a row matching neither is excluded', evalSet(bob, query(bothRules, 'or')), false)
check('OR: a row matching both is kept', evalSet(ann, query(bothRules, 'or')), true)
check(
  'three ANDed rules need all three',
  evalSet(
    ann,
    query([...bothRules, rule('status', 'equals', 'single')]),
  ),
  true,
)
check(
  'three ANDed rules fail on the third',
  evalSet(ann, query([...bothRules, rule('status', 'equals', 'married')])),
  false,
)

/* ----------------------------------------------------- incomplete rules */

console.log('\nincomplete rules are ignored')
check('no column picked', isRuleComplete(rule('', 'contains', 'x')), false)
check('empty operand', isRuleComplete(rule('firstName', 'contains', '')), false)
check(
  'whitespace operand',
  isRuleComplete(rule('firstName', 'contains', '   ')),
  false,
)
check(
  'between with one bound',
  isRuleComplete(rule('age', 'between', '20', '')),
  false,
)
check('between with both bounds', isRuleComplete(rule('age', 'between', '20', '40')), true)
check('is empty needs no operand', isRuleComplete(rule('firstName', 'isEmpty')), true)
check('a filled rule is complete', isRuleComplete(rule('firstName', 'contains', 'a')), true)
check(
  'an unknown operator is not complete',
  isRuleComplete(rule('firstName', 'nope' as RuleOperator, 'a')),
  false,
)
check(
  'a half-typed rule does not blank the grid',
  evalSet(bob, query([rule('firstName', 'contains', '')])),
  true,
)
check(
  'a half-typed rule is skipped, the finished one still applies',
  evalSet(bob, query([rule('firstName', 'contains', ''), rule('age', 'gt', '100')])),
  false,
)
check(
  'an empty rule list matches every row',
  evalSet(bob, query([])),
  true,
)
check(
  'a rule on a merged-away column is ignored, not failed',
  evalSet(ann, query([rule('ghost', 'contains', 'x')])),
  true,
)
check(
  'ORing with a merged-away column does not widen the query',
  evalSet(bob, query([rule('ghost', 'contains', 'x'), rule('age', 'gt', '100')], 'or')),
  false,
)

/* ------------------------------------------------------ isGlobalSearchEmpty */

console.log('\nisGlobalSearchEmpty')
check('nothing at all', isGlobalSearchEmpty(emptyGlobalSearch), true)
check(
  'free text only',
  isGlobalSearchEmpty({ ...emptyGlobalSearch, text: 'ann' }),
  false,
)
check(
  'ticked suggestion only',
  isGlobalSearchEmpty({
    ...emptyGlobalSearch,
    values: [{ columnId: 'firstName', value: 'Ann' }],
  }),
  false,
)
check(
  'column scope alone is not a query',
  isGlobalSearchEmpty({ ...emptyGlobalSearch, columns: ['firstName'] }),
  true,
)
check(
  'one complete rule',
  isGlobalSearchEmpty(query([rule('age', 'gt', '10')])),
  false,
)
check(
  'one operand-free rule',
  isGlobalSearchEmpty(query([rule('firstName', 'isEmpty')])),
  false,
)
check(
  'only incomplete rules',
  isGlobalSearchEmpty(query([rule('firstName', 'contains', ''), rule('', 'eq', '3')])),
  true,
)
check(
  'incomplete rules plus text',
  isGlobalSearchEmpty(query([rule('', 'contains', '')], 'and', { text: 'a' })),
  false,
)
check(
  'a legacy value without rules is tolerated',
  isGlobalSearchEmpty({
    text: '',
    values: [],
    columns: [],
  } as unknown as GlobalSearchValue),
  true,
)

/* ---------------------------------- the real FilterFn, per-column semantics */

console.log('\nglobalSearchFilter (per-column contract)')
check(
  'an empty search keeps every row',
  globalSearchFilter(fakeRow(bob), 'firstName', emptyGlobalSearch, () => {}),
  true,
)
check(
  'the rule verdict does not depend on which column is asking (matching row)',
  COLUMN_IDS.every((columnId) =>
    globalSearchFilter(fakeRow(ann), columnId, query(bothRules), () => {}),
  ),
  true,
)
check(
  'the rule verdict does not depend on which column is asking (failing row)',
  COLUMN_IDS.some((columnId) =>
    globalSearchFilter(fakeRow(partial), columnId, query(bothRules), () => {}),
  ),
  false,
)
check(
  'ANDed rules: the matching row survives TanStack\'s per-column OR',
  rowSurvives(ann, query(bothRules)),
  true,
)
check(
  'ANDed rules: the partially matching row is excluded by the per-column OR',
  rowSurvives(partial, query(bothRules)),
  false,
)
check(
  'ORed rules: the partially matching row survives',
  rowSurvives(partial, query(bothRules, 'or')),
  true,
)
check(
  'free text and rules compose with AND (both hold)',
  rowSurvives(ann, query([rule('age', 'gt', '20')], 'and', { text: 'Archer' })),
  true,
)
check(
  'free text and rules compose with AND (text misses)',
  rowSurvives(ann, query([rule('age', 'gt', '20')], 'and', { text: 'zzzzzz' })),
  false,
)
check(
  'free text and rules compose with AND (rule misses)',
  rowSurvives(ann, query([rule('age', 'gt', '90')], 'and', { text: 'Archer' })),
  false,
)
check(
  'a ticked suggestion still matches on its own column',
  rowSurvives(ann, {
    ...emptyGlobalSearch,
    values: [{ columnId: 'firstName', value: 'Ann' }],
  }),
  true,
)
check(
  'a ticked suggestion does not match another row',
  rowSurvives(bob, {
    ...emptyGlobalSearch,
    values: [{ columnId: 'firstName', value: 'Ann' }],
  }),
  false,
)
check(
  'column scope still narrows the free text',
  rowSurvives(ann, {
    ...emptyGlobalSearch,
    text: 'Archer',
    columns: ['firstName'],
  }),
  false,
)
check(
  'column scope does not narrow the rules',
  rowSurvives(ann, query([rule('salary', 'gte', '20000')], 'and', { columns: ['firstName'] })),
  true,
)

/* ------------------------------------------------------ operator catalogue */

console.log('\noperator catalogue')
check('text columns get 8 operators', operatorsForType('text').length, 8)
check('numeric columns get 8 operators', operatorsForType('number').length, 8)
check('currency is numeric', operatorsForType('currency'), NUMERIC_OPERATORS)
check('decimal is numeric', operatorsForType('decimal'), NUMERIC_OPERATORS)
check('an untyped column falls back to text', operatorsForType(undefined), TEXT_OPERATORS)
check('is empty takes no operand', operandCount('isEmpty'), 0)
check('between takes two operands', operandCount('between'), 2)
check('contains takes one operand', operandCount('contains'), 1)
check('operator label for contains', operatorLabel('contains'), 'contains')
check('operator label for gte is a symbol', operatorLabel('gte'), '≥')
check('operator label for isEmpty', operatorLabel('isEmpty'), 'is empty')
check(
  'operator label falls back to the raw id',
  operatorLabel('nope' as RuleOperator),
  'nope',
)
check('attachments cannot be queried', canRuleOnType('file'), false)
check('images cannot be queried', canRuleOnType('image'), false)
check('text can be queried', canRuleOnType('text'), true)
check(
  'switching a text rule to a numeric column resets the operator',
  coerceRuleToType(rule('salary', 'contains', 'ann'), 'currency').operator,
  'eq',
)
check(
  'switching a text rule to a numeric column drops the operand',
  coerceRuleToType(rule('salary', 'contains', 'ann'), 'currency').value,
  '',
)
check(
  'a still-legal operator is kept as is',
  coerceRuleToType(rule('firstName', 'endsWith', 'nn'), 'text').operator,
  'endsWith',
)
check(
  'is empty survives a type change, it exists on both sides',
  coerceRuleToType(rule('age', 'isEmpty'), 'text').operator,
  'isEmpty',
)

/* ------------------------------------------------ schema-driven suggestions */

console.log('\nbuildCommonSuggestions (from schema, never from data)')
const schema = [
  { columnId: 'firstName', header: 'First Name', type: 'text' as const },
  { columnId: 'age', header: 'Age', type: 'number' as const },
  { columnId: 'salary', header: 'Salary', type: 'currency' as const },
  { columnId: 'progress', header: 'Profile Progress', type: 'decimal' as const },
]
const common = buildCommonSuggestions(schema)
check('only numeric columns earn shortcuts', common.length, 6)
check(
  'text columns are excluded',
  common.some((s) => s.columnId === 'firstName'),
  false,
)
check('a top shortcut is offered first', common[0].label, 'Top 10 Age')
check('a bottom shortcut follows it', common[1].label, 'Bottom 10 Age')
check('the shortcut carries the column id', common[0].columnId, 'age')
check('the shortcut direction is top', common[0].kind, 'top')
check('later numeric columns are covered too', common[2].label, 'Top 10 Salary')
check(
  'the label tracks the header, not a baked literal',
  buildCommonSuggestions([
    { columnId: 'salary', header: 'Amount', type: 'currency' },
  ])[0].label,
  'Top 10 Amount',
)
check(
  'the N is configurable',
  buildCommonSuggestions([{ columnId: 'age', header: 'Age', type: 'number' }], 5)[0]
    .label,
  'Top 5 Age',
)
check('an empty schema is safe', buildCommonSuggestions([]).length, 0)
check(
  'a column with no header falls back to its id',
  buildCommonSuggestions([{ columnId: 'x_val', header: '', type: 'number' }])[0]
    .label,
  'Top 10 x_val',
)

/* -------------------------------------------------------- selectTopN ranking */

console.log('\nselectTopN (the rank/limit core)')
const nums = [30, 12, 55, 1, 99, 40]
const top3 = selectTopN(nums, 3, 'top')
check('top 3 count', top3.indices.length, 3)
check('top 3 picks the highest first', top3.indices[0], 4) // 99
check('top 3 second highest', top3.indices[1], 2) // 55
check('top 3 third highest', top3.indices[2], 5) // 40
check('top 3 threshold is the lowest survivor', top3.threshold, 40)
const bottom2 = selectTopN(nums, 2, 'bottom')
check('bottom 2 picks the lowest first', bottom2.indices[0], 3) // 1
check('bottom 2 threshold', bottom2.threshold, 12)
check(
  'n larger than the data returns everything',
  selectTopN([1, 2], 10, 'top').indices.length,
  2,
)
check('n of zero returns nothing', selectTopN(nums, 0, 'top').indices.length, 0)
check(
  'an empty column has a null threshold',
  selectTopN([], 3, 'top').threshold,
  null,
)
check(
  'non-finite values are ignored, not ranked as NaN',
  selectTopN([NaN, 5, Infinity, 7], 2, 'top').indices.join(','),
  '3,1', // 7 then 5; NaN/Infinity skipped
)
const tie = selectTopN([50, 50, 50], 2, 'top')
check('ties are broken stably by original order', tie.indices.join(','), '0,1')

/* -------------------------------------------------------- matchScore ranking */

console.log('\nmatchScore (best match wins the highlight)')
check('an exact match scores highest', matchScore('Age', 'age'), 100)
check('a prefix match scores high', matchScore('Salary', 'sal'), 60)
check(
  'a word-boundary match beats a mid-token one',
  matchScore('First Name', 'name') > matchScore('surname', 'name'),
  true,
)
check('a mid-token match still matches', matchScore('surname', 'name'), 20)
check('no match is negative', matchScore('Age', 'zzz'), -1)
check('an empty needle is neutral', matchScore('anything', ''), 0)

/* ------------------------------------------------------ invalidRuleReason */

console.log('\ninvalidRuleReason (validation messages)')
check('a complete rule has no reason', invalidRuleReason(rule('age', 'gt', '5')), null)
check(
  'a value-less rule explains itself',
  invalidRuleReason(rule('age', 'gt', '')),
  'this condition needs a value',
)
check(
  'a half-range explains itself',
  invalidRuleReason(rule('age', 'between', '5', '')),
  'a range needs two values',
)
check(
  'a column-less rule explains itself',
  invalidRuleReason(rule('', 'contains', 'x')),
  'pick a column',
)
check(
  'a 0-operand rule is always valid',
  invalidRuleReason(rule('firstName', 'isEmpty')),
  null,
)
check(
  'an unknown operator explains itself',
  invalidRuleReason(rule('age', 'nope' as RuleOperator, '5')),
  'unknown operator',
)

/* ---------------------------------------------- per-gap connectors + precedence */

console.log('\nper-gap connectors (AND binds tighter than OR)')
const rT = rule('firstName', 'contains', 'ann') // true on ann
const rF1 = rule('age', 'eq', '999') // false on ann
const rF2 = rule('age', 'eq', '888') // false on ann
const rStatus = rule('status', 'equals', 'single') // true on ann

check(
  'AND binds tighter: T OR (F AND F) is true',
  evalSet(ann, query([rT, rF1, rF2], 'and', { connectors: ['or', 'and'] })),
  true,
)
check(
  'placement matters: (T AND F) OR F is false',
  evalSet(ann, query([rT, rF1, rF2], 'and', { connectors: ['and', 'or'] })),
  false,
)
check(
  'an OR branch rescues a failing AND group: (T AND F) OR T is true',
  evalSet(ann, query([rT, rF1, rStatus], 'and', { connectors: ['and', 'or'] })),
  true,
)
check(
  'an OR chain passes if any single passes',
  evalSet(ann, query([rF1, rF2, rStatus], 'and', { connectors: ['or', 'or'] })),
  true,
)
check(
  'an AND chain fails if any single fails',
  evalSet(ann, query([rT, rF1, rStatus], 'and', { connectors: ['and', 'and'] })),
  false,
)

console.log('\nconnectors: single-condition + backward compatibility')
check(
  'a single condition ignores connectors entirely',
  evalSet(ann, query([rT], 'and', { connectors: [] })),
  true,
)
check(
  'a single failing condition is just false',
  evalSet(ann, query([rF1], 'and', { connectors: [] })),
  false,
)
check(
  'a missing connector falls back to the shared combinator (or): T OR F',
  evalSet(ann, query([rT, rF1], 'or', { connectors: [] })),
  true,
)
check(
  'no connectors field at all uses the shared AND: T AND F',
  evalSet(ann, query([rT, rF1])),
  false,
)
check(
  'extra connectors beyond the gaps are ignored',
  evalSet(ann, query([rT, rF1], 'and', { connectors: ['and', 'or', 'and'] })),
  false,
)
check(
  'a dropped (incomplete) rule does not desync the surviving connectors',
  // rT AND (incomplete, dropped) OR rStatus  ->  usable is [rT, rStatus] joined
  // by the connector before rStatus ('or')  ->  T OR T  ->  true
  evalSet(
    ann,
    query([rT, rule('age', 'gt', ''), rStatus], 'and', {
      connectors: ['and', 'or'],
    }),
  ),
  true,
)

/* ------------------------------------------------------------- querySummary */

console.log('\nquerySummary (canonical one-line summary)')
check('an empty query summarises to an empty string', querySummary(emptyGlobalSearch), '')
check(
  'a single rule reads as its ruleSummary',
  querySummary(query([rule('firstName', 'notContains', 'mateen')])),
  'firstName does not contain "mateen"',
)
check(
  'per-gap connectors join the rules with their real labels',
  querySummary(
    query(
      [
        rule('firstName', 'notContains', 'mateen'),
        rule('salary', 'gte', '20'),
        rule('age', 'lt', '30'),
      ],
      'and',
      { connectors: ['and', 'or'] },
    ),
  ),
  'firstName does not contain "mateen"  AND  salary ≥ 20  OR  age < 30',
)
check(
  'incomplete rules are skipped in the summary',
  querySummary(
    query([rule('firstName', 'contains', 'a'), rule('', 'contains', '')]),
  ),
  'firstName contains "a"',
)
check(
  'free text is appended with AND',
  querySummary(query([rule('age', 'gt', '5')], 'and', { text: 'ann' })),
  'age > 5  AND  text contains "ann"',
)
check(
  'free text alone summarises on its own',
  querySummary(query([], 'and', { text: 'ann' })),
  'text contains "ann"',
)

console.log(
  `\n${passed} passed, ${failed} failed`,
)

if (failed > 0) {
  throw new Error(`${failed} globalSearch test(s) failed`)
}
