// Dependency-free unit tests for the formula engine.
// Run with:  npx tsx src/formula.test.ts
import {
  evaluateFormula,
  extractReferences,
  translateFormula,
  parseFormula,
  stringifyFormula,
  recalcFormulas,
  isFormula,
  createFunctionRegistry,
  customFunctions,
  findCircularKeys,
  ERROR_CIRCULAR,
} from './formula'
import type { FormulaMap } from './formula'
import {
  DATA_COLUMN_IDS,
  columnDeltaBetween,
  columnIdFromLetters,
  columnIndexForId,
  columnLetters,
  lettersForColumnId,
  lettersToIndex,
} from './columnOrder'
import { parseTSV, serializeTSV } from './clipboard'
import {
  applyFormulaPatch,
  cellWritesFor,
  HistoryEntry,
  isEmptyEntry,
  makeEntry,
  pushHistory,
} from './undo'

type Row = { age: number; visits: number; progress: number; firstName: string }

const data: Row[] = [
  { age: 10, visits: 100, progress: 5, firstName: 'Ann' },
  { age: 20, visits: 200, progress: 0, firstName: 'Bob' },
  { age: 30, visits: 300, progress: 15, firstName: 'Cid' },
  { age: 40, visits: 400, progress: 25, firstName: 'Dee' },
]

const ctx = (row: number) => ({
  currentRow: row,
  getCell: (r: number, c: string) =>
    (data[r] as unknown as Record<string, unknown> | undefined)?.[c],
})

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

const ev = (src: string, row = 0) => {
  const result = evaluateFormula(src, ctx(row))
  return result.ok ? result.value : result.error
}

console.log('\n-- evaluation (row 0 unless noted) --')
check('=age*2', ev('=age*2'), 20)
check('=visits+progress', ev('=visits+progress'), 105)
check('=1+2*3', ev('=1+2*3'), 7)
check('=(1+2)*3', ev('=(1+2)*3'), 9)
check('=-age', ev('=-age'), -10)
check('=2^3^2 (right assoc)', ev('=2^3^2'), 512)
check('=10/4', ev('=10/4'), 2.5)
check('=age/progress on row 1', ev('=age/progress', 1), '#DIV/0!')
check('=SUM(age, visits, 5)', ev('=SUM(age, visits, 5)'), 115)
check('=AVG(1,2,3,4)', ev('=AVG(1,2,3,4)'), 2.5)
check('=MIN(age, visits)', ev('=MIN(age, visits)'), 10)
check('=MAX(age, visits)', ev('=MAX(age, visits)'), 100)
check('=ROUND(10/3, 2)', ev('=ROUND(10/3, 2)'), 3.33)
check('=ROUND(2.5)', ev('=ROUND(2.5)'), 3)
check('=ROUND(-2.5) half away from zero', ev('=ROUND(-2.5)'), -3)
check('=ABS(0-7)', ev('=ABS(0-7)'), 7)
check('=age[3] row ref (1-based)', ev('=age[3]'), 30)
check('=age[$1] from row 2', ev('=age[$1]', 2), 10)
check('=SUM(age[1]:age[4])', ev('=SUM(age[1]:age[4])'), 100)
check('=COUNT(age[1]:age[4])', ev('=COUNT(age[1]:age[4])'), 4)
check('=AVG(visits[1]:visits[4])', ev('=AVG(visits[1]:visits[4])'), 250)
check('=age from row 2', ev('=age', 2), 30)
check('lowercase fn name', ev('=sum(age, 1)'), 11)
check('text column ref', ev('=firstName*2'), '#ERROR')
check('unknown function', ev('=FOO(1)'), '#ERROR')
check('unbalanced paren', ev('=(1+2'), '#ERROR')
check('garbage characters', ev('=@@@'), '#ERROR')
check('empty formula', ev('='), '#ERROR')
check('range across columns', ev('=SUM(age[1]:visits[2])'), '#ERROR')
check('range used as scalar', ev('=age[1]:age[2] + 1'), '#ERROR')
check('trailing operator', ev('=age *'), '#ERROR')

console.log('\n-- isFormula --')
check('isFormula("=1")', isFormula('=1'), true)
check('isFormula("1")', isFormula('1'), false)
check('isFormula(5)', isFormula(5), false)

console.log('\n-- parse / stringify round trip --')
const rt = (src: string) => stringifyFormula(parseFormula(src)!)
check('=age*2+1', rt('=age*2+1'), '=age * 2 + 1')
check('=(1+2)*3 keeps parens', rt('=(1+2)*3'), '=(1 + 2) * 3')
check('=age-(visits-progress)', rt('=age-(visits-progress)'), '=age - (visits - progress)')
check('=age-visits+progress', rt('=age-visits+progress'), '=age - visits + progress')
check('=-(age+visits)', rt('=-(age+visits)'), '=-(age + visits)')
check('=SUM(age[1]:age[4])', rt('=SUM(age[1]:age[4])'), '=SUM(age[1]:age[4])')
check('=ROUND(age/3, 2)', rt('=ROUND(age/3, 2)'), '=ROUND(age / 3, 2)')

