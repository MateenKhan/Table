// Runtime registry of user-defined formula functions.
//
// A definition is plain, JSON-round-trippable data:
//
//   { name: 'SQFT', params: ['w', 'h'], body: 'w * h / 144' }
//
// ...which makes `=SQFT(A1, A2)` evaluate `w * h / 144` with `w`/`h` bound to
// the arguments. Parameters shadow column references inside the body.
//
// This module never imports `formula.ts` - `formula.ts` imports *it*, so a
// back-import would be a cycle. (`columnOrder.ts` is dependency-free, so
// reaching for the letter mapping is safe.) Body validation, which needs the
// parser, is injected instead: `formula.ts` calls `setBodyValidator` on load.
// Name, param and shape validation live here and work with or without it.
//
// Nothing here is React-aware. `subscribe` / `version` are the framework
// agnostic hooks a UI layer can drive `useSyncExternalStore` from.

import { columnIdAtIndex, lettersToIndex } from './columnOrder'

export type FunctionDefinition = {
  name: string
  params: string[]
  body: string
}

export type ValidationResult =
  | { ok: true; definition: FunctionDefinition }
  | { ok: false; error: string }

export type ReplaceAllResult =
  | { ok: true; definitions: FunctionDefinition[] }
  | { ok: false; errors: { index: number; error: string }[] }

// Reserved: the engine resolves these before ever consulting the registry.
export const BUILTIN_FUNCTION_NAMES = [
  'SUM',
  'AVG',
  'MIN',
  'MAX',
  'ROUND',
  'ABS',
  'COUNT',
]

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/
const A1_LIKE = /^([A-Za-z]+)([0-9]+)$/

const MAX_PARAMS = 16

// A parameter is looked up as a bare identifier inside the body, and the parser
// turns *any* letters-then-digits identifier into an A1 cell reference. Such a
// parameter could therefore never be read, so it is refused outright.
const readsAsCellReference = (text: string) => A1_LIKE.test(text)

// A function name is always followed by `(`, which the parser resolves as a
// call before it ever considers A1 notation - so `SQFT2` is perfectly safe.
// Only a name that also names a real cell (`B2`) is genuinely confusing.
const namesARealCell = (text: string) => {
  const match = A1_LIKE.exec(text)
  return !!match && !!columnIdAtIndex(lettersToIndex(match[1]))
}

/**
 * Installed by `formula.ts`. Returns an error message, or null when the body
 * parses and every identifier in it resolves to a parameter or a column.
 */
export type BodyValidator = (definition: FunctionDefinition) => string | null

let bodyValidator: BodyValidator | null = null

export const setBodyValidator = (validator: BodyValidator | null) => {
  bodyValidator = validator
}

export const normalizeFunctionName = (name: unknown): string =>
  typeof name === 'string' ? name.trim().toUpperCase() : ''

const clone = (definition: FunctionDefinition): FunctionDefinition => ({
  name: definition.name,
  params: definition.params.slice(),
  body: definition.body,
})

const fail = (error: string): ValidationResult => ({ ok: false, error })

// The narrow slice the evaluator needs. Keeping it structural means tests can
// hand the engine a throwaway object instead of a real registry.
export type FunctionLookup = {
  get: (name: string) => FunctionDefinition | undefined
}

export class FunctionRegistry {
  private defs = new Map<string, FunctionDefinition>()
  private listeners = new Set<() => void>()
  private revision = 0

  /** Bumped on every change. Use it as a React dependency to force recalc. */
  get version(): number {
    return this.revision
  }

  get size(): number {
    return this.defs.size
  }

