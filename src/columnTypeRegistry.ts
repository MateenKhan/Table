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
import type { ColumnType, TypeOptions } from './columnTypes'

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

  /** Look one preset up by id (built-in or custom). */
  get(id: string): ColumnTypePreset | undefined {
    this.ensureLoaded()
    const builtin = BUILTIN_PRESETS.find((p) => p.id === id)
    if (builtin) return { ...builtin, options: { ...builtin.options } }
    const custom = this.customs.get(id)
    return custom ? { ...custom, options: { ...custom.options } } : undefined
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
