// The selectable column-type presets: the menu of "kinds of column" a user can
// pick from. Each preset is a thin, JSON-round-trippable descriptor that
// resolves to a `{ type, ...options }` slice of `TypeOptions`.
//
// There are two sources:
//   • BUILTIN_PRESETS — a big, fixed catalogue (Basic types + a units library).
//   • custom presets   — user-defined units, kept in a module-singleton store
//                        that mirrors `formatting.ts` (localStorage mirror,
//                        framework-agnostic `subscribe` / `version`, and a
//                        `useSyncExternalStore` adapter).
//
// `columnTypeOverrides.ts` resolves a stored preset id back through this
// registry, so the id is the durable handle the rest of the app stores.

import React from 'react'
import { isDateType, type ColumnType, type TypeOptions } from './columnTypes'

export type ColumnTypePreset = {
  id: string
  label: string
  group: string
  type: ColumnType
  options?: Partial<TypeOptions>
  builtin: boolean
}

/* --------------------------------------------------------------- built-ins */

// A `decimal` unit preset: the workhorse behind the whole Units group.
const unit = (
  id: string,
  label: string,
  symbol: string,
  decimals = 2,
): ColumnTypePreset => ({
  id,
  label,
  group: 'Units',
  type: 'decimal',
  options: { type: 'decimal', suffix: symbol, decimals },
  builtin: true,
})

export const BUILTIN_PRESETS: readonly ColumnTypePreset[] = [
  /* -------- Basic -------- */
  { id: 'text', label: 'Text', group: 'Basic', type: 'text', options: { type: 'text' }, builtin: true },
  { id: 'number', label: 'Number', group: 'Basic', type: 'number', options: { type: 'number' }, builtin: true },
  { id: 'decimal', label: 'Decimal', group: 'Basic', type: 'decimal', options: { type: 'decimal' }, builtin: true },
  {
    id: 'currency',
    label: 'Currency (USD)',
    group: 'Basic',
    type: 'currency',
    options: { type: 'currency', currency: 'USD', decimals: 2 },
    builtin: true,
  },
  {
    id: 'percent',
    label: 'Percent',
    group: 'Basic',
    type: 'decimal',
    options: { type: 'decimal', suffix: '%', decimals: 1 },
    builtin: true,
  },
  {
    id: 'date',
    label: 'Date',
    group: 'Basic',
    type: 'date',
    options: { type: 'date', dateFormat: 'yyyy-MM-dd' },
    builtin: true,
  },
  {
    id: 'datetime',
    label: 'Date & time',
    group: 'Basic',
    type: 'datetime',
    options: { type: 'datetime', dateFormat: 'yyyy-MM-dd HH:mm' },
    builtin: true,
  },
  {
    id: 'mixed',
    label: 'Mixed / Any',
    group: 'Basic',
    type: 'mixed',
    options: { type: 'mixed', acceptedTypes: ['text', 'image', 'file'] },
    builtin: true,
  },
  { id: 'file', label: 'File', group: 'Basic', type: 'file', options: { type: 'file' }, builtin: true },
  { id: 'image', label: 'Image', group: 'Basic', type: 'image', options: { type: 'image' }, builtin: true },

  /* -------- Units (length) -------- */
  unit('unit-ft', 'Feet', 'ft'),
  unit('unit-in', 'Inches', 'in'),
  unit('unit-mm', 'Millimeters', 'mm'),
  unit('unit-cm', 'Centimeters', 'cm'),
  unit('unit-m', 'Meters', 'm'),
  unit('unit-km', 'Kilometers', 'km'),
  unit('unit-px', 'Pixels', 'px', 0),

  /* -------- Units (angle) -------- */
  unit('unit-deg', 'Degrees', '°'),

  /* -------- Units (mass) -------- */
  unit('unit-kg', 'Kilograms', 'kg'),
  unit('unit-g', 'Grams', 'g'),
  unit('unit-lb', 'Pounds', 'lb'),
  unit('unit-oz', 'Ounces', 'oz'),

  /* -------- Units (volume) -------- */
  unit('unit-l', 'Liters', 'L'),
  unit('unit-ml', 'Milliliters', 'ml'),
]