console.log('\n-- relative translation (fill by N rows) --')
check('bare col ref is already relative', translateFormula('=age*2', 3), '=age*2')
check('=age[1]+1 by 3', translateFormula('=age[1]+1', 3), '=age[4] + 1')
check('=age[$1]+1 by 3 stays absolute', translateFormula('=age[$1]+1', 3), '=age[$1]+1')
check('=SUM(age[1]:age[3]) by 2', translateFormula('=SUM(age[1]:age[3])', 2), '=SUM(age[3]:age[5])')
check('mixed abs + rel by 5', translateFormula('=age[2]+age[$2]', 5), '=age[7] + age[$2]')
check('negative delta clamps to row 1', translateFormula('=age[2]', -10), '=age[1]')
check('unparseable passes through', translateFormula('=(((', 3), '=(((')
check('delta 0 is identity', translateFormula('=age[1]  +1', 0), '=age[1]  +1')

console.log('\n-- recalcFormulas --')
const formulas = {
  '0:doubled': '=age*2',
  '1:doubled': '=age*2',
  '0:chained': '=doubled+1',
  '1:chained': '=doubled+1',
}
const base = [
  { age: 10, doubled: 0 as unknown, chained: 0 as unknown },
  { age: 20, doubled: 0 as unknown, chained: 0 as unknown },
]
const out = recalcFormulas(base, formulas)
check('row0 doubled', out[0].doubled, 20)
check('row1 doubled', out[1].doubled, 40)
check('row0 chained settles in one call', out[0].chained, 21)
check('row1 chained settles in one call', out[1].chained, 41)
check('returns a new array when changed', out !== base, true)
check('idempotent (same reference back)', recalcFormulas(out, formulas) === out, true)
check('no formulas -> same reference', recalcFormulas(base, {}) === base, true)
check(
  'bad formula stores #ERROR',
  recalcFormulas(base, { '0:doubled': '=@@' })[0].doubled,
  '#ERROR',
)
check(
  'out-of-range data index is skipped',
  recalcFormulas(base, { '99:doubled': '=age*2' }) === base,
  true,
)

/* ======================================================== A1 references == */

console.log('\n-- letter <-> column index --')
check('columnLetters(0)', columnLetters(0), 'A')
check('columnLetters(25)', columnLetters(25), 'Z')
check('columnLetters(26)', columnLetters(26), 'AA')
check('columnLetters(27)', columnLetters(27), 'AB')
check('columnLetters(701)', columnLetters(701), 'ZZ')
check('columnLetters(702)', columnLetters(702), 'AAA')
check('columnLetters(-1)', columnLetters(-1), '')
check('lettersToIndex("A")', lettersToIndex('A'), 0)
check('lettersToIndex("z") case-insensitive', lettersToIndex('z'), 25)
check('lettersToIndex("AA")', lettersToIndex('AA'), 26)
check('lettersToIndex("ZZ")', lettersToIndex('ZZ'), 701)
check('lettersToIndex("AAA")', lettersToIndex('AAA'), 702)
check('lettersToIndex("A1") rejected', lettersToIndex('A1'), -1)
check('lettersToIndex("") rejected', lettersToIndex(''), -1)
check('lettersToIndex(long) rejected', lettersToIndex('ABCDEFGH'), -1)
check(
  'letters round trip over every index',
  DATA_COLUMN_IDS.every((_, index) => lettersToIndex(columnLetters(index)) === index),
  true,
)

console.log('\n-- letters map to definition order, select excluded --')
check('A is the first data column', columnIdFromLetters('A'), 'avatar')
check('B', columnIdFromLetters('B'), 'firstName')
check('D is the derived fullName', columnIdFromLetters('D'), 'fullName')
check('E', columnIdFromLetters('E'), 'age')
check('F', columnIdFromLetters('F'), 'visits')
check('J is the last data column', columnIdFromLetters('J'), 'attachment')
check('K is past the end', columnIdFromLetters('K'), '')
check('lettersForColumnId(age)', lettersForColumnId('age'), 'E')
check('lettersForColumnId(select) is unmapped', lettersForColumnId('select'), '')

// A row shape with every data column present, so letters can be exercised.
type GridRow = Record<string, unknown>

const attachmentValue = { name: 'notes.txt', mime: 'text/plain', size: 4, url: 'data:,', isObjectUrl: false }

const grid: GridRow[] = [
  { avatar: null, firstName: 'Ann', lastName: 'Ant', age: 10, visits: 100, status: 'single', progress: 5, salary: 1000, attachment: null },
  { avatar: attachmentValue, firstName: 'Bob', lastName: 'Bee', age: 20, visits: 200, status: 'single', progress: 0, salary: 2000, attachment: attachmentValue },
  { avatar: null, firstName: 'Cid', lastName: 'Cow', age: 30, visits: 300, status: 'complicated', progress: 15, salary: 3000, attachment: null },
  { avatar: null, firstName: 'Dee', lastName: 'Doe', age: 40, visits: 400, status: 'single', progress: 25, salary: 4000, attachment: null },
]

const gctx = (row: number) => ({
  currentRow: row,
  getCell: (r: number, c: string) => grid[r]?.[c],
})

const gev = (src: string, row = 0) => {
  const result = evaluateFormula(src, gctx(row))
  return result.ok ? result.value : result.error
}

