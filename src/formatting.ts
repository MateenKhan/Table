// Per-scope visual formatting (fill / text colour / alignment) for the grid.
//
// This is a module-level singleton in the exact shape of `customFunctions.ts`:
// framework-agnostic `subscribe` / `version` hooks, a localStorage mirror, and a
// React `useSyncExternalStore` adapter so any consumer re-renders on a change.
// It deliberately owns NO React state and needs NO provider - the popup writes
// to it and `CustomTable` reads from it, both through the same singleton.
//
// Scopes, most general to most specific:
//   col:<columnId>                a whole column
//   row:<dataRowIndex>            a whole row (keyed on the DATA index, so the
//                                 colour follows the row through sort / filter)
//   cell:<dataRowIndex>:<columnId>  one cell
//
// `resolveFormat` merges them with precedence column < row < cell (cell wins),
// which is what a body cell paints itself with.
//
// ── WHO OWNS WHAT: this store vs. the column-type system ──────────────────────
// The grid has exactly TWO stores that can change how a cell reads, and they are
// deliberately disjoint. Getting this wrong is how a codebase ends up with three
// half-overlapping "formatting" concepts, so the split is stated once, here, and
// every consumer follows it:
//
//   • `columnTypeOverrides` + `columnDef.meta` (the TYPE system) owns VALUE
//     presentation — what the cell's text SAYS. Decimal places, the currency
//     symbol, the thousands separator, a unit suffix, the date pattern. It is
//     PER COLUMN because a column holds one kind of value: a cell that is
//     "1,234.50 USD" and the cell under it that is "12/03/2025" are not two
//     formats of one column, they are a broken column. It also supplies the
//     DEFAULT alignment (`alignmentFor`: numbers right, everything else left).
//
//   • `tableFormatting` (this store) owns VISUAL presentation — how that text
//     LOOKS. Fill, ink, borders, font family/size, bold / italic / underline,
//     and an EXPLICIT alignment. It is PER SCOPE (column < row < cell) because
//     "make this one cell red and bold" is a perfectly coherent thing to want.
//
// They overlap on exactly one property, alignment, and there the rule is: an
// explicit `Format.align` beats the type's default (`fmt.align ?? alignmentFor(
// type)` in CustomTable / EditableCell). That is the right way round — the type
// default is a guess, the stored align is something the user asked for.
//
// Consequence, and the reason it is spelled out: the number-format picker in the
// ops strip writes to the TYPE store, not to this one. It is a value-presentation
// change, so it lands per column even when the selection is a range. The picker
// says so in its own panel. There is no third store, and `Format` has no
// numeric fields.

import React from 'react'

export type Align = 'left' | 'center' | 'right'

// ── Borders ────────────────────────────────────────────────────────────────
// A cell can carry an independent border on each of its four sides. A side is
// modelled with THREE states so inheritance works like Excel:
//   • a `BorderSide` value → draw this border here
//   • explicit `null`      → "no border here" (clears anything inherited)
//   • absent (undefined)   → inherit (fall through to the class hairline grid)
export type BorderStyle = 'solid' | 'dashed' | 'dotted' | 'double'
export type BorderSide = { color: string; width: number; style: BorderStyle }
export type Borders = {
  top?: BorderSide | null
  right?: BorderSide | null
  bottom?: BorderSide | null
  left?: BorderSide | null
}

export type Format = {
  bg?: string
  fg?: string
  align?: Align
  // Text size, always as a whitelisted `<n>px` string (see FONT_SIZE_OPTIONS).
  fontSize?: string
  // A whitelisted CSS font stack (see FONT_FAMILY_OPTIONS) — never arbitrary
  // user CSS, so a stored/pasted value can never inject an unexpected family.
  fontFamily?: string
  // ── Character formatting ──────────────────────────────────────────────────
  // Modelled as PRESENT-OR-ABSENT rather than true/false: only `true` is ever
  // stored, and "off" is the key not being there at all. Two reasons.
  //   1. `mergeFormat` already treats `undefined` as "clear this key", so a
  //      toggle-off is the same operation as clearing any other field — no new
  //      rule, and `{}` keeps meaning "this scope has no opinion".
  //   2. Absent means INHERIT. A bold column with one un-bolded cell would need
  //      a stored `false` to express itself, which is a feature nothing asks
  //      for; storing `false` would instead quietly make every scope opinionated
  //      about every field and defeat the column < row < cell merge.
  bold?: boolean
  italic?: boolean
  underline?: boolean
  // Per-side borders (see the `Borders` note above for the null-vs-absent rule).
  borders?: Borders
}