/* ------------------------------------------------- synthesised format presets */
//
// The ops strip's number-format picker (currency / percentage / decimal places /
// thousands separator / date pattern) needs to record a per-column choice. It
// records it as a preset id, like everything else here — but the ids are
// SYNTHESISED from a grammar rather than looked up in a fixed catalogue, and
// they never appear in `list()` (they are a formatting choice, not a "kind of
// column", and 4 × 7 × 2 combinations would drown the type menu).
//
// Why an id and not an inline `TypeOptions` patch, which `columnTypeOverrides`
// also accepts: the inline path runs through that store's `sanitizeOptions`
// whitelist, which by design drops fields it has never heard of — including
// `useGrouping`, so "no thousands separator" would silently not survive a
// reload. A preset id is stored verbatim and re-resolved through `get()` here,
// so the option set is defined in ONE place (this file) and round-trips through
// localStorage, format profiles and shared snapshots without any of them
// needing to know the field exists.
//
// The grammar, `|`-separated so it stays readable in devtools:
//   fmt|num|<decimals>|<g|n>||<uriEncodedSuffix>     plain / percent / unit
//   fmt|cur|<decimals>|<g|n>|<ISO4217>|<uriEncodedSuffix>
//   fmt|date|<patternKey>      fmt|datetime|<patternKey>
// e.g. `fmt|num|1|g||%25` is "1 dp, grouped, % suffix" — a percentage.

const FORMAT_ID_PREFIX = 'fmt|'

/** Decimal places a format preset may ask for. Matches the registry's 0‥6 clamp. */
export const MIN_DECIMALS = 0
export const MAX_DECIMALS = 6

/** The currencies the picker offers. `code` is what Intl.NumberFormat is given. */
export const CURRENCY_OPTIONS: readonly { code: string; label: string }[] = [
  { code: 'USD', label: 'USD $' },
  { code: 'EUR', label: 'EUR €' },
  { code: 'GBP', label: 'GBP £' },
  { code: 'INR', label: 'INR ₹' },
  { code: 'JPY', label: 'JPY ¥' },
  { code: 'AUD', label: 'AUD $' },
  { code: 'CAD', label: 'CAD $' },
  { code: 'CHF', label: 'CHF' },
  { code: 'CNY', label: 'CNY ¥' },
]

/**
 * Date patterns offered by the picker, keyed rather than embedded in the id: a
 * date-fns pattern contains spaces and colons, and a fixed key set keeps the id
 * grammar unambiguous AND keeps a stored/pasted id from smuggling an arbitrary
 * format string into `formatDate`.
 */
export const DATE_FORMAT_PATTERNS: readonly {
  key: string
  label: string
  date: string
  datetime: string
}[] = [
  { key: 'iso', label: '2026-08-02', date: 'yyyy-MM-dd', datetime: 'yyyy-MM-dd HH:mm' },
  { key: 'us', label: '08/02/2026', date: 'MM/dd/yyyy', datetime: 'MM/dd/yyyy HH:mm' },
  { key: 'eu', label: '02/08/2026', date: 'dd/MM/yyyy', datetime: 'dd/MM/yyyy HH:mm' },
  { key: 'dot', label: '02.08.2026', date: 'dd.MM.yyyy', datetime: 'dd.MM.yyyy HH:mm' },
  { key: 'medium', label: '2 Aug 2026', date: 'd MMM yyyy', datetime: 'd MMM yyyy HH:mm' },
  { key: 'long', label: '2 August 2026', date: 'd MMMM yyyy', datetime: "d MMMM yyyy HH:mm" },
  { key: 'day', label: 'Sun, 2 Aug 2026', date: 'EEE, d MMM yyyy', datetime: 'EEE, d MMM yyyy HH:mm' },
  { key: 'us12', label: '08/02/2026 1:30 PM', date: 'MM/dd/yyyy', datetime: 'MM/dd/yyyy h:mm a' },
]

/**
 * The number-format choice, as the picker thinks about it. `suffix` is carried
 * through unchanged by the decimals / separator controls, so bumping the decimal
 * places on a "Kilograms" column keeps its `kg` — the picker adjusts the column's
 * format instead of replacing its type, which is the whole point of building the
 * id from the column's own resolved meta.
 */