console.log('\n-- A1 evaluation --')
check('=E1 is age row 1', gev('=E1'), 10)
check('=E1+F2', gev('=E1+F2'), 210)
check('lowercase =e1', gev('=e1'), 10)
check('=E1*2', gev('=E1*2'), 20)
check('=I1 salary', gev('=I1'), 1000)
check('=$E$1 from row 2', gev('=$E$1', 2), 10)
check('=E$1 from row 2', gev('=E$1', 2), 10)
check('=$E1 from row 2', gev('=$E1', 2), 10)
check('=E1 + age mixed notation (row 1)', gev('=E1 + age', 1), 30)
check('=SUM(E1:E4)', gev('=SUM(E1:E4)'), 100)
check('=COUNT(E1:E4)', gev('=COUNT(E1:E4)'), 4)
check('=AVG(F1:F4)', gev('=AVG(F1:F4)'), 250)
check('=MAX(E1:E4)', gev('=MAX(E1:E4)'), 40)
check('rectangular =SUM(E1:F2)', gev('=SUM(E1:F2)'), 330)
check('rectangular =COUNT(E1:F2)', gev('=COUNT(E1:F2)'), 4)
check('rectangular reversed =SUM(F2:E1)', gev('=SUM(F2:E1)'), 330)
check('rectangular with $ anchors', gev('=SUM($E$1:$F$2)'), 330)
check('=SUM(E1:E4)/COUNT(E1:E4)', gev('=SUM(E1:E4)/COUNT(E1:E4)'), 25)
check('A1 node is a plain ref node', parseFormula('=E1')!.kind, 'ref')
check('A1 range is a plain range node', parseFormula('=E1:E4')!.kind, 'range')

console.log('\n-- A1 failure modes --')
check('letter past last column', gev('=K1'), '#ERROR')
check('multi-letter past last column', gev('=ZZ1'), '#ERROR')
check('row 0 does not exist', gev('=E0'), '#ERROR')
check('avatar (attachment column, empty)', gev('=A1'), '#ERROR')
check('attachment column (filled)', gev('=J2'), '#ERROR')
check('range over an attachment column', gev('=SUM(A1:A2)'), '#ERROR')
check('fullName is derived text', gev('=D1'), '#ERROR')
check('status is text', gev('=G1'), '#ERROR')
check('mixed-notation range rejected', gev('=SUM(E1:age[2])'), '#ERROR')
check('named cross-column range still rejected', gev('=SUM(age[1]:visits[2])'), '#ERROR')
check('huge rectangular range is guarded', gev('=SUM(E1:F20000)'), '#ERROR')
check('lone $ is not a formula', gev('=$'), '#ERROR')
check('$ before a column id', gev('=$age'), '#ERROR')
check('unknown column id still reads as empty', gev('=nosuchcolumn+1'), 1)
check('bare letter is not a cell reference', gev('=E+1'), 1)

console.log('\n-- A1 round trip --')
check('=A1+B2', rt('=A1+B2'), '=A1 + B2')
check('=$A$1', rt('=$A$1'), '=$A$1')
check('=A$1', rt('=A$1'), '=A$1')
check('=$A1', rt('=$A1'), '=$A1')
check('lowercase normalises', rt('=a1'), '=A1')
check('=AA12 multi-letter', rt('=AA12'), '=AA12')
check('=SUM(A1:A5)', rt('=SUM(A1:A5)'), '=SUM(A1:A5)')
check('=SUM(A1:C5) rectangular', rt('=SUM(A1:C5)'), '=SUM(A1:C5)')
check('=SUM($A$1:$C$5)', rt('=SUM($A$1:$C$5)'), '=SUM($A$1:$C$5)')
check('mixed anchors in a range', rt('=SUM($A1:C$5)'), '=SUM($A1:C$5)')
check('=A1 + age keeps both notations', rt('=A1 + age'), '=A1 + age')
check('named refs are not rewritten to letters', rt('=age[1]'), '=age[1]')
check('named ref with $ stays named', rt('=age[$1]'), '=age[$1]')
check('=ROUND(A1/B2, 2)', rt('=ROUND(A1/B2, 2)'), '=ROUND(A1 / B2, 2)')

console.log('\n-- A1 fill translation --')
check('=A1+1 by 3', translateFormula('=A1+1', 3), '=A4 + 1')
check('=$A1+1 by 3 (row still relative)', translateFormula('=$A1+1', 3), '=$A4 + 1')
check('=$A$1+1 by 3 stays put', translateFormula('=$A$1+1', 3), '=$A$1+1')
check('=A$1+1 by 3 stays put', translateFormula('=A$1+1', 3), '=A$1+1')
check('=SUM(A1:A3) by 2', translateFormula('=SUM(A1:A3)', 2), '=SUM(A3:A5)')
check('=A2 by -10 clamps to row 1', translateFormula('=A2', -10), '=A1')
check('mixed A1 + named by 2', translateFormula('=A1+age[1]', 2), '=A3 + age[3]')
check('column shift moves un-anchored letters', translateFormula('=A1', 0, 2), '=C1')
check('column shift skips $-anchored letters', translateFormula('=$A1', 0, 2), '=$A1')
check('row + column shift together', translateFormula('=A1+age', 1, 1), '=B2 + age')
check('column shift clamps at column A', translateFormula('=C1', 0, -10), '=A1')
check('no deltas is identity', translateFormula('=A1', 0, 0), '=A1')