const STORAGE_KEY = 'tableFormatting'

const ALIGNS = new Set<Align>(['left', 'center', 'right'])

/* ------------------------------------------------------ character formatting */

/**
 * The three boolean character styles, in the order the strip shows them. Kept as
 * data (not three copy-pasted `if`s) because five places have to agree on the
 * list: the sanitiser, the merge in `resolveFormat`, the CSS emitter below, the
 * strip's toggle descriptors and its Ctrl+B/I/U handler.
 */
export const TEXT_STYLE_KEYS = ['bold', 'italic', 'underline'] as const
export type TextStyleKey = (typeof TEXT_STYLE_KEYS)[number]

// The CSS each style paints. `text-decoration-line` rather than the
// `text-decoration` shorthand so turning on underline cannot silently reset a
// decoration colour/style something else set.
const TEXT_STYLE_CSS: Record<TextStyleKey, string> = {
  bold: 'font-weight:700',
  italic: 'font-style:italic',
  underline: 'text-decoration-line:underline',
}

/* ---------------------------------------------------------- border options */

// The four sides, in a stable order used everywhere borders are iterated.
export const BORDER_SIDES = ['top', 'right', 'bottom', 'left'] as const
export type BorderSideName = (typeof BORDER_SIDES)[number]

const BORDER_STYLES = new Set<BorderStyle>([
  'solid',
  'dashed',
  'dotted',
  'double',
])

// Widths are clamped to a sane hairline‥thick range so a stored/pasted value
// can never blow the grid apart.
const BORDER_MIN_WIDTH = 1
const BORDER_MAX_WIDTH = 8

/**
 * Coerce one side into a clean `BorderSide`, or `null` when the input is
 * explicitly `null` ("no border"), or `undefined` when it is unusable (so the
 * caller drops the side and lets it inherit). Colour is kept as any non-empty
 * string (a hex or a design token), style is whitelisted, width is clamped.
 */
function sanitizeBorderSide(
  value: unknown,
): BorderSide | null | undefined {
  if (value === null) return null
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const color = typeof raw.color === 'string' && raw.color ? raw.color : null
  const style =
    typeof raw.style === 'string' && BORDER_STYLES.has(raw.style as BorderStyle)
      ? (raw.style as BorderStyle)
      : null
  const widthRaw =
    typeof raw.width === 'number' && Number.isFinite(raw.width)
      ? raw.width
      : null
  if (color === null || style === null || widthRaw === null) return undefined
  const width = Math.max(
    BORDER_MIN_WIDTH,
    Math.min(BORDER_MAX_WIDTH, Math.round(widthRaw)),
  )
  return { color, width, style }
}

/**
 * Clean a whole `borders` object. Preserves the null-vs-absent distinction: an
 * explicit `null` side survives (it means "cleared"), an invalid side is
 * dropped (so it inherits). Returns `undefined` when nothing usable remains.
 */
function sanitizeBorders(value: unknown): Borders | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const out: Borders = {}
  for (const side of BORDER_SIDES) {
    if (!(side in raw)) continue
    const clean = sanitizeBorderSide(raw[side])
    // `undefined` = unusable → drop the side; `null`/BorderSide → keep it.
    if (clean !== undefined) out[side] = clean
  }
  return Object.keys(out).length ? out : undefined
}

/**
 * Merge a `borders` patch onto a base PER SIDE. A side present in the patch
 * overrides the base side (a `BorderSide` sets it, `null` clears it); a side
 * absent from the patch leaves the base side untouched. A patch of `undefined`
 * or `null` clears every side (mirrors the "undefined clears" rule elsewhere).
 */