export type NumberFormatSpec = {
  style: 'num' | 'cur'
  decimals: number
  grouping: boolean
  currency: string
  suffix: string
}

const clampDecimals = (n: number): number =>
  Math.min(MAX_DECIMALS, Math.max(MIN_DECIMALS, Math.trunc(n)))

/**
 * Read a column's CURRENT number format off its resolved meta, so every control
 * in the picker is a delta on what the column already is rather than a reset to
 * some default. Non-numeric columns (text, and anything else the picker is
 * willing to convert) read as a plain grouped 1-dp number.
 */
export function numberFormatSpecFromMeta(meta: TypeOptions | undefined): NumberFormatSpec {
  const type = meta?.type
  return {
    style: type === 'currency' ? 'cur' : 'num',
    decimals: clampDecimals(
      meta?.decimals ??
        (type === 'currency' ? 2 : type === 'number' ? 0 : 1),
    ),
    grouping: meta?.useGrouping !== false,
    currency: meta?.currency || 'USD',
    suffix: meta?.suffix ?? '',
  }
}

/** The durable id for a number-format spec. */
export function numberFormatPresetId(spec: NumberFormatSpec): string {
  return [
    'fmt',
    spec.style,
    String(clampDecimals(spec.decimals)),
    spec.grouping ? 'g' : 'n',
    spec.style === 'cur' ? spec.currency : '',
    encodeURIComponent(spec.suffix),
  ].join('|')
}

/** The durable id for a date-pattern choice. */
export function dateFormatPresetId(
  type: 'date' | 'datetime',
  patternKey: string,
): string {
  return `fmt|${type}|${patternKey}`
}

/** Which date pattern a resolved meta is currently using, or '' when it is custom. */
export function dateFormatKeyFromMeta(meta: TypeOptions | undefined): string {
  if (!isDateType(meta?.type) || !meta?.dateFormat) return ''
  const field = meta.type === 'datetime' ? 'datetime' : 'date'
  return DATE_FORMAT_PATTERNS.find((p) => p[field] === meta.dateFormat)?.key ?? ''
}

// A readable name for a synthesised preset. It is what the ops strip's "Type"
// trigger shows once a column carries a format id, so it has to say enough to
// identify the format without the user opening the picker.
function numberFormatLabel(spec: NumberFormatSpec): string {
  const parts: string[] = [
    spec.style === 'cur' ? `Currency (${spec.currency})` : 'Number',
    `${spec.decimals} dp`,
  ]
  if (spec.suffix) parts.push(spec.suffix)
  if (!spec.grouping) parts.push('no separator')
  return parts.join(' · ')
}

/**
 * Resolve a synthesised `fmt|…` id back into a preset, or `null` when it is not
 * one / is malformed. Everything is re-validated on the way out: decimals are
 * clamped, the currency has to look like an ISO code, the date pattern has to be
 * a key we published. A hand-edited storage entry therefore degrades to "no
 * override", never to an arbitrary format string reaching `Intl` / `date-fns`.
 */
function synthesiseFormatPreset(id: string): ColumnTypePreset | null {
  if (!id.startsWith(FORMAT_ID_PREFIX)) return null
  const parts = id.split('|')
  const kind = parts[1]

  if (kind === 'date' || kind === 'datetime') {
    const pattern = DATE_FORMAT_PATTERNS.find((p) => p.key === parts[2])
    if (!pattern) return null
    const dateFormat = kind === 'datetime' ? pattern.datetime : pattern.date
    return {
      id,
      label: `${kind === 'datetime' ? 'Date & time' : 'Date'} · ${pattern.label}`,
      group: 'Format',
      type: kind,
      options: { type: kind, dateFormat },
      builtin: true,
    }
  }

  if (kind !== 'num' && kind !== 'cur') return null
  if (parts.length < 6) return null

  const decimalsRaw = Number(parts[2])
  if (!Number.isFinite(decimalsRaw)) return null
  const currency = parts[4]
  if (kind === 'cur' && !/^[A-Za-z]{3}$/.test(currency)) return null

  let suffix = ''
  try {
    // A malformed percent-escape throws; treat it as "no suffix" rather than
    // discarding an otherwise perfectly good format.
    suffix = decodeURIComponent(parts.slice(5).join('|'))
  } catch {
    suffix = ''
  }

  const spec: NumberFormatSpec = {
    style: kind,
    decimals: clampDecimals(decimalsRaw),
    grouping: parts[3] !== 'n',
    currency: currency.toUpperCase(),
    suffix,
  }

  // `decimal` (not `number`) even at 0 dp: `number` TRUNCATES on both display
  // and re-entry, so "0 decimal places" would quietly turn 2.7 into 2 instead of
  // showing 3. Rounding is what a spreadsheet's decimal control does.
  const options: TypeOptions = {
    type: spec.style === 'cur' ? 'currency' : 'decimal',
    decimals: spec.decimals,
    useGrouping: spec.grouping,
    suffix: spec.suffix,
  }
  if (spec.style === 'cur') options.currency = spec.currency

  return {
    id,
    label: numberFormatLabel(spec),
    group: 'Format',
    type: options.type!,
    options,
    builtin: true,
  }
}

