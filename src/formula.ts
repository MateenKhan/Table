// A tiny spreadsheet formula engine: tokenizer -> recursive descent parser ->
// evaluator. No `eval` / `new Function` anywhere. Nothing here ever throws
// across the public API - failures come back as `#ERROR` / `#DIV/0!` strings.
//
// Grammar
//   formula    := '=' expr
//   expr       := term (('+' | '-') term)*
//   term       := unary (('*' | '/') unary)*
//   unary      := ('+' | '-') unary | power
//   power      := atom ('^' unary)?
//   atom       := number
//               | IDENT '(' (expr (',' expr)*)? ')'
//               | refOrRange
//               | '(' expr ')'
//   refOrRange := ref (':' ref)?
//   ref        := namedRef | a1Ref
//   namedRef   := IDENT ('[' '$'? number ']')?
//   a1Ref      := '$'? LETTERS '$'? number
//
// Two reference notations, one AST.
//
//   named  `age` is "column `age`, this row". `age[12]` is a *relative* row
//          reference (1-based data row) that shifts when the formula is
//          filled; `age[$12]` is *absolute* and never shifts.
//
//   A1     `E1` is "the 5th data column, data row 1" - see `columnOrder.ts`
//          for why letters are bound to definition order rather than to what
//          is on screen. `$` anchors either half: `E1`, `$E$1`, `E$1`, `$E1`.
//          The row half feeds the same fill translator as `age[12]`.
//
// Both notations produce `ref` / `range` nodes; A1 ones additionally carry an
// `a1` marker so the stringifier can round-trip the notation the user typed.
//
// Functions are the seven builtins plus whatever is in the custom-function
// registry (`customFunctions.ts`), which is consulted at *evaluation* time so
// editing a definition changes results without re-parsing stored formulas.

import {
  ATTACHMENT_COLUMN_IDS,
  DATA_COLUMN_IDS,
  DERIVED_COLUMNS,
  columnIdAtIndex,
  columnLetters,
  isKnownColumnId,
  lettersToIndex,
} from './columnOrder'
import {
  BUILTIN_FUNCTION_NAMES,
  customFunctions,
  setBodyValidator,
} from './customFunctions'
import type { FunctionLookup } from './customFunctions'

// Re-exported so a UI layer can reach the registry through the engine. Doing
// so also guarantees this module has been evaluated, which is what installs
// the body validator below.
export {
  BUILTIN_FUNCTION_NAMES,
  FunctionRegistry,
  createFunctionRegistry,
  customFunctions,
} from './customFunctions'
export type {
  FunctionDefinition,
  FunctionLookup,
  ReplaceAllResult,
  ValidationResult,
} from './customFunctions'

export type RowRef =
  | { mode: 'current' }
  | { mode: 'relative'; row: number }
  | { mode: 'absolute'; row: number }

// The column half of an A1-style reference. `index` is a 0-based index into
// `DATA_COLUMN_IDS`; it is kept even when out of range so the original text
// still round-trips (evaluation is what reports `#ERROR`).
export type ColRef = { index: number; absolute: boolean }

export type FormulaNode =
  | { kind: 'num'; value: number }
  | { kind: 'ref'; col: string; row: RowRef; a1?: ColRef }
  | { kind: 'range'; col: string; from: RowRef; to: RowRef; a1?: ColRef; a1To?: ColRef }
  | { kind: 'unary'; op: '+' | '-'; arg: FormulaNode }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/' | '^'; left: FormulaNode; right: FormulaNode }
  | { kind: 'call'; name: string; args: FormulaNode[] }

export const ERROR_GENERIC = '#ERROR'
export const ERROR_DIV0 = '#DIV/0!'

// Guard rail so a typo like `age[1]:age[99999999]` cannot lock up the tab.
const MAX_RANGE = 20000

// Backstop for custom functions. Cycle detection catches the real offenders;
// this catches deep-but-acyclic nesting before the JS stack does.
const MAX_CALL_DEPTH = 32

class FormulaError extends Error {
  code: string

  constructor(code: string) {
    super(code)
    this.code = code
  }
}

export const isFormula = (value: unknown): value is string =>
  typeof value === 'string' && value.trimStart().startsWith('=')

/* ------------------------------------------------------------------ tokens */

type Token =
  | { type: 'num'; text: string }
  | { type: 'ident'; text: string }
  | { type: 'punct'; text: string }