function mergeBorders(
  base: Borders | undefined,
  patch: Borders | null | undefined,
): Borders | undefined {
  if (patch === undefined || patch === null) return undefined
  const next: Borders = { ...(base ?? {}) }
  for (const side of BORDER_SIDES) {
    if (!(side in patch)) continue
    const value = patch[side]
    // An explicit `undefined` in the patch means "reset this side to inherit".
    if (value === undefined) delete next[side]
    else next[side] = value
  }
  return Object.keys(next).length ? next : undefined
}

/* ------------------------------------------------------------ font options */

// The sizes the actions-bar / popup may pick from. Kept as data so the UI and
// the sanitiser share one list. Any `<n>px` in 8‥96 is also accepted so a
// future control can offer an arbitrary size without loosening the store.
export const FONT_SIZE_OPTIONS: readonly string[] = [
  '11px',
  '12px',
  '13px',
  '14px',
  '16px',
  '18px',
  '20px',
  '24px',
]

export type FontFamilyOption = { label: string; value: string }

// A short, safe set of cross-platform stacks. `value` is what lands in the
// store and the inline `fontFamily`; `label` is what a picker shows.
export const FONT_FAMILY_OPTIONS: readonly FontFamilyOption[] = [
  { label: 'Sans', value: 'ui-sans-serif, system-ui, sans-serif' },
  { label: 'Serif', value: 'ui-serif, Georgia, Cambria, serif' },
  { label: 'Mono', value: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
]

const FONT_FAMILY_VALUES = new Set(FONT_FAMILY_OPTIONS.map((o) => o.value))

// Accept the whitelisted sizes plus any `<n>px` in a sane range, so the store
// stays the single gate on what a cell can be given.
const isValidFontSize = (value: string): boolean => {
  const match = /^(\d{1,3})px$/.exec(value)
  if (!match) return false
  const n = Number(match[1])
  return n >= 8 && n <= 96
}

/* ------------------------------------------------------------- scope keys */

export const colScopeKey = (columnId: string): string => `col:${columnId}`
export const rowScopeKey = (dataRowIndex: number): string =>
  `row:${dataRowIndex}`
export const cellScopeKey = (dataRowIndex: number, columnId: string): string =>
  `cell:${dataRowIndex}:${columnId}`

/**
 * Coerce anything (including malformed stored JSON) into a clean `Format`, or
 * `null` when nothing usable survives. Unknown keys are dropped; `align` is
 * whitelisted; colours are kept only as non-empty strings (the value the user
 * actually picked - a hex, or a slate token - is theirs to choose).
 */
export function sanitizeFormat(value: unknown): Format | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const out: Format = {}
  if (typeof raw.bg === 'string' && raw.bg) out.bg = raw.bg
  if (typeof raw.fg === 'string' && raw.fg) out.fg = raw.fg
  if (typeof raw.align === 'string' && ALIGNS.has(raw.align as Align)) {
    out.align = raw.align as Align
  }
  if (typeof raw.fontSize === 'string' && isValidFontSize(raw.fontSize)) {
    out.fontSize = raw.fontSize
  }
  if (
    typeof raw.fontFamily === 'string' &&
    FONT_FAMILY_VALUES.has(raw.fontFamily)
  ) {
    out.fontFamily = raw.fontFamily
  }
  // Character formatting: ONLY a literal `true` survives. A stored `false` (or
  // 'true', or 1) is dropped, which collapses "off" back onto "absent" and keeps
  // the present-or-absent invariant the `Format` docs above rely on.
  for (const key of TEXT_STYLE_KEYS) {
    if (raw[key] === true) out[key] = true
  }
  const borders = sanitizeBorders(raw.borders)
  if (borders) out.borders = borders
  return Object.keys(out).length ? out : null
}

/**
 * Merge `patch` onto `base`, where an `undefined` or `''` field clears that key
 * rather than overwriting it. Returns a cleaned object (never mutates `base`).
 */