/* ============================================ name+row references (age1) == */

console.log('\n-- name+row evaluation --')
check('=age1 is the age column, row 1', gev('=age1'), 10)
check('=visits1 is the visits column, row 1', gev('=visits1'), 100)
check('=salary1', gev('=salary1'), 1000)
check('=age2 is age row 2', gev('=age2'), 20)
check('=visits3 is visits row 3', gev('=visits3'), 300)
check('=age1*visits1', gev('=age1*visits1'), 1000)
check('=age1 + visits2', gev('=age1 + visits2'), 210)
check('name+row row past the end reads empty', gev('=visits99'), 0)
check('name+row into a text column errors', gev('=status1*2'), '#ERROR')

console.log('\n-- name+row resolution order --')
// Rule 2 beats A1: `age1` is "age row 1", NOT the out-of-range A1 letters `AGE`.
check(
  '=age1 parses as the age COLUMN (a named ref), not an A1 ref',
  (() => {
    const n = parseFormula('=age1')
    return !!n && n.kind === 'ref' && n.col === 'age' && !n.a1
  })(),
  true,
)
// A genuine A1 token (leading part is not a column) is still A1.
check('=E1 stays an A1 ref', parseFormula('=E1')!.kind === 'ref' && !!(parseFormula('=E1') as any).a1, true)
// The name+row split only fires when the leading part is a KNOWN column id.
// This same `isKnownColumnId` gate is what makes a column literally named `x1`
// win as a whole-column current-row ref (rule 1) instead of splitting to `x`+1.
check('unknown leading part does not become name+row (=zzz1)', gev('=zzz1'), '#ERROR')
// Rule 1: a whole token that is a known column id is a current-row ref.
check(
  '=age (a known column id) is a current-row ref',
  (() => {
    const n = parseFormula('=age')
    return !!n && n.kind === 'ref' && n.col === 'age' && n.row.mode === 'current'
  })(),
  true,
)

console.log('\n-- extractReferences (live highlight source) --')
const refs = (formula: string, row = 0) =>
  JSON.stringify(extractReferences(formula, row))
check('name+row refs', refs('=age1*visits1'), JSON.stringify([
  { columnId: 'age', dataRow: 0 },
  { columnId: 'visits', dataRow: 0 },
]))
check('A1 refs resolve to column ids', refs('=E1+F2'), JSON.stringify([
  { columnId: 'age', dataRow: 0 },
  { columnId: 'visits', dataRow: 1 },
]))
check('bare column ref uses the current data row', refs('=age', 2), JSON.stringify([
  { columnId: 'age', dataRow: 2 },
]))
check('a named range expands to every cell', refs('=SUM(age[1]:age[3])'), JSON.stringify([
  { columnId: 'age', dataRow: 0 },
  { columnId: 'age', dataRow: 1 },
  { columnId: 'age', dataRow: 2 },
]))
check('a rectangular A1 range expands both axes', refs('=SUM(E1:F2)'), JSON.stringify([
  { columnId: 'age', dataRow: 0 },
  { columnId: 'age', dataRow: 1 },
  { columnId: 'visits', dataRow: 0 },
  { columnId: 'visits', dataRow: 1 },
]))
check('references are de-duped', refs('=age1+age1'), JSON.stringify([
  { columnId: 'age', dataRow: 0 },
]))
check('a half-typed formula yields no refs, never throws', refs('=age1*'), JSON.stringify([]))
check('a constant formula references nothing', refs('=1+2'), JSON.stringify([]))
check('an unparseable draft yields no refs, never throws', refs('=((('), JSON.stringify([]))

/* =============================================== custom (user) functions == */

console.log('\n-- defining custom functions --')
const reg = createFunctionRegistry()

const cev = (src: string, row = 0) => {
  const result = evaluateFormula(src, { ...gctx(row), functions: reg })
  return result.ok ? result.value : result.error
}

const define = (name: string, params: string[], body: string) =>
  reg.define({ name, params, body })

const defineError = (name: string, params: string[], body: string) => {
  const result = reg.define({ name, params, body })
  return result.ok ? '(accepted)' : result.error
}

check('define SQFT', define('SQFT', ['w', 'h'], 'w * h / 144').ok, true)
check('=SQFT(12, 12)', cev('=SQFT(12, 12)'), 1)
check('=SQFT(288, 144)', cev('=SQFT(288, 144)'), 288)
check('case-insensitive invocation', cev('=sqft(12, 12)'), 1)
check('nested in an expression', cev('=SQFT(12, 12) + 1'), 2)
check('custom function inside a builtin', cev('=SUM(SQFT(12,12), 9)'), 10)
check('registry version advanced', reg.version > 0, true)
check('listed', reg.list().map((d) => d.name).join(','), 'SQFT')