const isDigit = (c: string) => c >= '0' && c <= '9'
const isSpace = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r'
const isIdentStart = (c: string) =>
  (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_'
const isIdentPart = (c: string) => isIdentStart(c) || isDigit(c)

const PUNCT = '+-*/^(),:[]$'

function tokenize(src: string): Token[] {
  const out: Token[] = []
  let i = 0

  while (i < src.length) {
    const c = src[i]

    if (isSpace(c)) {
      i++
      continue
    }

    if (isDigit(c) || (c === '.' && isDigit(src[i + 1] ?? ''))) {
      let j = i
      while (j < src.length && isDigit(src[j])) j++
      if (src[j] === '.') {
        j++
        while (j < src.length && isDigit(src[j])) j++
      }
      out.push({ type: 'num', text: src.slice(i, j) })
      i = j
      continue
    }

    if (isIdentStart(c)) {
      let j = i
      while (j < src.length && isIdentPart(src[j])) j++
      out.push({ type: 'ident', text: src.slice(i, j) })
      i = j
      continue
    }

    if (PUNCT.includes(c)) {
      out.push({ type: 'punct', text: c })
      i++
      continue
    }

    throw new FormulaError(ERROR_GENERIC)
  }

  return out
}

/* ------------------------------------------------------------------ parser */

// `A1` written as one identifier token, e.g. `E1` / `AA12`.
const A1_COMBINED = /^([A-Za-z]{1,7})([0-9]{1,7})$/
// The letter half on its own, for the `E$1` / `$E$1` forms where the tokenizer
// splits at the `$`.
const A1_LETTERS = /^[A-Za-z]{1,7}$/

// `<columnName><rowNumber>` written as a single identifier token, e.g. `age1`.
// The leading name part is lazy so the trailing run of digits is taken as the
// 1-based row.
const NAME_ROW = /^([A-Za-z_][A-Za-z0-9_]*?)(\d+)$/

// Everything a reference contributes before we know whether it is a lone ref
// or one end of a range.
type RefLike = { col: string; row: RowRef; a1?: ColRef }

// `age1` → column `age`, 1-based row 1. Returns null unless the leading part is
// itself a known column id, so a genuine A1 ref (`E1`, where `E` is not a
// column) and a fall-through name (`x1`, where `x` is not a column) are left for
// the other notations to handle. The row is stored RELATIVE, matching the A1
// (`E1`) and indexed (`age[1]`) forms so a fill shifts it identically;
// resolution (`row - 1`) is the same for relative and absolute regardless.
function tryNameRow(text: string): RefLike | null {
  const m = NAME_ROW.exec(text)
  if (!m || !isKnownColumnId(m[1])) return null
  return { col: m[1], row: { mode: 'relative', row: Number(m[2]) } }
}

// Returns null when the source is not a parseable formula.
export function parseFormula(src: string): FormulaNode | null {
  try {
    const trimmed = src.trim()
    const body = trimmed.startsWith('=') ? trimmed.slice(1) : trimmed
    const tokens = tokenize(body)
    let i = 0

    const peek = (): Token | undefined => tokens[i]
    const isPunct = (text: string) => {
      const t = tokens[i]
      return !!t && t.type === 'punct' && t.text === text
    }
    const eat = (text: string) => {
      if (!isPunct(text)) throw new FormulaError(ERROR_GENERIC)
      i++
    }

    const parseRowRef = (): RowRef => {
      if (!isPunct('[')) return { mode: 'current' }
      i++
      let absolute = false
      if (isPunct('$')) {
        absolute = true
        i++
      }
      let sign = 1
      if (isPunct('-')) {
        sign = -1
        i++
      } else if (isPunct('+')) {
        i++
      }
      const t = peek()
      if (!t || t.type !== 'num') throw new FormulaError(ERROR_GENERIC)
      i++
      const row = sign * Number(t.text)
      eat(']')
      return absolute ? { mode: 'absolute', row } : { mode: 'relative', row }
    }

    const makeA1 = (
      index: number,
      colAbsolute: boolean,
      row: number,
      rowAbsolute: boolean,
    ): RefLike => ({
      // Out-of-range letters keep their index (so the text round-trips) but
      // resolve to no column, which `evalNode` turns into `#ERROR`.
      col: columnIdAtIndex(index),
      row: rowAbsolute ? { mode: 'absolute', row } : { mode: 'relative', row },
      a1: { index, absolute: colAbsolute },
    })

    // An identifier that is also a real column id always wins, so a column
    // literally named `b2` would still be reachable. A leading `$` removes the
    // ambiguity outright, so it overrides that preference.
    const tryA1 = (text: string, colAbsolute: boolean): RefLike | null => {
      const prefersColumn = !colAbsolute && isKnownColumnId(text)

      const combined = A1_COMBINED.exec(text)
      if (combined && !prefersColumn) {
        return makeA1(lettersToIndex(combined[1]), colAbsolute, Number(combined[2]), false)
      }

      const next = tokens[i + 1]
      if (
        A1_LETTERS.test(text) &&
        !prefersColumn &&
        isPunct('$') &&
        next &&
        next.type === 'num'
      ) {
        const index = lettersToIndex(text)
        const row = Number(next.text)
        i += 2
        return makeA1(index, colAbsolute, row, true)
      }

      return null
    }

    const parseRefLike = (): RefLike => {
      let colAbsolute = false
      if (isPunct('$')) {
        colAbsolute = true
        i++
      }

      const t = peek()
      if (!t || t.type !== 'ident') throw new FormulaError(ERROR_GENERIC)
      i++

      // Column-name notations never carry a leading `$` (that always means A1),
      // so they are only considered for an un-anchored reference.
      if (!colAbsolute) {
        // (1) A whole token that is itself a known column id is a current-row
        //     column ref (and may carry an explicit `[row]` index). A column
        //     literally named `x1` therefore resolves here, never as `x` row 1
        //     — known-column-id wins.
        if (isKnownColumnId(t.text)) {
          return { col: t.text, row: parseRowRef() }
        }
        // (2) `<columnName><rowNumber>` (e.g. `age1`, `visits1`). Checked before
        //     A1 so `age1` reads as "age row 1", not the out-of-range A1 letters
        //     `AGE` at row 1.
        const nameRow = tryNameRow(t.text)
        if (nameRow) return nameRow
      }

      // (3) A1 notation (`E1`, `$E$1`, and the `E$1` split form).
      const a1 = tryA1(t.text, colAbsolute)
      if (a1) return a1
      // `$` only ever introduces an A1 reference.
      if (colAbsolute) throw new FormulaError(ERROR_GENERIC)

      // (4) An unknown bare identifier is a named column ref for this row (it
      //     reads as empty, matching the existing `=nosuchcolumn` behaviour).
      return { col: t.text, row: parseRowRef() }
    }

    const parseAtom = (): FormulaNode => {
      const t = peek()
      if (!t) throw new FormulaError(ERROR_GENERIC)

      if (t.type === 'num') {
        i++
        return { kind: 'num', value: Number(t.text) }
      }

      if (t.type === 'punct' && t.text === '(') {
        i++
        const inner = parseExpr()
        eat(')')
        return inner
      }

      const after = tokens[i + 1]
      if (
        t.type === 'ident' &&
        after &&
        after.type === 'punct' &&
        after.text === '('
      ) {
        // Any `IDENT(` is a call. Whether the name exists is settled at
        // evaluation time so that custom functions can be defined, edited and
        // removed without touching already-parsed formulas.
        i += 2
        const args: FormulaNode[] = []
        if (!isPunct(')')) {
          args.push(parseExpr())
          while (isPunct(',')) {
            i++
            args.push(parseExpr())
          }
        }
        eat(')')
        return { kind: 'call', name: t.text.toUpperCase(), args }
      }

      if (t.type === 'ident' || (t.type === 'punct' && t.text === '$')) {
        const first = parseRefLike()

        if (isPunct(':')) {
          i++
          const second = parseRefLike()
          // Both ends must speak the same notation.
          if (!!first.a1 !== !!second.a1) throw new FormulaError(ERROR_GENERIC)

          if (first.a1 && second.a1) {
            return {
              kind: 'range',
              col: first.col,
              from: first.row,
              to: second.row,
              a1: first.a1,
              a1To: second.a1,
            }
          }

          // Named ranges stay single-column; `age[1]:visits[2]` is an error.
          if (first.col !== second.col) throw new FormulaError(ERROR_GENERIC)
          return { kind: 'range', col: first.col, from: first.row, to: second.row }
        }

        return first.a1
          ? { kind: 'ref', col: first.col, row: first.row, a1: first.a1 }
          : { kind: 'ref', col: first.col, row: first.row }
      }

      throw new FormulaError(ERROR_GENERIC)
    }

    const parsePower = (): FormulaNode => {
      const base = parseAtom()
      if (isPunct('^')) {
        i++
        return { kind: 'binary', op: '^', left: base, right: parseUnary() }
      }
      return base
    }

    const parseUnary = (): FormulaNode => {
      if (isPunct('-') || isPunct('+')) {
        const op = tokens[i].text as '+' | '-'
        i++
        return { kind: 'unary', op, arg: parseUnary() }
      }
      return parsePower()
    }

    const parseTerm = (): FormulaNode => {
      let left = parseUnary()
      while (isPunct('*') || isPunct('/')) {
        const op = tokens[i].text as '*' | '/'
        i++
        left = { kind: 'binary', op, left, right: parseUnary() }
      }
      return left
    }

    function parseExpr(): FormulaNode {
      let left = parseTerm()
      while (isPunct('+') || isPunct('-')) {
        const op = tokens[i].text as '+' | '-'
        i++
        left = { kind: 'binary', op, left, right: parseTerm() }
      }
      return left
    }

    if (!tokens.length) return null
    const node = parseExpr()
    if (i !== tokens.length) throw new FormulaError(ERROR_GENERIC)
    return node
  } catch {
    return null
  }
}

/* --------------------------------------------------------------- stringify */

const PREC: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2, '^': 3 }
const UNARY_PREC = 4