export function mergeFormat(base: Format, patch: Partial<Format>): Format {
  const next: Format = { ...base }
  ;(Object.keys(patch) as (keyof Format)[]).forEach((key) => {
    const value = patch[key]
    // Borders merge PER SIDE rather than replacing wholesale, so applying a
    // "top border" preset does not wipe an existing "left border" in the scope.
    if (key === 'borders') {
      const merged = mergeBorders(base.borders, value as Borders | null)
      if (merged) next.borders = merged
      else delete next.borders
      return
    }
    if (value === undefined || value === '') delete next[key]
    else (next as Record<string, unknown>)[key] = value
  })
  return sanitizeFormat(next) ?? {}
}

/* --------------------------------------------------- the stylesheet mirror */
//
// WHY A STYLESHEET AND NOT AN INLINE STYLE.
//
// Fill / ink / font-size / font-family reach a cell as inline `style` on the
// `<td>` (CustomTable) and on the editor `<input>` (EditableCell). Character
// formatting deliberately does NOT, for two reasons:
//
//   1. `text-decoration` does not propagate into a form control, and the visible
//      text of an editable cell IS an `<input>`. An inline underline on the
//      `<td>` would paint nothing on the vast majority of cells. Reaching the
//      input needs a rule that names the input, i.e. a selector.
//   2. Bold/italic/underline are pure paint with no layout input, so pushing
//      them through React means re-rendering every cell of a 1000-row grid to
//      change three characters of CSS. `useColumnDrag` already establishes the
//      idiom here — one <style> element, rewritten only when the data changes,
//      keyed on the `data-col-id` / `data-data-index` attributes the grid
//      already puts on its cells and rows for exactly this kind of lookup.
//
// So the store keeps TWO mirrors of itself: `localStorage` for durability, and
// this <style> element for paint. Both are refreshed from the same `notify()`.
//
// PRECEDENCE FALLS OUT OF SPECIFICITY, and matches `resolveFormat` exactly:
//   col   `td[data-col-id="x"]`                       → (0,1,1)
//   row   `tr[data-data-index="n"] td[data-col-id]`   → (0,2,2)
//   cell  `tr[data-data-index="n"] td[data-col-id="x"]` → (0,2,2)
// Column loses to both on specificity; row and cell tie, so cell is emitted
// LAST and wins on source order. The rules are ordered by scope kind on every
// rebuild rather than by the map's insertion order, so the outcome cannot drift
// with the order the user happened to click things in.

const STYLE_ELEMENT_ATTR = 'data-jt-text-format'

