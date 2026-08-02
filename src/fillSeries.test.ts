// Dependency-free unit tests for the fill-series engine.
// Run with:  npx tsx src/fillSeries.test.ts
import { cyclicIndex, describeSeries, inferSeries } from './fillSeries'
import type { SeriesOptions } from './fillSeries'

let passed = 0
let failed = 0

function check(label: string, actual: unknown, expected: unknown) {
  const ok = Object.is(actual, expected)
  if (ok) {
    passed++
  } else {
    failed++
    console.log(`  FAIL ${label}\n       expected ${JSON.stringify(
      expected,
    )}, got ${JSON.stringify(actual)}`)
  }
}

// The whole point of a plan is "what comes after the block", so most assertions
// read as: given these source values, the next `count` cells are…
function next(values: unknown[], count: number, options?: SeriesOptions) {
  const plan = inferSeries(values, options)
  const out: unknown[] = []
  for (let i = 0; i < count; i++) out.push(plan.valueAt(values.length + i))
  return out
}

function before(values: unknown[], count: number, options?: SeriesOptions) {
  const plan = inferSeries(values, options)
  const out: unknown[] = []
  // Walking backwards from the cell immediately above the block.
  for (let i = 1; i <= count; i++) out.push(plan.valueAt(-i))
  return out
}

const kindOf = (values: unknown[], options?: SeriesOptions) =>
  inferSeries(values, options).kind

const eq = (label: string, actual: unknown[], expected: unknown[]) => {
  check(label, JSON.stringify(actual), JSON.stringify(expected))
}

/* ------------------------------------------------------------ the mapping */

check('cyclicIndex inside the block is the identity', cyclicIndex(2, 4), 2)
check('cyclicIndex wraps forwards', cyclicIndex(5, 4), 1)
check('cyclicIndex wraps backwards', cyclicIndex(-1, 4), 3)
check('cyclicIndex survives a zero-length block', cyclicIndex(3, 0), 0)

/* ------------------------------------------------------------------ numbers */

check('a linear pair is a number series', kindOf([1, 2]), 'number')
eq('1,2 continues 3,4,5', next([1, 2], 3), [3, 4, 5])
eq('2,4,6 continues 8,10,12', next([2, 4, 6], 3), [8, 10, 12])
eq('10,7 continues 4,1,-2', next([10, 7], 3), [4, 1, -2])
eq('1,2 extends upwards as 0,-1', before([1, 2], 2), [0, -1])
eq('a block reads back its own values', [
  inferSeries([2, 4, 6]).valueAt(0),
  inferSeries([2, 4, 6]).valueAt(2),
], [2, 6])

check('a single number COPIES rather than counting', kindOf([5]), 'copy')
eq('…and the copy repeats it', next([5], 3), [5, 5, 5])
check('a repeated value is a copy, not a zero-step series', kindOf([7, 7]), 'copy')
check('an inconsistent gap degrades to copy', kindOf([1, 2, 5]), 'copy')
eq('…and repeats the block', next([1, 2, 5], 4), [1, 2, 5, 1])

eq('decimal steps stay tidy', next([0.1, 0.2], 3), [0.3, 0.4, 0.5])
eq('a fractional step works', next([1, 1.5], 2), [2, 2.5])
eq('a negative-going float', next([1, 0.75], 2), [0.5, 0.25])

// Numbers held as TEXT (a text column) stay text, so the column does not
// silently change shape halfway down.
eq("'1','2' stays textual", next(['1', '2'], 2), ['3', '4'])
eq('zero padding is preserved', next(['007', '008'], 3), ['009', '010', '011'])

check('a number mixed with text is not a numeric series', kindOf([1, 'x']), 'copy')

/* -------------------------------------------------------------------- dates */

const dateCol: SeriesOptions = { type: 'date' }

eq(
  'consecutive days continue',
  next(['2024-01-01', '2024-01-02'], 3, dateCol),
  ['2024-01-03', '2024-01-04', '2024-01-05'],
)
eq(
  'a weekly step continues weekly',
  next(['2024-01-01', '2024-01-08'], 2, dateCol),
  ['2024-01-15', '2024-01-22'],
)
eq(
  'the 1st of two months is a MONTH step, not 31 days',
  next(['2024-01-01', '2024-02-01'], 3, dateCol),
  ['2024-03-01', '2024-04-01', '2024-05-01'],
)
eq(
  'a month step clamps to the end of a short month',
  next(['2024-01-31', '2024-03-31'], 1, dateCol),
  ['2024-05-31'],
)
eq(
  'month-end stepping lands on February',
  next(['2023-12-31', '2024-01-31'], 1, dateCol),
  ['2024-02-29'],
)
eq(
  'a year step is a 12-month step',
  next(['2020-03-01', '2021-03-01'], 2, dateCol),
  ['2022-03-01', '2023-03-01'],
)
eq(
  'dates extend backwards too',
  before(['2024-01-03', '2024-01-04'], 2, dateCol),
  ['2024-01-02', '2024-01-01'],
)
eq(
  'a single date steps by a day',
  next(['2024-02-28'], 2, dateCol),
  ['2024-02-29', '2024-03-01'],
)
check(
  // Date stepping is gated on the column type, so a text column holding
  // date-shaped text is read as text: the month digits change, so the two do not
  // share a pattern and it repeats.
  'a date-shaped value in a TEXT column is not a date series',
  kindOf(['2024-01-01', '2024-02-01'], { type: 'text' }),
  'copy',
)
eq(
  // …but inside one month it IS just text with a trailing number, and stepping
  // it is both harmless and what a user filling a text column expects.
  'date-shaped text in a text column steps its trailing number',
  next(['2024-01-01', '2024-01-02'], 2, { type: 'text' }),
  ['2024-01-03', '2024-01-04'],
)
check(
  'an unparseable date degrades to copy',
  kindOf(['not a date', 'nor this'], dateCol),
  'copy',
)