const rowRefText = (ref: RowRef): string => {
  if (ref.mode === 'current') return ''
  return ref.mode === 'absolute' ? `[$${ref.row}]` : `[${ref.row}]`
}

const a1RefText = (col: ColRef, row: RowRef): string => {
  const letters = `${col.absolute ? '$' : ''}${columnLetters(col.index)}`
  if (row.mode === 'current') return letters
  return `${letters}${row.mode === 'absolute' ? '$' : ''}${row.row}`
}

function emit(node: FormulaNode, minPrec: number): string {
  switch (node.kind) {
    case 'num':
      return String(node.value)
    case 'ref':
      return node.a1 ? a1RefText(node.a1, node.row) : node.col + rowRefText(node.row)
    case 'range':
      if (node.a1 && node.a1To) {
        return `${a1RefText(node.a1, node.from)}:${a1RefText(node.a1To, node.to)}`
      }
      return `${node.col}${rowRefText(node.from)}:${node.col}${rowRefText(node.to)}`
    case 'call':
      return `${node.name}(${node.args.map((arg) => emit(arg, 0)).join(', ')})`
    case 'unary': {
      const text = `${node.op}${emit(node.arg, UNARY_PREC)}`
      return minPrec > UNARY_PREC ? `(${text})` : text
    }
    case 'binary': {
      const prec = PREC[node.op]
      const text = `${emit(node.left, prec)} ${node.op} ${emit(node.right, prec + 1)}`
      return prec < minPrec ? `(${text})` : text
    }
  }
}

