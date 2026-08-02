/**
 * The formula point-mode state machine.
 *
 * Everything point mode decides about TEXT lives in `formulaPointing.ts` and is
 * pure, so all of it is reachable here without a DOM, a table or React: where a
 * reference is legal, how a target is spelled, how the spelling is spliced into
 * a half-typed draft, how F4 cycles the anchors, and how a range extends in
 * place. The last block closes the loop the whole feature rests on — that what
 * the picker EMITS is what the engine READS, through the live letter space.
 *
 * Run: npx tsx src/formulaPointing.test.ts
 */
import {
  AbsMode,
  beginSession,
  cycleAtCaret,
  cycleRefText,
  cycleSession,
  nextAbsMode,
  parseRefText,
  PointSession,
  PointTarget,
  referenceAllowedAt,
  refSpanAtCaret,
  refText,
  spliceRef,
  targetText,
  writeTarget,
} from './formulaPointing'
import { extractReferences, parseFormula } from './formula'
import { resetLetterSpace, setLetterSpace } from './columnOrder'

let failures = 0
let passes = 0

function check(label: string, condition: boolean, detail = '') {
  if (condition) {
    passes++
    console.log(`  ok   ${label}`)
  } else {
    failures++
    console.log(`  FAIL ${label}${detail ? `  ->  ${detail}` : ''}`)
  }
}

const eq = (label: string, actual: unknown, expected: unknown) =>
  check(
    label,
    JSON.stringify(actual) === JSON.stringify(expected),
    `expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`,
  )

const cell = (letters: string, rowNumber: number) => ({ letters, rowNumber })
const single = (letters: string, rowNumber: number): PointTarget => ({
  from: cell(letters, rowNumber),
  to: cell(letters, rowNumber),
  isRange: false,
})
const range = (
  a: [string, number],
  b: [string, number],
): PointTarget => ({
  from: cell(a[0], a[1]),
  to: cell(b[0], b[1]),
  isRange: true,
})

/* ------------------------------------------- where a reference is legal */

console.log('\nreference legality at the caret')

// The caret is written as `|` in the label; the number is its offset.
const legal: [string, number][] = [
  ['=', 1],
  ['=1+', 3],
  ['=1-', 3],
  ['=1*', 3],
  ['=1/', 3],
  ['=2^', 3],
  ['=(', 2],
  ['=SUM(', 5],
  ['=SUM(A1,', 8],
  ['=C3:', 4],
  ['=-', 2],
  ['=1 + ', 5],
  ['=  ', 3],
  ['=1+|2', 3],
  ['  =1+', 5],
]
for (const [draft, caret] of legal) {
  check(
    `legal: ${JSON.stringify(draft)} at ${caret}`,
    referenceAllowedAt(draft, caret),
  )
}

const illegal: [string, number][] = [
  // Mid-literal / mid-name / after a completed ref — inserting there is garbage.
  ['=12', 3],
  ['=123', 2],
  ['=C4', 3],
  ['=C4', 2],
  ['=SUM', 4],
  ['=age', 4],
  ['=(A1)', 5],
  ['=$', 2],
  ['=1 + C4 ', 8],
  // Before / at the `=`: no formula body yet.
  ['=1+', 0],
  ['  =1+', 1],
  // Not a formula at all — this is what leaves ordinary text editing alone.
  ['hello', 5],
  ['12+', 3],
  ['', 0],
  // Out of range.
  ['=1+', 9],
  ['=1+', -1],
]
for (const [draft, caret] of illegal) {
  check(
    `illegal: ${JSON.stringify(draft)} at ${caret}`,
    !referenceAllowedAt(draft, caret),
  )
}

/* ------------------------------------------------------------- spelling */

console.log('\nspelling a reference')

eq('relative', refText(cell('C', 3), 'relative'), 'C3')
eq('both anchored', refText(cell('C', 3), 'both'), '$C$3')
eq('row anchored', refText(cell('C', 3), 'row'), 'C$3')
eq('column anchored', refText(cell('C', 3), 'col'), '$C3')
eq('default mode is relative', refText(cell('AA', 12)), 'AA12')
eq('single-cell target', targetText(single('C', 3)), 'C3')
eq('range target', targetText(range(['C', 3], ['C', 4])), 'C3:C4')
eq(
  'range target keeps both ends anchored together',
  targetText(range(['C', 3], ['D', 5]), 'both'),
  '$C$3:$D$5',
)

/* --------------------------------------------------------- the F4 cycle */

console.log('\nF4 anchor cycle')

eq('C3 -> $C$3', cycleRefText('C3'), '$C$3')
eq('$C$3 -> C$3', cycleRefText('$C$3'), 'C$3')
eq('C$3 -> $C3', cycleRefText('C$3'), '$C3')
eq('$C3 -> C3', cycleRefText('$C3'), 'C3')
check('four steps return to the start', cycleRefText(cycleRefText(cycleRefText(cycleRefText('C3')!)!)!) === 'C3')
eq('mode cycle order', [
  nextAbsMode('relative'),
  nextAbsMode('both'),
  nextAbsMode('row'),
  nextAbsMode('col'),
] as AbsMode[], ['both', 'row', 'col', 'relative'])
eq('not a ref', cycleRefText('SUM'), null)
eq('not a ref (bare number)', cycleRefText('12'), null)
eq('parse round trip', parseRefText('$AA$12'), {
  letters: 'AA',
  rowNumber: 12,
  mode: 'both',
})

/* ------------------------------------------- finding the ref at the caret */

console.log('\nthe reference next to the caret')

