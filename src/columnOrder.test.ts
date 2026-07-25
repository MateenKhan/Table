/**
 * Guard for the A1 reference scheme.
 *
 * `DATA_COLUMN_IDS` is hand-maintained, and letters are positional: inserting a
 * column into the middle of `tableModels` silently re-letters everything after
 * it, which would change what already-saved formulas compute. This test fails
 * loudly when the two drift apart.
 *
 * Run: npx tsx src/columnOrder.test.ts
 */
import { columns } from './tableModels'
import { DATA_COLUMN_IDS, NON_DATA_COLUMN_IDS } from './columnOrder'

type AnyDef = {
  id?: string
  accessorKey?: string
  columns?: AnyDef[]
}

// Leaf columns in document order - the same order the letters are assigned in.
function leafIds(defs: AnyDef[], into: string[] = []) {
  for (const def of defs) {
    if (def.columns?.length) {
      leafIds(def.columns, into)
      continue
    }
    const id = def.id ?? def.accessorKey
    if (id) into.push(id)
  }
  return into
}

let failures = 0

function check(label: string, condition: boolean, detail = '') {
  if (condition) {
    console.log(`  ok   ${label}`)
  } else {
    failures++
    console.log(`  FAIL ${label}${detail ? `  ->  ${detail}` : ''}`)
  }
}

const actual = leafIds(columns as AnyDef[]).filter(
  (id) => !NON_DATA_COLUMN_IDS.includes(id),
)

check(
  'DATA_COLUMN_IDS matches the leaf columns in tableModels, in order',
  actual.length === DATA_COLUMN_IDS.length &&
    actual.every((id, i) => id === DATA_COLUMN_IDS[i]),
  `expected [${DATA_COLUMN_IDS.join(', ')}] but tableModels has [${actual.join(
    ', ',
  )}]`,
)

check(
  'no duplicate ids',
  new Set(DATA_COLUMN_IDS).size === DATA_COLUMN_IDS.length,
)

console.log(
  failures === 0
    ? `\ncolumnOrder: 2 passed, 0 failed`
    : `\ncolumnOrder: ${failures} FAILED`,
)

// Thrown rather than setting an exit code, so this stays free of node types.
if (failures > 0) {
  throw new Error(
    'columnOrder is out of sync with tableModels - A1 letters would shift',
  )
}