export const stringifyFormula = (node: FormulaNode): string => `=${emit(node, 0)}`

/* --------------------------------------------------- relative translation */

function shiftNode(node: FormulaNode, rowDelta: number, colDelta: number): FormulaNode {
  const shiftRow = (ref: RowRef): RowRef =>
    ref.mode === 'relative'
      ? { mode: 'relative', row: Math.max(1, ref.row + rowDelta) }
      : ref

  // Horizontal fill is not implemented in the UI, but the column half of an
  // A1 reference carries its own `$`, so honour it if a shift ever arrives.
  const shiftCol = (ref: ColRef | undefined): ColRef | undefined =>
    ref && !ref.absolute && colDelta
      ? { index: Math.max(0, ref.index + colDelta), absolute: false }
      : ref

  switch (node.kind) {
    case 'num':
      return node
    case 'ref': {
      const a1 = shiftCol(node.a1)
      return a1
        ? { kind: 'ref', col: columnIdAtIndex(a1.index), row: shiftRow(node.row), a1 }
        : { kind: 'ref', col: node.col, row: shiftRow(node.row) }
    }
    case 'range': {
      const a1 = shiftCol(node.a1)
      const a1To = shiftCol(node.a1To)
      if (a1 && a1To) {
        return {
          kind: 'range',
          col: columnIdAtIndex(a1.index),
          from: shiftRow(node.from),
          to: shiftRow(node.to),
          a1,
          a1To,
        }
      }
      return {
        kind: 'range',
        col: node.col,
        from: shiftRow(node.from),
        to: shiftRow(node.to),
      }
    }
    case 'unary':
      return { kind: 'unary', op: node.op, arg: shiftNode(node.arg, rowDelta, colDelta) }
    case 'binary':
      return {
        kind: 'binary',
        op: node.op,
        left: shiftNode(node.left, rowDelta, colDelta),
        right: shiftNode(node.right, rowDelta, colDelta),
      }
    case 'call':
      return {
        kind: 'call',
        name: node.name,
        args: node.args.map((arg) => shiftNode(arg, rowDelta, colDelta)),
      }
  }
}

// Excel-style fill translation. Bare column refs (`age`) are already row
// relative so they need no rewrite; explicit relative row refs (`age[12]`,
// `E12`, `$E12`) shift by the fill distance; absolute ones (`age[$12]`,
// `E$12`) stay put. `colDelta` is accepted for a future horizontal fill and
// moves only the column half of un-anchored A1 references.
export function translateFormula(src: string, rowDelta: number, colDelta = 0): string {
  if (!rowDelta && !colDelta) return src
  const ast = parseFormula(src)
  if (!ast) return src
  const shifted = stringifyFormula(shiftNode(ast, rowDelta, colDelta))
  // Nothing moved (no explicit relative refs) - keep the author's text.
  return shifted === stringifyFormula(ast) ? src : shifted
}

/* --------------------------------------------------------------- evaluate */

export type EvalContext = {
  // 0-based index into the underlying `data` array.
  currentRow: number
  getCell: (rowIndex: number, columnId: string) => unknown
  // Custom function registry. Defaults to the shared `customFunctions` one,
  // which is what lets existing callers pick definitions up with no wiring.
  functions?: FunctionLookup
}

export type FormulaResult =
  | { ok: true; value: number }
  | { ok: false; error: string }

type Value = number | number[]

// Per-evaluation state for custom function calls.
type Scope = {
  // Parameter bindings of the innermost custom function, or null at top level.
  locals: Record<string, Value> | null
  // Names of the custom functions currently on the stack - the cycle detector.
  stack: string[]
  depth: number
}