  /** Framework-agnostic store subscription. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify() {
    this.revision++
    this.listeners.forEach((listener) => {
      // A misbehaving subscriber must never take the formula engine with it.
      try {
        listener()
      } catch {
        /* ignored */
      }
    })
  }

  get(name: string): FunctionDefinition | undefined {
    return this.defs.get(normalizeFunctionName(name))
  }

  has(name: string): boolean {
    return this.defs.has(normalizeFunctionName(name))
  }

  /** Every definition, as fresh plain objects, in insertion order. */
  list(): FunctionDefinition[] {
    return Array.from(this.defs.values(), clone)
  }

  /** `JSON.stringify(registry)` yields exactly what `replaceAll` accepts. */
  toJSON(): FunctionDefinition[] {
    return this.list()
  }

  /**
   * Checks a candidate without storing it. `overwrite` skips the
   * "already defined" collision so a UI can validate an in-place edit.
   */
  validate(input: unknown, options: { overwrite?: boolean } = {}): ValidationResult {
    if (!input || typeof input !== 'object') {
      return fail('a definition must be an object')
    }

    const raw = input as Partial<FunctionDefinition>

    if (typeof raw.name !== 'string' || !raw.name.trim()) {
      return fail('a function name is required')
    }
    const name = raw.name.trim()
    if (!IDENT.test(name)) {
      return fail(`"${name}" is not a valid function name`)
    }
    if (namesARealCell(name)) {
      return fail(`"${name}" would be read as a cell reference`)
    }

    const key = name.toUpperCase()
    if (BUILTIN_FUNCTION_NAMES.includes(key)) {
      return fail(`${key} is a built-in function`)
    }
    if (!options.overwrite && this.defs.has(key)) {
      return fail(`${key} is already defined`)
    }

    const rawParams = raw.params === undefined ? [] : raw.params
    if (!Array.isArray(rawParams)) {
      return fail('params must be an array of names')
    }
    if (rawParams.length > MAX_PARAMS) {
      return fail(`a function may take at most ${MAX_PARAMS} parameters`)
    }

    const params: string[] = []
    const seen = new Set<string>()
    for (const entry of rawParams) {
      if (typeof entry !== 'string' || !entry.trim()) {
        return fail('every parameter must be a non-empty name')
      }
      const param = entry.trim()
      if (!IDENT.test(param)) {
        return fail(`"${param}" is not a valid parameter name`)
      }
      if (readsAsCellReference(param)) {
        return fail(`"${param}" would be read as a cell reference`)
      }
      if (seen.has(param)) {
        return fail(`duplicate parameter "${param}"`)
      }
      seen.add(param)
      params.push(param)
    }

    if (typeof raw.body !== 'string' || !raw.body.trim()) {
      return fail('a function body is required')
    }

    const definition: FunctionDefinition = {
      name,
      params,
      body: raw.body.trim(),
    }

    const bodyError = bodyValidator ? bodyValidator(definition) : null
    if (bodyError) return fail(bodyError)

    return { ok: true, definition }
  }

  /** Validates then stores. Never throws; returns the validation result. */
  define(input: unknown, options: { overwrite?: boolean } = {}): ValidationResult {
    const result = this.validate(input, options)
    if (!result.ok) return result
    this.defs.set(result.definition.name.toUpperCase(), result.definition)
    this.notify()
    return { ok: true, definition: clone(result.definition) }
  }

  /** Convenience for an editor that does not care whether it is new. */
  defineOrReplace(input: unknown): ValidationResult {
    return this.define(input, { overwrite: true })
  }

  remove(name: string): boolean {
    const removed = this.defs.delete(normalizeFunctionName(name))
    if (removed) this.notify()
    return removed
  }

  clear(): void {
    if (!this.defs.size) return
    this.defs.clear()
    this.notify()
  }

  /**
   * Atomic bulk swap - the shape a "load from localStorage" path wants.
   * Every entry is validated against an empty registry first; if any one
   * fails, the live set is left completely untouched.
   */
  replaceAll(input: unknown): ReplaceAllResult {
    if (!Array.isArray(input)) {
      return { ok: false, errors: [{ index: -1, error: 'expected an array of definitions' }] }
    }

    const staging = new FunctionRegistry()
    const errors: { index: number; error: string }[] = []

    input.forEach((entry, index) => {
      const result = staging.validate(entry)
      if (!result.ok) {
        errors.push({ index, error: result.error })
        return
      }
      staging.defs.set(result.definition.name.toUpperCase(), result.definition)
    })

    if (errors.length) return { ok: false, errors }

    this.defs = staging.defs
    this.notify()
    return { ok: true, definitions: this.list() }
  }
}

/** Isolated registry, for tests and for any UI that wants a sandbox. */
export const createFunctionRegistry = (): FunctionRegistry => new FunctionRegistry()

/**
 * The registry the engine consults when an `EvalContext` does not carry one.
 * This is what makes custom functions work with zero wiring: `recalcFormulas`
 * and `evaluateFormula` fall back to it automatically.
 */
export const customFunctions = createFunctionRegistry()