console.log('\n-- arguments, columns and shadowing --')
check('define SHADOW(age)', define('SHADOW', ['age'], 'age * 2').ok, true)
check('param shadows the age column', cev('=SHADOW(5)'), 10)
check('...while the bare column still reads 10', cev('=age * 2'), 20)
check('define FROMROW', define('FROMROW', ['n'], 'age + n').ok, true)
check('body reads the calling row (row 0)', cev('=FROMROW(5)'), 15)
check('body reads the calling row (row 2)', cev('=FROMROW(5)', 2), 35)
check('define WITHA1', define('WITHA1', [], 'E1 * 2').ok, true)
check('body may use A1 refs', cev('=WITHA1()'), 20)
check('define OVERRANGE', define('OVERRANGE', [], 'SUM(E1:E4)').ok, true)
check('body may use ranges', cev('=OVERRANGE()'), 100)
check('define TAKESRANGE', define('TAKESRANGE', ['r'], 'SUM(r) + 1').ok, true)
check('a range may be passed as an argument', cev('=TAKESRANGE(E1:E4)'), 101)

console.log('\n-- custom functions calling custom functions --')
check('define DOUBLE', define('DOUBLE', ['x'], 'x * 2').ok, true)
check('define QUAD', define('QUAD', ['x'], 'DOUBLE(DOUBLE(x))').ok, true)
check('=QUAD(3)', cev('=QUAD(3)'), 12)
check('define AREA using SQFT', define('AREA', ['a'], 'SQFT(a, a)').ok, true)
check('=AREA(12)', cev('=AREA(12)'), 1)

console.log('\n-- recursion is refused, not hung --')
check('define self-recursive LOOPA', define('LOOPA', ['x'], 'LOOPA(x)').ok, true)
check('direct recursion -> #ERROR', cev('=LOOPA(1)'), '#ERROR')
check('define LOOPB', define('LOOPB', ['x'], 'LOOPC(x)').ok, true)
check('define LOOPC', define('LOOPC', ['x'], 'LOOPB(x)').ok, true)
check('indirect recursion -> #ERROR', cev('=LOOPB(1)'), '#ERROR')
check('indirect recursion from the other end', cev('=LOOPC(1)'), '#ERROR')
check('define SELFINSIDE', define('SELFINSIDE', ['x'], 'SUM(SELFINSIDE(x), 1)').ok, true)
check('recursion under a builtin -> #ERROR', cev('=SELFINSIDE(1)'), '#ERROR')
check('a good call still works after a cyclic one', cev('=SQFT(12, 12)'), 1)

console.log('\n-- call-time failures --')
check('too few arguments', cev('=SQFT(1)'), '#ERROR')
check('too many arguments', cev('=SQFT(1, 2, 3)'), '#ERROR')
check('undefined function', cev('=NOPE(1)'), '#ERROR')
check('zero-arg function called with an arg', cev('=WITHA1(1)'), '#ERROR')

console.log('\n-- definition-time validation --')
check('name collides with a builtin', defineError('SUM', ['x'], 'x'), 'SUM is a built-in function')
check('lowercase builtin collision', defineError('sum', ['x'], 'x'), 'SUM is a built-in function')
check('name already defined', defineError('SQFT', ['w', 'h'], 'w * h'), 'SQFT is already defined')
check(
  'overwrite is allowed explicitly',
  reg.define({ name: 'SQFT', params: ['w', 'h'], body: 'w * h / 144' }, { overwrite: true }).ok,
  true,
)
check('invalid name', defineError('2BAD', [], '1'), '"2BAD" is not a valid function name')
check('name that reads as a cell ref', defineError('B2', [], '1'), '"B2" would be read as a cell reference')
check('a digit-suffixed name that is not a cell is fine', defineError('SQFT2', [], '1'), '(accepted)')
check('empty name', defineError('', [], '1'), 'a function name is required')
check('duplicate parameters', defineError('DUP', ['a', 'a'], 'a'), 'duplicate parameter "a"')
check('parameter that reads as a cell ref', defineError('PBAD', ['b2'], 'b2'), '"b2" would be read as a cell reference')
check('unparseable body', defineError('BADBODY', [], '1 +'), 'the body is not a valid formula')
check('empty body', defineError('NOBODY', [], '   '), 'a function body is required')
check(
  'unknown identifier in body',
  defineError('UNKNOWN', ['x'], 'x + nosuchthing'),
  '"nosuchthing" is not a parameter or a column',
)
check(
  'A1 ref past the last column in body',
  defineError('OFFGRID', [], 'K1 + 1'),
  '"K" is not a column in this table',
)
check(
  'a parameter cannot take a row index',
  defineError('ROWPARAM', ['x'], 'x[2] + 1'),
  'parameter "x" cannot take a row reference',
)
check('a body may call a not-yet-defined function', defineError('FORWARD', ['x'], 'LATER(x)'), '(accepted)')
check('non-object definition', reg.define('nope').ok, false)

console.log('\n-- removal and registry bookkeeping --')
check('remove SQFT', reg.remove('sqft'), true)
check('dependent formula now errors', cev('=SQFT(12, 12)'), '#ERROR')
check('so does its caller', cev('=AREA(12)'), '#ERROR')
check('removing again is a no-op', reg.remove('SQFT'), false)
check('re-defining after removal works', define('SQFT', ['w', 'h'], 'w * h / 144').ok, true)
check('and the caller recovers', cev('=AREA(12)'), 1)
check('has() is case-insensitive', reg.has('sQfT'), true)
check('list() hands out copies', reg.list()[0] !== reg.list()[0], true)