eq('caret after a lone ref', refSpanAtCaret('=C3', 3), {
  start: 1,
  end: 3,
  text: 'C3',
})
eq('caret inside a ref', refSpanAtCaret('=C3+1', 2), {
  start: 1,
  end: 3,
  text: 'C3',
})
eq('caret after the SECOND end of a range', refSpanAtCaret('=C3:C4', 6), {
  start: 4,
  end: 6,
  text: 'C4',
})
eq('caret after the FIRST end of a range', refSpanAtCaret('=C3:C4', 3), {
  start: 1,
  end: 3,
  text: 'C3',
})
eq('anchored ref', refSpanAtCaret('=$C$3', 5), {
  start: 1,
  end: 5,
  text: '$C$3',
})
check('a function name is not a ref', refSpanAtCaret('=SUM(', 4) === null)
check('a bare number is not a ref', refSpanAtCaret('=12', 3) === null)
check('a column name is not a ref', refSpanAtCaret('=age', 4) === null)
check('an operator position has no ref', refSpanAtCaret('=1+', 3) === null)

/* ------------------------------------------------------ splicing a draft */

console.log('\nsplicing')

eq('insert at the caret', spliceRef('=', 1, 0, 'C4'), {
  draft: '=C4',
  caret: 3,
})
eq('replace in place', spliceRef('=C4', 1, 2, 'C3'), {
  draft: '=C3',
  caret: 3,
})
eq('replace with a longer range, keeping the tail', spliceRef('=C4+1', 1, 2, 'C3:C4'), {
  draft: '=C3:C4+1',
  caret: 6,
})

/* ------------------------------------------------- the session, end to end */

console.log('\na pointing session')

// `=` in some cell, then ArrowUp, ArrowUp, Shift+ArrowDown, F4, `+`, ArrowUp.
let draft = '='
let session: PointSession | null = beginSession(1)

let step = writeTarget(draft, session, single('C', 4))
draft = step.draft
session = step.session
eq('first arrow inserts a ref', [draft, step.caret], ['=C4', 3])

step = writeTarget(draft, session, single('C', 3))
draft = step.draft
session = step.session
eq('a second arrow REPLACES it, not appends', [draft, step.caret], ['=C3', 3])

step = writeTarget(draft, session, range(['C', 3], ['C', 4]))
draft = step.draft
session = step.session
eq('shift+arrow extends it in place', [draft, step.caret], ['=C3:C4', 6])

const cycled = cycleSession(draft, session)!
draft = cycled.draft
session = cycled.session
eq('F4 anchors the pointed range', draft, '=$C$3:$C$4')
eq('F4 does not move the target', session.target, range(['C', 3], ['C', 4]))

const cycledAgain = cycleSession(draft, session)!
eq('F4 again, still in place', cycledAgain.draft, '=C$3:C$4')

// Typing an operator ends the session (the editor drops it on any key that is
// not a pointing key); the next arrow therefore opens a NEW one at the caret.
draft = `${draft}+`
session = null
check('the operator position is legal again', referenceAllowedAt(draft, draft.length))
session = beginSession(draft.length)
step = writeTarget(draft, session, single('D', 7))
eq('the next arrow starts a SECOND ref', step.draft, '=$C$3:$C$4+D7')
eq(
  'and moving it only rewrites the second',
  writeTarget(step.draft, step.session, single('D', 6)).draft,
  '=$C$3:$C$4+D6',
)

// F4 with no session cycles the ref next to the caret.
eq('F4 outside a session', cycleAtCaret('=C3+C4', 6), {
  draft: '=C3+$C$4',
  caret: 8,
})
eq('F4 outside a session, on the first ref', cycleAtCaret('=C3+C4', 3), {
  draft: '=$C$3+C4',
  caret: 5,
})
check('F4 with no ref at the caret does nothing', cycleAtCaret('=1+', 3) === null)

/* -------------------------------- what is emitted is what the engine reads */

console.log('\nemitted refs bind through the live letter space')

// A blank sheet: the columns are `col1..col5`, which hold NO letters of their
// own — `lettersForColumnId` is the only thing that can name them. This is the
// exact shape the old A1 bug lived in, where `=C2` resolved against the demo
// schema and quietly answered 0.
setLetterSpace(['col1', 'col2', 'col3', 'col4', 'col5'])

const pointed = targetText(single('C', 4))
check('a pointed ref parses', parseFormula(`=${pointed}`) !== null)
eq(
  'and resolves to the third column, data row 3',
  extractReferences(`=${pointed}`, 0),
  [{ columnId: 'col3', dataRow: 3 }],
)
eq(
  'a pointed RANGE resolves to every cell it covers',
  extractReferences(`=SUM(${targetText(range(['C', 3], ['C', 5]))})`, 0),
  [
    { columnId: 'col3', dataRow: 2 },
    { columnId: 'col3', dataRow: 3 },
    { columnId: 'col3', dataRow: 4 },
  ],
)
eq(
  'anchors do not change which cell a ref names',
  extractReferences(`=${targetText(single('C', 4), 'both')}`, 0),
  [{ columnId: 'col3', dataRow: 3 }],
)
eq(
  'a rectangular range spans columns too',
  extractReferences(`=SUM(${targetText(range(['B', 2], ['C', 3]))})`, 0),
  [
    { columnId: 'col2', dataRow: 1 },
    { columnId: 'col2', dataRow: 2 },
    { columnId: 'col3', dataRow: 1 },
    { columnId: 'col3', dataRow: 2 },
  ],
)

resetLetterSpace()
eq(
  'and against the demo schema the same text names ITS third column',
  extractReferences('=C4', 0),
  [{ columnId: 'lastName', dataRow: 3 }],
)

console.log(
  failures === 0
    ? `\n${passes} passed, 0 failed`
    : `\n${passes} passed, ${failures} FAILED`,
)

if (failures > 0) {
  throw new Error('formulaPointing: the point-mode state machine regressed')
}