// Escape a value for embedding in a quoted CSS attribute selector. Same helper
// (and same two characters that matter) as `useColumnDrag`'s.
const cssEscape = (value: string) => value.replace(/["\\]/g, '\\$&')

/** The `font-weight/style/decoration` declarations a Format asks for, or ''. */
function textStyleDeclarations(format: Format): string {
  const parts: string[] = []
  for (const key of TEXT_STYLE_KEYS) {
    if (format[key]) parts.push(TEXT_STYLE_CSS[key])
  }
  return parts.join(';')
}

/**
 * The selector a scope key paints through, or `null` when the key is not one of
 * the three known shapes (a hand-edited storage entry, or a scope kind added
 * later that has no DOM handle yet — better to paint nothing than to guess).
 *
 * Each selector names BOTH the cell and any `<input>` inside it: the editor
 * input is a separate inheritance root for `text-decoration`, and Tailwind's
 * preflight only forwards `font-family`/`font-size`/`font-weight` into form
 * controls, so italic and underline would stop at the `<td>` otherwise.
 */
function selectorForScopeKey(key: string): string | null {
  const cellAnd = (base: string) => `${base},${base} input`

  if (key.startsWith('col:')) {
    const columnId = key.slice(4)
    if (!columnId) return null
    return cellAnd(`td[data-col-id="${cssEscape(columnId)}"]`)
  }
  if (key.startsWith('row:')) {
    const index = key.slice(4)
    // `td[data-col-id]` and not a bare `td`, so a whole-row style leaves the
    // row-number gutter cell (which carries no column id) alone.
    if (!/^\d+$/.test(index)) return null
    return cellAnd(`tr[data-data-index="${index}"] td[data-col-id]`)
  }
  if (key.startsWith('cell:')) {
    const rest = key.slice(5)
    const split = rest.indexOf(':')
    if (split <= 0) return null
    const index = rest.slice(0, split)
    const columnId = rest.slice(split + 1)
    if (!/^\d+$/.test(index) || !columnId) return null
    return cellAnd(
      `tr[data-data-index="${index}"] td[data-col-id="${cssEscape(columnId)}"]`,
    )
  }
  return null
}

// Emission order = precedence order (see the note above). Anything unrecognised
// sorts last and is dropped by `selectorForScopeKey` anyway.
const SCOPE_RANK = (key: string): number =>
  key.startsWith('col:') ? 0 : key.startsWith('row:') ? 1 : 2

/** Build the whole stylesheet text for a scope-key → Format map. */
function buildTextStyleCss(entries: Map<string, Format>): string {
  const rules: string[] = []
  const keys = Array.from(entries.keys()).sort(
    (a, b) => SCOPE_RANK(a) - SCOPE_RANK(b),
  )
  for (const key of keys) {
    const declarations = textStyleDeclarations(entries.get(key)!)
    if (!declarations) continue
    const selector = selectorForScopeKey(key)
    if (!selector) continue
    rules.push(`${selector}{${declarations}}`)
  }
  return rules.join('\n')
}

class FormattingStore {
  private map = new Map<string, Format>()
  // The live <style> node, created on first use. Held here (not looked up by
  // selector each time) so a rebuild is a single `textContent` write.
  private styleEl: HTMLStyleElement | null = null
  private listeners = new Set<() => void>()
  private revision = 0
  private loaded = false

  /** Bumped on every change - use as a `useSyncExternalStore` snapshot. */
  get version(): number {
    return this.revision
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify() {
    this.revision++
    this.persist()
    this.syncStyleSheet()
    this.listeners.forEach((listener) => {
      // A misbehaving subscriber must never take the grid down with it.
      try {
        listener()
      } catch {
        /* ignored */
      }
    })
  }

  // Loading is lazy so the module is import-safe even where `localStorage` is
  // unavailable; the first read (a cell painting itself) triggers it.
  private ensureLoaded() {
    if (this.loaded) return
    this.loaded = true
    try {
      const raw =
        typeof localStorage === 'undefined'
          ? null
          : localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object') return
      for (const [key, value] of Object.entries(
        parsed as Record<string, unknown>,
      )) {
        const format = sanitizeFormat(value)
        if (format) this.map.set(key, format)
      }
    } catch {
      // Malformed JSON / denied storage: start empty rather than throwing.
    }
    // Paint whatever was just loaded. This runs on the first read, which is a
    // cell resolving its own format during render — writing to `document.head`
    // there is safe (the node is outside React's tree, and it lands before the
    // browser paints the very render that triggered it).
    this.syncStyleSheet()
  }

  /**
   * Rewrite the character-formatting stylesheet from the current map. A no-op
   * where there is no DOM (SSR, tests, a Node import) and whenever the text has
   * not actually changed, so an unrelated colour edit costs nothing.
   */
  private syncStyleSheet() {
    if (typeof document === 'undefined') return
    const css = buildTextStyleCss(this.map)
    if (!this.styleEl) {
      // Nothing stored asks for character formatting and we have never emitted:
      // don't add an empty <style> to every page that merely imports the grid.
      if (!css) return
      this.styleEl = document.createElement('style')
      this.styleEl.setAttribute(STYLE_ELEMENT_ATTR, '')
      document.head.appendChild(this.styleEl)
    }
    if (this.styleEl.textContent !== css) this.styleEl.textContent = css
  }

  private persist() {
    try {
      if (typeof localStorage === 'undefined') return
      const obj: Record<string, Format> = {}
      this.map.forEach((value, key) => {
        obj[key] = value
      })
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj))
    } catch {
      // Quota / private-mode denial: the in-memory store still works this session.
    }
  }

  /** The stored format for one scope key, as a fresh object (never shared). */
  get(key: string): Format {
    this.ensureLoaded()
    const format = this.map.get(key)
    return format ? { ...format } : {}
  }

  /** Replace a scope wholesale; an empty result removes the entry. */
  set(key: string, format: Format) {
    this.ensureLoaded()
    const clean = sanitizeFormat(format)
    if (!clean) this.map.delete(key)
    else this.map.set(key, clean)
    this.notify()
  }

  /** Patch a scope: `undefined` / `''` fields clear, everything else overwrites. */
  update(key: string, patch: Partial<Format>) {
    this.ensureLoaded()
    const next = mergeFormat(this.map.get(key) ?? {}, patch)
    if (!Object.keys(next).length) this.map.delete(key)
    else this.map.set(key, next)
    this.notify()
  }

  /** Drop a whole scope. */
  clear(key: string) {
    this.ensureLoaded()
    if (this.map.delete(key)) this.notify()
  }

  /**
   * A deep-cloned plain object of every current scope → Format entry, suitable
   * for stashing in a format profile. Each Format is re-sanitised on the way out
   * so the snapshot shares no references with the live map (mutating it later can
   * never reach back into the store).
   */
  snapshot(): Record<string, Format> {
    this.ensureLoaded()
    const out: Record<string, Format> = {}
    this.map.forEach((value, key) => {
      const clean = sanitizeFormat(value)
      if (clean) out[key] = clean
    })
    return out
  }

  /**
   * REPLACE the whole map with a sanitised clone of `entries` (a snapshot taken
   * earlier). `null` / an empty object clears everything. Persists, bumps the
   * version and notifies exactly once, so the grid re-renders with the new look.
   */
  restore(entries: Record<string, Format> | null): void {
    this.ensureLoaded()
    this.map.clear()
    if (entries && typeof entries === 'object') {
      for (const [key, value] of Object.entries(entries)) {
        if (!key) continue
        const clean = sanitizeFormat(value)
        if (clean) this.map.set(key, clean)
      }
    }
    this.notify()
  }

  /**
   * Effective format for a cell, merging column < row < cell (cell wins).
   * A negative `dataRowIndex` (a grouped / aggregate row with no backing data
   * row) resolves the column scope only.
   */
  resolveFormat(columnId: string, dataRowIndex: number): Format {
    this.ensureLoaded()
    const out: Format = {}
    const merge = (format?: Format) => {
      if (!format) return
      if (format.bg) out.bg = format.bg
      if (format.fg) out.fg = format.fg
      if (format.align) out.align = format.align
      if (format.fontSize) out.fontSize = format.fontSize
      if (format.fontFamily) out.fontFamily = format.fontFamily
      // Character styles are additive down the chain, and only ever ON: a bold
      // column stays bold in a cell that also asks for italic. See the
      // present-or-absent note on `Format` for why there is no "un-bold me".
      for (const key of TEXT_STYLE_KEYS) {
        if (format[key]) out[key] = true
      }
      // Borders resolve PER SIDE, so a cell can override just its top border
      // while inheriting the column's other three. A more specific scope's
      // side wins — including an explicit `null`, which clears an inherited
      // border for that side.
      if (format.borders) {
        for (const side of BORDER_SIDES) {
          if (side in format.borders) {
            if (!out.borders) out.borders = {}
            out.borders[side] = format.borders[side]
          }
        }
      }
    }
    merge(this.map.get(colScopeKey(columnId)))
    if (dataRowIndex >= 0) {
      merge(this.map.get(rowScopeKey(dataRowIndex)))
      merge(this.map.get(cellScopeKey(dataRowIndex, columnId)))
    }
    return out
  }
}

/** The single store the whole grid shares (mirrors `customFunctions`). */
export const tableFormatting = new FormattingStore()

/** Convenience free function for the hot path in `CustomTable`. */
export const resolveFormat = (columnId: string, dataRowIndex: number): Format =>
  tableFormatting.resolveFormat(columnId, dataRowIndex)

/**
 * Re-render on any formatting change. Returns the store's version counter, so a
 * component reading `resolveFormat` during render stays in sync.
 */
export function useFormatVersion(): number {
  return React.useSyncExternalStore(
    React.useCallback(
      (listener: () => void) => tableFormatting.subscribe(listener),
      [],
    ),
    () => tableFormatting.version,
    () => tableFormatting.version,
  )
}