let notified = 0
const unsubscribe = reg.subscribe(() => {
  notified++
})
const versionBefore = reg.version
define('NOTIFY', [], '1')
check('subscriber was notified', notified, 1)
check('version bumped', reg.version, versionBefore + 1)
unsubscribe()
reg.remove('NOTIFY')
check('unsubscribed listener is silent', notified, 1)

console.log('\n-- JSON round trip --')
const serialised = JSON.stringify(reg)
const restored = createFunctionRegistry()
const replaceResult = restored.replaceAll(JSON.parse(serialised))
check('replaceAll accepted the snapshot', replaceResult.ok, true)
check('same number of definitions', restored.list().length, reg.list().length)
check('same JSON both sides', JSON.stringify(restored), serialised)
check(
  'restored definitions still evaluate',
  evaluateFormula('=SQFT(12, 12)', { ...gctx(0), functions: restored }).ok,
  true,
)
check(
  'replaceAll rejects the whole batch on one bad entry',
  restored.replaceAll([{ name: 'OK1', params: [], body: '1' }, { name: 'SUM', params: [], body: '1' }]).ok,
  false,
)
check('...and leaves the live set untouched', restored.has('SQFT'), true)
check('replaceAll needs an array', restored.replaceAll('nope').ok, false)
check('clear empties the registry', (restored.clear(), restored.list().length), 0)

console.log('\n-- the shared registry needs no wiring --')
customFunctions.remove('TRIPLE')
check('define on the global registry', customFunctions.define({ name: 'TRIPLE', params: ['x'], body: 'x * 3' }).ok, true)
check('evaluateFormula picks it up with no context', gev('=TRIPLE(E1)'), 30)
check(
  'recalcFormulas picks it up too',
  recalcFormulas([{ age: 7, out: 0 as unknown }], { '0:out': '=TRIPLE(age)' })[0].out,
  21,
)
customFunctions.remove('TRIPLE')
check('and stops working once removed', gev('=TRIPLE(E1)'), '#ERROR')

/* ================================================ horizontal fill (Gap 1) == */

// What the grid does per filled cell: rows shift in data-index space, columns
// shift in A1 letter space (`columnDeltaBetween`), which is definition order
// and not the on-screen order.
const fillTranslate = (
  src: string,
  fromColumn: string,
  toColumn: string,
  rowDelta = 0,
) => translateFormula(src, rowDelta, columnDeltaBetween(fromColumn, toColumn))

console.log('\n-- column deltas in A1 letter space --')
check('age -> visits is +1', columnDeltaBetween('age', 'visits'), 1)
check('visits -> age is -1', columnDeltaBetween('visits', 'age'), -1)
check('avatar -> salary is +8', columnDeltaBetween('avatar', 'salary'), 8)
check('same column is 0', columnDeltaBetween('age', 'age'), 0)
check('unknown source column is 0', columnDeltaBetween('select', 'age'), 0)
check(
  'a combined column has no letter, so 0',
  columnDeltaBetween('age', 'merged:firstName+lastName'),
  0,
)
check(
  'columnIndexForId agrees with DATA_COLUMN_IDS',
  columnIndexForId('salary'),
  DATA_COLUMN_IDS.indexOf('salary'),
)
check('columnIndexForId is -1 off the list', columnIndexForId('nope'), -1)

console.log('\n-- filling a formula sideways --')
check('=E1*2 filled age -> visits', fillTranslate('=E1*2', 'age', 'visits'), '=F1 * 2')
check(
  '=E1*2 filled age -> progress (two columns right)',
  fillTranslate('=E1*2', 'age', 'progress'),
  '=H1 * 2',
)
// Nothing moved, so the author's exact text (spacing and all) is kept.
check(
  '=$E1*2 stays anchored to its column',
  fillTranslate('=$E1*2', 'age', 'progress'),
  '=$E1*2',
)
check(
  '=E$1 keeps its row and moves its column',
  fillTranslate('=E$1', 'age', 'visits'),
  '=F$1',
)
check(
  'filling left moves the column back',
  fillTranslate('=F1+1', 'visits', 'age'),
  '=E1 + 1',
)
check(
  'filling left clamps at column A',
  fillTranslate('=A1+1', 'salary', 'firstName'),
  '=A1+1',
)
check(
  'a clamped column still moves when the row does',
  fillTranslate('=A1+1', 'salary', 'firstName', 1),
  '=A2 + 1',
)
check(
  'a diagonal fill moves both halves',
  fillTranslate('=E1', 'age', 'visits', 2),
  '=F3',
)
check(
  'ranges move column by column',
  fillTranslate('=SUM(E1:E3)', 'age', 'visits'),
  '=SUM(F1:F3)',
)
// Column-name references have no column axis: `age` means "the age column",
// with nothing to shift it onto. Leaving them alone is the documented choice.
check(
  'a bare column-name ref is left alone sideways',
  fillTranslate('=age*2', 'age', 'visits'),
  '=age*2',
)
check(
  'an indexed column-name ref keeps its column too',
  fillTranslate('=age[3]', 'age', 'visits'),
  '=age[3]',
)
check(
  'but its row half still shifts on a diagonal fill',
  fillTranslate('=age[3]', 'age', 'visits', 2),
  '=age[5]',
)
check(
  'mixed notation: only the A1 half moves sideways',
  fillTranslate('=A1+age[1]', 'age', 'visits'),
  '=B1 + age[1]',
)
check(
  'an unknown target column leaves the formula put',
  fillTranslate('=E1*2', 'age', 'merged:firstName+lastName'),
  '=E1*2',
)