const TOP_SCOPE: Scope = { locals: null, stack: [], depth: 0 }

function toNumber(raw: unknown): number {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) throw new FormulaError(ERROR_GENERIC)
    return raw
  }
  if (raw === null || raw === undefined) return 0
  if (typeof raw === 'boolean') return raw ? 1 : 0
  // Attachment objects and the like: `[object Object]` has no numeric reading.
  if (typeof raw === 'object') throw new FormulaError(ERROR_GENERIC)
  const text = String(raw).trim()
  if (!text) return 0
  const n = Number(text)
  if (Number.isNaN(n)) throw new FormulaError(ERROR_GENERIC)
  return n
}

const resolveRow = (ref: RowRef, ctx: EvalContext): number =>
  ref.mode === 'current' ? ctx.currentRow : ref.row - 1

/**
 * Reads one cell, applying the two column-shape rules the grid needs:
 *
 *  - attachment columns (`avatar`, `attachment`) are always `#ERROR`, empty or
 *    not, rather than 0-when-empty / `#ERROR`-when-filled;
 *  - derived columns (`fullName`) are absent from the raw row objects, so they
 *    are reconstituted from their sources - which for `fullName` means text,
 *    which then fails arithmetic exactly as `firstName` does.
 */
function readCell(ctx: EvalContext, rowIndex: number, columnId: string): unknown {
  if (ATTACHMENT_COLUMN_IDS.includes(columnId)) throw new FormulaError(ERROR_GENERIC)

  const raw = ctx.getCell(rowIndex, columnId)
  if (raw !== undefined) return raw

  const sources = DERIVED_COLUMNS[columnId]
  if (!sources) return raw

  const parts = sources.map((id) => ctx.getCell(rowIndex, id))
  if (parts.every((part) => part === undefined)) return undefined
  return parts.map((part) => (part === null || part === undefined ? '' : String(part))).join(' ')
}

function scalar(value: Value): number {
  if (Array.isArray(value)) throw new FormulaError(ERROR_GENERIC)
  return value
}

function flatten(values: Value[]): number[] {
  const out: number[] = []
  for (const value of values) {
    if (Array.isArray(value)) out.push(...value)
    else out.push(value)
  }
  return out
}

function callFunction(name: string, args: Value[]): number {
  const nums = flatten(args)

  switch (name) {
    case 'SUM':
      return nums.reduce((a, b) => a + b, 0)
    case 'AVG': {
      if (!nums.length) throw new FormulaError(ERROR_DIV0)
      return nums.reduce((a, b) => a + b, 0) / nums.length
    }
    case 'MIN':
      if (!nums.length) throw new FormulaError(ERROR_GENERIC)
      return Math.min(...nums)
    case 'MAX':
      if (!nums.length) throw new FormulaError(ERROR_GENERIC)
      return Math.max(...nums)
    case 'COUNT':
      return nums.length
    case 'ABS':
      if (args.length !== 1) throw new FormulaError(ERROR_GENERIC)
      return Math.abs(scalar(args[0]))
    case 'ROUND': {
      if (args.length < 1 || args.length > 2) throw new FormulaError(ERROR_GENERIC)
      const x = scalar(args[0])
      const digits = args.length === 2 ? Math.trunc(scalar(args[1])) : 0
      const factor = Math.pow(10, digits)
      const scaled = x * factor
      if (!Number.isFinite(scaled)) throw new FormulaError(ERROR_GENERIC)
      // Round half away from zero, like Excel.
      const rounded =
        scaled < 0 ? -Math.round(-scaled) : Math.round(scaled)
      return rounded / factor
    }
    default:
      throw new FormulaError(ERROR_GENERIC)
  }
}

/* ------------------------------------------------- custom function support */

// Bodies are pure text, so a global parse cache is safe and keeps a recalc of
// hundreds of cells from re-parsing the same body hundreds of times.
const bodyCache = new Map<string, FormulaNode | null>()

function parseBody(body: string): FormulaNode | null {
  const cached = bodyCache.get(body)
  if (cached !== undefined) return cached
  const ast = parseFormula(body)
  if (bodyCache.size > 500) bodyCache.clear()
  bodyCache.set(body, ast)
  return ast
}

function callCustom(
  node: Extract<FormulaNode, { kind: 'call' }>,
  ctx: EvalContext,
  scope: Scope,
): Value {
  const registry = ctx.functions ?? customFunctions
  const def = registry.get(node.name)
  if (!def) throw new FormulaError(ERROR_GENERIC)
  if (node.args.length !== def.params.length) throw new FormulaError(ERROR_GENERIC)

  // Direct *and* indirect recursion: the name is already on the call stack.
  if (scope.stack.indexOf(node.name) >= 0) throw new FormulaError(ERROR_GENERIC)
  if (scope.depth >= MAX_CALL_DEPTH) throw new FormulaError(ERROR_GENERIC)

  const body = parseBody(def.body)
  if (!body) throw new FormulaError(ERROR_GENERIC)

  // Arguments are evaluated in the caller's scope, before the new bindings
  // exist, so a parameter can be passed through by name.
  const locals: Record<string, Value> = {}
  for (let n = 0; n < def.params.length; n++) {
    locals[def.params[n]] = evalNode(node.args[n], ctx, scope)
  }

  return evalNode(body, ctx, {
    locals,
    stack: scope.stack.concat(node.name),
    depth: scope.depth + 1,
  })
}