/* ------------------------------------------------------------ custom store */

const STORAGE_KEY = 'tableCustomColumnTypes'

// Only the fields a custom preset actually varies live in storage; everything
// else is reconstructed, so a hand-edited / older payload can never smuggle in
// an arbitrary `type` or unexpected option.
type StoredCustom = {
  id: string
  label: string
  symbol: string
  decimals: number
}

const MAX_LABEL = 40
const MAX_SYMBOL = 8

// Turn a raw stored entry into a full preset, or null when it is unusable.
const toCustomPreset = (value: unknown): ColumnTypePreset | null => {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.id !== 'string' || !raw.id) return null
  if (typeof raw.label !== 'string' || !raw.label.trim()) return null
  if (typeof raw.symbol !== 'string' || !raw.symbol) return null
  const decimals =
    typeof raw.decimals === 'number' && Number.isFinite(raw.decimals)
      ? Math.min(6, Math.max(0, Math.trunc(raw.decimals)))
      : 2
  return {
    id: raw.id,
    label: raw.label.trim().slice(0, MAX_LABEL),
    group: 'Custom',
    type: 'decimal',
    options: {
      type: 'decimal',
      suffix: raw.symbol.slice(0, MAX_SYMBOL),
      decimals,
    },
    builtin: false,
  }
}

class ColumnTypeRegistry {
  private customs = new Map<string, ColumnTypePreset>()
  private listeners = new Set<() => void>()
  private revision = 0
  private loaded = false

