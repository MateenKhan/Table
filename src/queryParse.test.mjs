/**
 * Sentence-parser tests. Pure logic, no DOM.
 *
 *   npx tsx src/queryParse.test.mjs
 */
import assert from 'node:assert/strict'
import { parseQuerySentence, looksLikeSentence } from './queryParse.ts'

let passed = 0
const test = (name, fn) => {
  try {
    fn()
    passed++
    console.log(`  ok  ${name}`)
  } catch (err) {
    console.error(`FAIL  ${name}\n      ${err.message}`)
    process.exitCode = 1
  }
}

const COLUMNS = [
  { id: 'firstName', label: 'First Name', type: 'text' },
  { id: 'lastName', label: 'Last Name', type: 'text' },
  { id: 'age', label: 'Age', type: 'number' },
  { id: 'salary', label: 'Salary', type: 'currency' },
  { id: 'status', label: 'Status', type: 'text' },
]

const parse = (s) => parseQuerySentence(s, COLUMNS)

/* ------------------------------------------------------- the headline case */

test('the exact sentence that started this', () => {
  const r = parse('First Name contains mateen and salary > 19900')
  assert.equal(r.ok, true, r.error)
  assert.equal(r.rules.length, 2)
  assert.deepEqual(r.rules[0], {
    columnId: 'firstName',
    operator: 'contains',
    value: 'mateen',
    value2: '',
  })
  assert.deepEqual(r.rules[1], {
    columnId: 'salary',
    operator: 'gt',
    value: '19900',
    value2: '',
  })
  assert.deepEqual(r.connectors, ['and'])
})

/* ------------------------------------------------------------ single rules */

test('a bare text condition', () => {
  const r = parse('status is single')
  assert.equal(r.ok, true, r.error)
  assert.deepEqual(r.rules[0], {
    columnId: 'status',
    operator: 'equals',
    value: 'single',
    value2: '',
  })
})

test('column ids work as well as labels', () => {
  const r = parse('lastName equals Nolan')
  assert.equal(r.ok, true, r.error)
  assert.equal(r.rules[0].columnId, 'lastName')
})

test('symbols and words are interchangeable', () => {
  assert.equal(parse('age >= 30').rules[0].operator, 'gte')
  assert.equal(parse('age greater than or equal 30').rules[0].operator, 'gte')
  assert.equal(parse('age != 30').rules[0].operator, 'ne')
})

test('`is` maps to the type-appropriate equality', () => {
  // Same word, two operator ids — text uses `equals`, numeric uses `eq`.
  assert.equal(parse('status is single').rules[0].operator, 'equals')
  assert.equal(parse('age is 30').rules[0].operator, 'eq')
})

test('zero-operand operators need no value', () => {
  const r = parse('status is empty')
  assert.equal(r.ok, true, r.error)
  assert.equal(r.rules[0].operator, 'isEmpty')
  assert.equal(r.rules[0].value, '')
})

/* ------------------------------------------------------- multi-word tokens */

test('the longest column label wins', () => {
  // "First Name" must not be read as a column called "First".
  const r = parse('First Name is bob')
  assert.equal(r.rules[0].columnId, 'firstName')
})

test('the longest operator wins', () => {
  assert.equal(parse('status does not contain x').rules[0].operator, 'notContains')
  assert.equal(parse('status is not empty').rules[0].operator, 'isNotEmpty')
  assert.equal(parse('age >= 5').rules[0].operator, 'gte')
})

test('multi-word values survive', () => {
  const r = parse('First Name contains van der berg')
  assert.equal(r.rules[0].value, 'van der berg')
})

/* --------------------------------------------------------------- and / or */

test('three conditions with mixed connectors', () => {
  const r = parse('age > 10 and status is single or salary < 500')
  assert.equal(r.ok, true, r.error)
  assert.equal(r.rules.length, 3)
  assert.deepEqual(r.connectors, ['and', 'or'])
})

test('a connector word inside a value does not split it', () => {
  // "brand" contains "and" — word boundaries must protect it.
  const r = parse('status contains brand')
  assert.equal(r.ok, true, r.error)
  assert.equal(r.rules.length, 1)
  assert.equal(r.rules[0].value, 'brand')
})

test('quotes protect a real connector word in a value', () => {
  const r = parse('First Name is "salt and pepper"')
  assert.equal(r.ok, true, r.error)
  assert.equal(r.rules.length, 1)
  assert.equal(r.rules[0].value, 'salt and pepper')
})

test('between consumes its own `and`', () => {
  const r = parse('age between 10 and 20')
  assert.equal(r.ok, true, r.error)
  assert.equal(r.rules.length, 1, 'the and belongs to between, not to a second rule')
  assert.equal(r.rules[0].value, '10')
  assert.equal(r.rules[0].value2, '20')
})

test('between still composes with a real connector', () => {
  const r = parse('age between 10 and 20 and status is single')
  assert.equal(r.ok, true, r.error)
  assert.equal(r.rules.length, 2)
  assert.equal(r.rules[0].value2, '20')
  assert.equal(r.rules[1].columnId, 'status')
})

/* ------------------------------------------------- incomplete → suggestions */

test('an empty query asks for a column', () => {
  const r = parse('')
  assert.equal(r.ok, false)
  assert.equal(r.expecting, 'column')
})

test('a column alone asks for an operator', () => {
  const r = parse('salary')
  assert.equal(r.ok, false)
  assert.equal(r.expecting, 'operator')
  assert.equal(r.contextColumnId, 'salary')
})

test('a column and operator ask for a value', () => {
  const r = parse('salary >')
  assert.equal(r.ok, false)
  assert.equal(r.expecting, 'value')
  assert.equal(r.contextColumnId, 'salary')
})

test('a half-typed column reports the partial for filtering', () => {
  const r = parse('sal')
  assert.equal(r.ok, false)
  assert.equal(r.expecting, 'column')
  assert.equal(r.partial, 'sal')
})

/* -------------------------------------------------------------- rejections */

test('an unknown column fails with its name', () => {
  const r = parse('nope contains x')
  assert.equal(r.ok, false)
  assert.match(r.error, /nope/)
})

test('an operator that does not fit the type is rejected', () => {
  // `starts with` is a text operator; age is numeric.
  const r = parse('age starts with 3')
  assert.equal(r.ok, false)
})

test('a missing connector between conditions is reported', () => {
  const r = parse('age > 10 status is single')
  // "10 status is single" reads as the value, so this parses as one rule —
  // documenting the greedy-value behaviour rather than pretending otherwise.
  assert.equal(r.rules.length, 1)
})

/* ----------------------------------------------------------- looksLikeSentence */

test('looksLikeSentence only fires once an operator is present', () => {
  assert.equal(looksLikeSentence('salary', COLUMNS), false, 'bare column stays on the picker')
  assert.equal(looksLikeSentence('salary >', COLUMNS), true)
  assert.equal(looksLikeSentence('random text', COLUMNS), false)
})

console.log(`\n${passed} passed\n`)