// The columns a range spans. Named ranges are always one column; A1 ranges may
// be rectangular (`A1:C5`).
function rangeColumns(node: Extract<FormulaNode, { kind: 'range' }>): string[] {
  if (!node.a1 || !node.a1To) return [node.col]

  const lo = Math.min(node.a1.index, node.a1To.index)
  const hi = Math.max(node.a1.index, node.a1To.index)
  if (lo < 0 || hi >= DATA_COLUMN_IDS.length) throw new FormulaError(ERROR_GENERIC)

  const out: string[] = []
  for (let c = lo; c <= hi; c++) out.push(DATA_COLUMN_IDS[c])
  return out
}

function evalNode(node: FormulaNode, ctx: EvalContext, scope: Scope): Value {
  switch (node.kind) {
    case 'num':
      return node.value

    case 'ref': {
      // A bare identifier inside a custom function body resolves to the
      // parameter of that name first - parameters shadow columns.
      if (
        !node.a1 &&
        node.row.mode === 'current' &&
        scope.locals &&
        Object.prototype.hasOwnProperty.call(scope.locals, node.col)
      ) {
        return scope.locals[node.col]
      }

      // An A1 reference whose letters point past the last column.
      if (node.a1 && !node.col) throw new FormulaError(ERROR_GENERIC)

      const rowIndex = resolveRow(node.row, ctx)
      if (rowIndex < 0) throw new FormulaError(ERROR_GENERIC)
      return toNumber(readCell(ctx, rowIndex, node.col))
    }

    case 'range': {
      const start = resolveRow(node.from, ctx)
      const end = resolveRow(node.to, ctx)
      const lo = Math.min(start, end)
      const hi = Math.max(start, end)
      if (lo < 0) throw new FormulaError(ERROR_GENERIC)

      const cols = rangeColumns(node)
      if ((hi - lo + 1) * cols.length > MAX_RANGE) throw new FormulaError(ERROR_GENERIC)

      const out: number[] = []
      for (const col of cols) {
        for (let r = lo; r <= hi; r++) {
          const raw = readCell(ctx, r, col)
          if (raw === undefined) continue
          out.push(toNumber(raw))
        }
      }
      return out
    }

    case 'unary': {
      const value = scalar(evalNode(node.arg, ctx, scope))
      return node.op === '-' ? -value : value
    }

    case 'binary': {
      const left = scalar(evalNode(node.left, ctx, scope))
      const right = scalar(evalNode(node.right, ctx, scope))
      switch (node.op) {
        case '+':
          return left + right
        case '-':
          return left - right
        case '*':
          return left * right
        case '/':
          if (right === 0) throw new FormulaError(ERROR_DIV0)
          return left / right
        case '^':
          return Math.pow(left, right)
      }
      throw new FormulaError(ERROR_GENERIC)
    }

    case 'call':
      if (BUILTIN_FUNCTION_NAMES.includes(node.name)) {
        return callFunction(
          node.name,
          node.args.map((arg) => evalNode(arg, ctx, scope)),
        )
      }
      return callCustom(node, ctx, scope)
  }
}

export function evaluateFormula(src: string, ctx: EvalContext): FormulaResult {
  const ast = parseFormula(src)
  if (!ast) return { ok: false, error: ERROR_GENERIC }

  try {
    const value = evalNode(ast, ctx, TOP_SCOPE)
    if (Array.isArray(value)) return { ok: false, error: ERROR_GENERIC }
    if (!Number.isFinite(value)) return { ok: false, error: ERROR_GENERIC }
    return { ok: true, value }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof FormulaError ? error.code : ERROR_GENERIC,
    }
  }
}

/* ------------------------------------------- custom function body checking */