/* ==================================================== TSV clipboard (Gap 2) */

const tsv = (rows: string[][]) => JSON.stringify(rows)

console.log('\n-- TSV serialisation --')
check('plain grid', serializeTSV([['a', 'b'], ['c', 'd']]), 'a\tb\nc\td')
check('empty cells survive', serializeTSV([['', 'b']]), '\tb')
check('a tab forces quotes', serializeTSV([['a\tb']]), '"a\tb"')
check('a newline forces quotes', serializeTSV([['a\nb']]), '"a\nb"')
check('quotes are doubled', serializeTSV([['say "hi"']]), '"say ""hi"""')
check('an inch mark alone needs no quoting', serializeTSV([['5" pipe']]), '"5"" pipe"')
check('nothing to copy', serializeTSV([]), '')

console.log('\n-- TSV parsing --')
check('empty text is no rows', tsv(parseTSV('')), tsv([]))
check('single cell', tsv(parseTSV('a')), tsv([['a']]))
check('two by two', tsv(parseTSV('a\tb\nc\td')), tsv([['a', 'b'], ['c', 'd']]))
check('CRLF line endings', tsv(parseTSV('a\tb\r\nc\td')), tsv([['a', 'b'], ['c', 'd']]))
check('lone CR line endings', tsv(parseTSV('a\rb')), tsv([['a'], ['b']]))
check(
  'a trailing newline adds no phantom row',
  tsv(parseTSV('a\tb\nc\td\r\n')),
  tsv([['a', 'b'], ['c', 'd']]),
)
check('empty fields are kept', tsv(parseTSV('a\t\tb')), tsv([['a', '', 'b']]))
check(
  'a quoted field may contain a tab',
  tsv(parseTSV('"a\tb"\tc')),
  tsv([['a\tb', 'c']]),
)
check(
  'a quoted field may contain a newline',
  tsv(parseTSV('"line1\nline2"\tc')),
  tsv([['line1\nline2', 'c']]),
)
check(
  'doubled quotes come back as one',
  tsv(parseTSV('"say ""hi"""\tc')),
  tsv([['say "hi"', 'c']]),
)
check(
  'a quote mid-field is literal',
  tsv(parseTSV('5" pipe\tc')),
  tsv([['5" pipe', 'c']]),
)
check(
  'Excel-shaped payload',
  tsv(parseTSV('Ann\t30\r\nBob\t40\r\n')),
  tsv([['Ann', '30'], ['Bob', '40']]),
)

console.log('\n-- TSV round trips --')
const roundTrip = (rows: string[][]) => tsv(parseTSV(serializeTSV(rows)))
check('plain values', roundTrip([['a', 'b'], ['c', 'd']]), tsv([['a', 'b'], ['c', 'd']]))
check(
  'values with delimiters and quotes',
  roundTrip([['a\tb', 'say "hi"'], ['line1\nline2', '']]),
  tsv([['a\tb', 'say "hi"'], ['line1\nline2', '']]),
)
check('numbers as text', roundTrip([['1,234.50', '-7']]), tsv([['1,234.50', '-7']]))

/* ================================================== undo / redo (Gap 3) == */

console.log('\n-- history entries --')
const entry = makeEntry(
  'fill',
  [
    { rowIndex: 0, columnId: 'age', before: 10, after: 20 },
    // A no-op cell: the fill wrote what was already there.
    { rowIndex: 1, columnId: 'age', before: 5, after: 5 },
  ],
  [
    { key: '0:age', before: undefined, after: '=B1' },
    { key: '1:age', before: '=B2', after: '=B2' },
  ],
)
check('no-op cells are pruned', entry.cells.length, 1)
check('no-op formula patches are pruned', entry.formulas.length, 1)
check('an all-no-op entry is empty', isEmptyEntry(makeEntry('x', [], [])), true)

check(
  'undo writes the before values',
  JSON.stringify(cellWritesFor(entry, 'undo')),
  JSON.stringify([{ rowIndex: 0, columnId: 'age', value: 10 }]),
)
check(
  'redo writes the after values',
  JSON.stringify(cellWritesFor(entry, 'redo')),
  JSON.stringify([{ rowIndex: 0, columnId: 'age', value: 20 }]),
)

console.log('\n-- formula map patches --')
const baseMap: FormulaMap = { '3:age': '=E1' }
const added = applyFormulaPatch(
  baseMap,
  [{ key: '0:age', before: undefined, after: '=E1*2' }],
  'redo',
)
check('redo adds the formula', added['0:age'], '=E1*2')
check('the original map is untouched', '0:age' in baseMap, false)
check(
  'undo removes it again',
  '0:age' in
    applyFormulaPatch(
      added,
      [{ key: '0:age', before: undefined, after: '=E1*2' }],
      'undo',
    ),
  false,
)
check(
  'undo restores a replaced formula',
  applyFormulaPatch(
    { '3:age': '=E1+1' },
    [{ key: '3:age', before: '=E1', after: '=E1+1' }],
    'undo',
  )['3:age'],
  '=E1',
)
check(
  'an empty patch hands the same map back',
  applyFormulaPatch(baseMap, [], 'undo') === baseMap,
  true,
)
check(
  'a patch that changes nothing hands the same map back',
  applyFormulaPatch(baseMap, [{ key: '3:age', before: '=E1', after: '=E1' }], 'redo') ===
    baseMap,
  true,
)