const timeCol: SeriesOptions = { type: 'datetime' }
eq(
  'a datetime keeps its time-of-day step',
  next(
    ['2024-01-01T09:00:00.000Z', '2024-01-01T09:30:00.000Z'],
    2,
    timeCol,
  ),
  ['2024-01-01T10:00:00.000Z', '2024-01-01T10:30:00.000Z'],
)

/* ------------------------------------------------------------- name cycles */

check('weekday names are recognised', kindOf(['Mon', 'Tue']), 'weekday')
eq('Mon,Tue continues', next(['Mon', 'Tue'], 3), ['Wed', 'Thu', 'Fri'])
eq('the week wraps', next(['Fri', 'Sat'], 2), ['Sun', 'Mon'])
eq('a single weekday steps by one day', next(['Monday'], 2), ['Tuesday', 'Wednesday'])
eq('full names stay full', next(['Monday', 'Tuesday'], 1), ['Wednesday'])
eq('a 3-day cycle is honoured', next(['Fri', 'Mon'], 2), ['Thu', 'Sun'])
eq('casing is preserved', next(['MON', 'TUE'], 1), ['WED'])
eq('lower case is preserved', next(['mon', 'tue'], 1), ['wed'])
eq('weekdays extend backwards', before(['Wed', 'Thu'], 2), ['Tue', 'Mon'])

check('month names are recognised', kindOf(['Jan', 'Feb']), 'month')
eq('Jan,Feb continues', next(['Jan', 'Feb'], 3), ['Mar', 'Apr', 'May'])
eq('the year wraps', next(['Nov', 'Dec'], 2), ['Jan', 'Feb'])
eq('a quarterly cycle is honoured', next(['Jan', 'Apr'], 2), ['Jul', 'Oct'])
eq('full month names stay full', next(['January', 'February'], 1), ['March'])
eq("'Sept' is understood", next(['Sept', 'Oct'], 1), ['Nov'])
eq('a single month steps by one', next(['Jan'], 2), ['Feb', 'Mar'])

check('a weekday mixed with a month is not a cycle', kindOf(['Mon', 'Feb']), 'copy')

/* --------------------------------------------------- text with a number in it */

check('trailing numbers are a series', kindOf(['Item 1', 'Item 2']), 'text')
eq(
  'Item 1, Item 2 continues',
  next(['Item 1', 'Item 2'], 2),
  ['Item 3', 'Item 4'],
)
eq(
  'a single Item 1 still counts up',
  next(['Item 1'], 3),
  ['Item 2', 'Item 3', 'Item 4'],
)
eq('a step of 2 is honoured', next(['Q1', 'Q3'], 2), ['Q5', 'Q7'])
eq(
  'zero padding survives',
  next(['file008', 'file009'], 2),
  ['file010', 'file011'],
)
eq(
  'a leading number counts too',
  next(['1-alpha', '2-alpha'], 2),
  ['3-alpha', '4-alpha'],
)
check(
  // '1st' / '2nd' disagree on the text after the digits, so there is no single
  // pattern to continue — copying is the honest answer.
  'ordinal suffixes that change are not a series',
  kindOf(['1st place', '2nd place']),
  'copy',
)
eq(
  'text after the number is kept verbatim',
  next(['1 apple', '2 apple'], 2),
  ['3 apple', '4 apple'],
)
check(
  'different prefixes are not a series',
  kindOf(['Item 1', 'Task 2']),
  'copy',
)
eq(
  'text counting down passes through zero',
  next(['Item 2', 'Item 1'], 2),
  ['Item 0', 'Item -1'],
)

/* --------------------------------------------------------- text and fallback */

check('pure text repeats', kindOf(['apple', 'banana']), 'copy')
eq(
  '…cyclically, exactly as before',
  next(['apple', 'banana'], 4),
  ['apple', 'banana', 'apple', 'banana'],
)
check('a blank in the block degrades to copy', kindOf([1, '', 3]), 'copy')
check('an all-blank block is a copy', kindOf(['', '']), 'copy')
check('an object (an attachment) degrades to copy', kindOf([{ name: 'a.png' }, 2]), 'copy')
check('an empty block is a copy', kindOf([]), 'copy')

/* ------------------------------------------------------------------- labels */

check('a copy is labelled Copy', describeSeries('copy'), 'Copy')
check('a number series is labelled Series', describeSeries('number'), 'Series')

console.log(`\nfillSeries: ${passed} passed, ${failed} failed\n`)

if (failed > 0) {
  throw new Error(`${failed} fillSeries assertion(s) failed`)
}