// Installed into the registry on load. Kept here because it needs the parser;
// `customFunctions.ts` stays import-free so there is no cycle.
setBodyValidator((definition) => {
  const ast = parseFormula(definition.body)
  if (!ast) return 'the body is not a valid formula'

  const params = new Set(definition.params)
  let error: string | null = null

  const checkRef = (col: string, row: RowRef, a1: ColRef | undefined) => {
    if (error) return
    if (a1) {
      if (!col) error = `"${columnLetters(a1.index)}" is not a column in this table`
      return
    }
    if (params.has(col)) {
      if (row.mode !== 'current') error = `parameter "${col}" cannot take a row reference`
      return
    }
    if (!isKnownColumnId(col)) error = `"${col}" is not a parameter or a column`
  }

  const walk = (node: FormulaNode) => {
    if (error) return
    switch (node.kind) {
      case 'num':
        return
      case 'ref':
        checkRef(node.col, node.row, node.a1)
        return
      case 'range':
        checkRef(node.col, node.from, node.a1)
        checkRef(
          node.a1To ? columnIdAtIndex(node.a1To.index) : node.col,
          node.to,
          node.a1To,
        )
        return
      case 'unary':
        walk(node.arg)
        return
      case 'binary':
        walk(node.left)
        walk(node.right)
        return
      case 'call':
        // Called names are resolved at evaluation time, so an as-yet-undefined
        // custom function is allowed here (that is what makes mutually
        // recursive definitions expressible - and detectable when they run).
        node.args.forEach(walk)
    }
  }

  walk(ast)
  return error
})

/* ------------------------------------------------------------ formula map */

// Formulas are stored beside the data, keyed by underlying data row index so
// that sorting / filtering / pagination cannot desynchronise them.
export type FormulaMap = Record<string, string>

export const formulaKey = (dataIndex: number, columnId: string) =>
  `${dataIndex}:${columnId}`

export function parseFormulaKey(key: string) {
  const split = key.indexOf(':')
  return {
    dataIndex: Number(key.slice(0, split)),
    columnId: key.slice(split + 1),
  }
}

export const ERROR_CIRCULAR = '#CIRCULAR!'

const refRow = (ref: RowRef, currentRow: number) =>
  ref.mode === 'current' ? currentRow : ref.row - 1

/**
 * Every concrete cell a formula reads, resolved against `currentDataRow` (the
 * 0-based data row the formula lives on). This powers the live "highlight the
 * cells this formula references" affordance while a `=` draft is being typed,
 * so it is deliberately total: an unparseable / half-typed formula yields `[]`
 * and it never throws. Results are de-duped `{ columnId, dataRow }` pairs in the
 * engine's data/definition space — exactly the coordinates the grid keys
 * formatting (and its highlight) on. Handles every ref form: named (`age`),
 * indexed (`age[12]` / `age[$12]`), the new `name+row` (`age1`) and A1.
 */