  /** Bumped on every change — use as a `useSyncExternalStore` snapshot. */
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
    this.listeners.forEach((listener) => {
      try {
        listener()
      } catch {
        /* a misbehaving subscriber must not take the grid down */
      }
    })
  }

  // Lazy load keeps the module import-safe where `localStorage` is absent.
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
      if (!Array.isArray(parsed)) return
      for (const entry of parsed) {
        const preset = toCustomPreset(entry)
        if (preset) this.customs.set(preset.id, preset)
      }
    } catch {
      // Malformed JSON / denied storage: start with no customs.
    }
  }

  private persist() {
    try {
      if (typeof localStorage === 'undefined') return
      const out: StoredCustom[] = []
      this.customs.forEach((preset) => {
        out.push({
          id: preset.id,
          label: preset.label,
          symbol: preset.options?.suffix ?? '',
          decimals: preset.options?.decimals ?? 2,
        })
      })
      localStorage.setItem(STORAGE_KEY, JSON.stringify(out))
    } catch {
      // Quota / private-mode denial: the in-memory store still works.
    }
  }

  /** Built-ins first, then user customs, all as fresh objects. */
  list(): ColumnTypePreset[] {
    this.ensureLoaded()
    return [
      ...BUILTIN_PRESETS.map((p) => ({ ...p, options: { ...p.options } })),
      ...Array.from(this.customs.values(), (p) => ({
        ...p,
        options: { ...p.options },
      })),
    ]
  }

  /**
   * Look one preset up by id: built-in, custom, or — last — synthesised from the
   * `fmt|…` grammar. Synthesised presets are resolvable but not listable, which
   * is exactly the asymmetry the number-format picker needs: every consumer that
   * turns a stored id into `TypeOptions` (`resolveMeta`, the strip's type label)
   * goes through here and just works, while the type MENU stays the short list
   * of column kinds a user actually picks between.
   */
  get(id: string): ColumnTypePreset | undefined {
    this.ensureLoaded()
    const builtin = BUILTIN_PRESETS.find((p) => p.id === id)
    if (builtin) return { ...builtin, options: { ...builtin.options } }
    const custom = this.customs.get(id)
    if (custom) return { ...custom, options: { ...custom.options } }
    return synthesiseFormatPreset(id) ?? undefined
  }

  /**
   * Create a custom `decimal` + suffix preset. Returns the stored preset, or
   * null when the label / symbol are empty. `decimals` is clamped to 0‥6.
   */
  addCustomUnit(
    label: string,
    symbol: string,
    decimals = 2,
  ): ColumnTypePreset | null {
    this.ensureLoaded()
    const cleanLabel = label.trim().slice(0, MAX_LABEL)
    const cleanSymbol = symbol.trim().slice(0, MAX_SYMBOL)
    if (!cleanLabel || !cleanSymbol) return null
    const id = `custom-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 8)}`
    const preset: ColumnTypePreset = {
      id,
      label: cleanLabel,
      group: 'Custom',
      type: 'decimal',
      options: {
        type: 'decimal',
        suffix: cleanSymbol,
        decimals: Math.min(6, Math.max(0, Math.trunc(decimals))),
      },
      builtin: false,
    }
    this.customs.set(id, preset)
    this.notify()
    return { ...preset, options: { ...preset.options } }
  }

  /**
   * Merge imported custom presets in by id (the clone path). Non-destructive:
   * existing customs are kept, incoming ones with the same id overwrite, new ids
   * are added — so a view that referenced a custom unit still resolves after an
   * import, without wiping the user's own units. Built-in ids are ignored.
   */
  restoreCustoms(presets: readonly unknown[]): void {
    this.ensureLoaded()
    let changed = false
    for (const raw of presets) {
      const value = raw as Record<string, unknown>
      if (!value || typeof value.id !== 'string') continue
      if (BUILTIN_PRESETS.some((p) => p.id === value.id)) continue
      const options = (value.options ?? {}) as Record<string, unknown>
      const preset: ColumnTypePreset = {
        id: value.id,
        label:
          typeof value.label === 'string' && value.label.trim()
            ? value.label.trim().slice(0, MAX_LABEL)
            : value.id,
        group: 'Custom',
        type: 'decimal',
        options: {
          type: 'decimal',
          suffix:
            typeof options.suffix === 'string'
              ? options.suffix.slice(0, MAX_SYMBOL)
              : '',
          decimals:
            typeof options.decimals === 'number' &&
            Number.isFinite(options.decimals)
              ? Math.min(6, Math.max(0, Math.trunc(options.decimals)))
              : 2,
        },
        builtin: false,
      }
      this.customs.set(preset.id, preset)
      changed = true
    }
    if (changed) this.notify()
  }

  /** Remove a custom preset. Built-in ids are ignored. Returns whether it went. */
  removeCustom(id: string): boolean {
    this.ensureLoaded()
    const removed = this.customs.delete(id)
    if (removed) this.notify()
    return removed
  }
}

/** The single registry the whole grid shares (mirrors `tableFormatting`). */
export const columnTypeRegistry = new ColumnTypeRegistry()

/** Every selectable preset, built-ins then customs. */
export const listColumnTypePresets = (): ColumnTypePreset[] =>
  columnTypeRegistry.list()

/** Resolve a preset id to its descriptor (built-in or custom). */
export const getColumnTypePreset = (id: string): ColumnTypePreset | undefined =>
  columnTypeRegistry.get(id)

/**
 * Re-render on any registry change (a custom unit added / removed). Returns the
 * store's version counter for a `useSyncExternalStore` consumer.
 */
export function useColumnTypeRegistryVersion(): number {
  return React.useSyncExternalStore(
    React.useCallback(
      (listener: () => void) => columnTypeRegistry.subscribe(listener),
      [],
    ),
    () => columnTypeRegistry.version,
    () => columnTypeRegistry.version,
  )
}