console.log('\n-- applying a whole step, both halves --')
// A miniature of the real thing: a two-cell fill that wrote one formula, then
// undo, then redo. `data` and `formulas` have to move together.
type Cell = Record<string, unknown>
const rowsOf = (values: number[]): Cell[] => values.map((age) => ({ age }))

const applyWrites = (target: Cell[], writes: ReturnType<typeof cellWritesFor>) => {
  const next = target.map((row) => ({ ...row }))
  for (const write of writes) next[write.rowIndex][write.columnId] = write.value
  return next
}

let liveRows = rowsOf([10, 0, 0])
let liveFormulas: FormulaMap = {}

const fillStep = makeEntry(
  'fill',
  [
    { rowIndex: 1, columnId: 'age', before: 0, after: 20 },
    { rowIndex: 2, columnId: 'age', before: 0, after: 30 },
  ],
  [
    { key: '1:age', before: undefined, after: '=E1*2' },
    { key: '2:age', before: undefined, after: '=E1*3' },
  ],
)

liveRows = applyWrites(liveRows, cellWritesFor(fillStep, 'redo'))
liveFormulas = applyFormulaPatch(liveFormulas, fillStep.formulas, 'redo')
check('the fill wrote both cells', JSON.stringify(liveRows.map((r) => r.age)), '[10,20,30]')
check('and both formulas', Object.keys(liveFormulas).length, 2)

liveRows = applyWrites(liveRows, cellWritesFor(fillStep, 'undo'))
liveFormulas = applyFormulaPatch(liveFormulas, fillStep.formulas, 'undo')
check('undo restored the values', JSON.stringify(liveRows.map((r) => r.age)), '[10,0,0]')
check('undo restored the formula map too', Object.keys(liveFormulas).length, 0)

liveRows = applyWrites(liveRows, cellWritesFor(fillStep, 'redo'))
liveFormulas = applyFormulaPatch(liveFormulas, fillStep.formulas, 'redo')
check('redo puts it all back', JSON.stringify(liveRows.map((r) => r.age)), '[10,20,30]')
check('formulas too', liveFormulas['2:age'], '=E1*3')

console.log('\n-- stack capping --')
let stack: HistoryEntry[] = []
for (let i = 0; i < 60; i++) {
  stack = pushHistory(stack, makeEntry(`step ${i}`, [
    { rowIndex: i, columnId: 'age', before: 0, after: i + 1 },
  ], []), 50)
}
check('the stack is capped', stack.length, 50)
check('the oldest steps fell off', stack[0].label, 'step 10')
check('the newest step is on top', stack[stack.length - 1].label, 'step 59')
check('a zero limit keeps nothing', pushHistory([], entry, 0).length, 0)
check(
  'pushing does not mutate the input',
  (() => {
    const before: HistoryEntry[] = []
    pushHistory(before, entry, 5)
    return before.length
  })(),
  0,
)

/* --------------------------------------------------- circular references */

const circularRows = () => [
  { age: 1, visits: 2, salary: 3 },
  { age: 4, visits: 5, salary: 6 },
]

check(
  'a bare self reference is circular',
  findCircularKeys({ '0:age': '=age * 2' }).has('0:age'),
  true,
)

check(
  'an A1 self reference is circular',
  findCircularKeys({ '0:age': '=E1 * 2' }).has('0:age'),
  true,
)

check(
  'a formula reading another column is not circular',
  findCircularKeys({ '0:age': '=visits * 2' }).size,
  0,
)

check(
  'mutual references between two cells are circular',
  (() => {
    const found = findCircularKeys({
      '0:age': '=visits',
      '0:visits': '=age',
    })
    return found.has('0:age') && found.has('0:visits')
  })(),
  true,
)

check(
  'a range covering its own cell is circular',
  findCircularKeys({ '1:age': '=SUM(age[1]:age[3])' }).has('1:age'),
  true,
)

check(
  'a range below its own cell is not circular',
  findCircularKeys({ '0:age': '=SUM(age[2]:age[3])' }).size,
  0,
)

check(
  'a self-referential formula resolves to the circular marker',
  (recalcFormulas(circularRows(), { '0:age': '=age * 2' })[0] as any).age,
  ERROR_CIRCULAR,
)

check(
  'recalc settles: a second pass returns the same array reference',
  (() => {
    const formulas: FormulaMap = { '0:age': '=age * 2' }
    const once = recalcFormulas(circularRows(), formulas)
    return recalcFormulas(once, formulas) === once
  })(),
  true,
)

check(
  'non-circular formulas still evaluate alongside a circular one',
  (() => {
    const out = recalcFormulas(circularRows(), {
      '0:age': '=age * 2',
      '0:salary': '=visits * 10',
    })
    return (out[0] as any).salary
  })(),
  20,
)

console.log(`\n${passed} passed, ${failed} failed\n`)