export function extractReferences(
  formula: string,
  currentDataRow: number,
): { columnId: string; dataRow: number }[] {
  const ast = parseFormula(formula)
  if (!ast) return []

  const out: { columnId: string; dataRow: number }[] = []
  const seen = new Set<string>()
  const push = (columnId: string, dataRow: number) => {
    if (!columnId || dataRow < 0) return
    const key = `${dataRow}:${columnId}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ columnId, dataRow })
  }

  const walk = (node: FormulaNode) => {
    switch (node.kind) {
      case 'num':
        return
      case 'ref': {
        const col = node.a1 ? columnIdAtIndex(node.a1.index) : node.col
        push(col, refRow(node.row, currentDataRow))
        return
      }
      case 'range': {
        const a = refRow(node.from, currentDataRow)
        const b = refRow(node.to, currentDataRow)
        const lo = Math.min(a, b)
        const hi = Math.max(a, b)
        // Rectangular for A1 ranges, a single column for named ones.
        let cols: string[]
        if (node.a1 && node.a1To) {
          const clo = Math.min(node.a1.index, node.a1To.index)
          const chi = Math.max(node.a1.index, node.a1To.index)
          cols = []
          for (let c = clo; c <= chi; c++) cols.push(DATA_COLUMN_IDS[c] ?? '')
        } else {
          cols = [node.col]
        }
        // A mistyped huge range must not spin out building highlights.
        if ((hi - lo + 1) * cols.length > MAX_RANGE) return
        for (const col of cols) {
          for (let r = lo; r <= hi; r++) push(col, r)
        }
        return
      }
      case 'unary':
        walk(node.arg)
        return
      case 'binary':
        walk(node.left)
        walk(node.right)
        return
      case 'call':
        node.args.forEach(walk)
        return
    }
  }

  try {
    walk(ast)
  } catch {
    // Total by contract — hand back whatever was collected before any throw.
  }
  return out
}

// Does this formula, evaluated on `currentRow`, read the cell at
// (targetRow, targetCol)?
function readsCell(
  node: FormulaNode,
  currentRow: number,
  targetRow: number,
  targetCol: string,
): boolean {
  switch (node.kind) {
    case 'num':
      return false
    case 'ref': {
      const col = node.a1 ? columnIdAtIndex(node.a1.index) : node.col
      return col === targetCol && refRow(node.row, currentRow) === targetRow
    }
    case 'range': {
      const a = refRow(node.from, currentRow)
      const b = refRow(node.to, currentRow)
      if (targetRow < Math.min(a, b) || targetRow > Math.max(a, b)) return false

      // Rectangular A1 ranges span a block of columns; named ranges are always
      // a single column.
      if (node.a1 && node.a1To) {
        const lo = Math.min(node.a1.index, node.a1To.index)
        const hi = Math.max(node.a1.index, node.a1To.index)
        for (let i = lo; i <= hi; i++) {
          if (columnIdAtIndex(i) === targetCol) return true
        }
        return false
      }
      return (node.a1 ? columnIdAtIndex(node.a1.index) : node.col) === targetCol
    }
    case 'unary':
      return readsCell(node.arg, currentRow, targetRow, targetCol)
    case 'binary':
      return (
        readsCell(node.left, currentRow, targetRow, targetCol) ||
        readsCell(node.right, currentRow, targetRow, targetCol)
      )
    case 'call':
      return node.args.some((arg) =>
        readsCell(arg, currentRow, targetRow, targetCol),
      )
  }
}

/**
 * Formula cells that sit on a dependency cycle, directly (`=age` in `age`) or
 * through other formula cells.
 *
 * Without this a self-referential formula never reaches a fixed point: each
 * pass produces a new value, `recalcFormulas` returns a changed array, and the
 * caller's effect re-runs forever. Only formula cells can close a cycle, so the
 * graph is built over them alone.
 */
export function findCircularKeys(formulas: FormulaMap): Set<string> {
  type Node = { ast: FormulaNode; dataIndex: number; columnId: string }

  const parsed = new Map<string, Node>()
  for (const key of Object.keys(formulas)) {
    const { dataIndex, columnId } = parseFormulaKey(key)
    const ast = parseFormula(formulas[key]!)
    if (ast && Number.isInteger(dataIndex)) {
      parsed.set(key, { ast, dataIndex, columnId })
    }
  }

  const edges = new Map<string, string[]>()
  for (const [key, from] of parsed) {
    const deps: string[] = []
    for (const [otherKey, to] of parsed) {
      if (readsCell(from.ast, from.dataIndex, to.dataIndex, to.columnId)) {
        deps.push(otherKey)
      }
    }
    edges.set(key, deps)
  }

  const circular = new Set<string>()
  const state = new Map<string, 'visiting' | 'done'>()
  const stack: string[] = []

  const visit = (key: string) => {
    const seen = state.get(key)
    if (seen === 'done') return
    if (seen === 'visiting') {
      // Everything from this key upward on the stack is part of the cycle.
      for (let i = stack.indexOf(key); i >= 0 && i < stack.length; i++) {
        circular.add(stack[i]!)
      }
      return
    }

    state.set(key, 'visiting')
    stack.push(key)
    for (const dep of edges.get(key) ?? []) visit(dep)
    stack.pop()
    state.set(key, 'done')
  }

  for (const key of parsed.keys()) visit(key)
  return circular
}

// Recomputes every stored formula into a fresh copy of `rows`. Returns the
// original array reference when nothing changed so callers can bail out of a
// `setState` and avoid a render loop. Multiple passes let simple formula
// chains settle.
export function recalcFormulas<T extends object>(
  rows: T[],
  formulas: FormulaMap,
  passes = 8,
  functions: FunctionLookup = customFunctions,
): T[] {
  const keys = Object.keys(formulas)
  if (!keys.length) return rows

  // Cells on a dependency cycle are never evaluated: they resolve to a stable
  // marker instead, which is what lets this settle at all.
  const circular = findCircularKeys(formulas)

  let current = rows
  let unsettled: string[] = []

  for (let pass = 0; pass < passes; pass++) {
    let next = current
    const changed: string[] = []
    const ctxGet = (rowIndex: number, columnId: string) =>
      (next[rowIndex] as Record<string, unknown> | undefined)?.[columnId]

    for (const key of keys) {
      const { dataIndex, columnId } = parseFormulaKey(key)
      if (!Number.isInteger(dataIndex) || !next[dataIndex]) continue

      let value: unknown
      if (circular.has(key)) {
        value = ERROR_CIRCULAR
      } else {
        const result = evaluateFormula(formulas[key]!, {
          currentRow: dataIndex,
          getCell: ctxGet,
          functions,
        })
        value = result.ok ? result.value : result.error
      }

      const row = next[dataIndex] as Record<string, unknown>

      if (row[columnId] !== value) {
        if (next === current) next = current.slice()
        next[dataIndex] = { ...next[dataIndex], [columnId]: value } as T
        changed.push(key)
      }
    }

    if (next === current) {
      unsettled = []
      break
    }
    current = next
    unsettled = changed
  }

  // Safety net for cycles the static graph cannot see - notably ones routed
  // through a custom function body. Anything still moving after the last pass
  // is pinned so the caller's effect cannot spin forever.
  if (unsettled.length) {
    const pinned = current.slice()
    for (const key of unsettled) {
      const { dataIndex, columnId } = parseFormulaKey(key)
      if (!pinned[dataIndex]) continue
      pinned[dataIndex] = {
        ...pinned[dataIndex],
        [columnId]: ERROR_CIRCULAR,
      } as T
    }
    return pinned
  }

  return current
}
