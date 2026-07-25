// Per-column chosen type: the store that records "the user set THIS column to
// THAT type". It is a module-singleton in the exact shape of `formatting.ts`
// (localStorage mirror, framework-agnostic `subscribe` / `version`, and a
// `useSyncExternalStore` adapter) and owns no React state.
//
// An override is stored as either a registry preset id (the durable, portable
// handle) or a raw `TypeOptions` patch. `resolveMeta` is the one method the app
// leans on: it folds a column's override onto that column's declared `meta`, so
// formatting, editing and query operators all pick up the chosen type with no
// further wiring — the override always wins.

import React from 'react'
import type { ColumnType, TypeOptions } from './columnTypes'
import { getColumnTypePreset } from './columnTypeRegistry'

// What a column can be overridden with: a preset id, or an inline options patch.
export type ColumnTypeOverride = string | TypeOptions

const STORAGE_KEY = 'tableColumnTypeOverrides'

const COLUMN_TYPES: ReadonlySet<ColumnType> = new Set<ColumnType>([
  'text',
  'number',
  'decimal',
  'currency',
  'file',
  'image',
  'date',
  'datetime',
  'mixed',
])

// Keep only recognised `TypeOptions` fields, so a stored / pasted object can
// never introduce unexpected keys. Returns null when nothing usable survives.
function sanitizeOptions(value: unknown): TypeOptions | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const out: TypeOptions = {}
  if (typeof raw.type === 'string' && COLUMN_TYPES.has(raw.type as ColumnType)) {
    out.type = raw.type as ColumnType
  }
  if (typeof raw.decimals === 'number' && Number.isFinite(raw.decimals)) {
    out.decimals = Math.min(6, Math.max(0, Math.trunc(raw.decimals)))
  }
  if (typeof raw.currency === 'string' && raw.currency) out.currency = raw.currency
  if (typeof raw.locale === 'string' && raw.locale) out.locale = raw.locale
  if (typeof raw.suffix === 'string') out.suffix = raw.suffix
  if (typeof raw.accept === 'string' && raw.accept) out.accept = raw.accept
  if (typeof raw.dateFormat === 'string' && raw.dateFormat) {
    out.dateFormat = raw.dateFormat
  }
  if (Array.isArray(raw.acceptedTypes)) {
    const kinds = raw.acceptedTypes.filter(
      (t): t is ColumnType => typeof t === 'string' && COLUMN_TYPES.has(t as ColumnType),
    )
    if (kinds.length) out.acceptedTypes = kinds
  }
  return Object.keys(out).length ? out : null
}

// Coerce any stored / incoming override into a clean form, or null to drop it.
function sanitizeOverride(value: unknown): ColumnTypeOverride | null {
  if (typeof value === 'string') return value.trim() ? value.trim() : null
  return sanitizeOptions(value)
}

class ColumnTypeOverrideStore {
  private map = new Map<string, ColumnTypeOverride>()
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
      if (!parsed || typeof parsed !== 'object') return
      for (const [key, value] of Object.entries(
        parsed as Record<string, unknown>,
      )) {
        const override = sanitizeOverride(value)
        if (override) this.map.set(key, override)
      }
    } catch {
      // Malformed JSON / denied storage: start empty.
    }
  }

  private persist() {
    try {
      if (typeof localStorage === 'undefined') return
      const obj: Record<string, ColumnTypeOverride> = {}
      this.map.forEach((value, key) => {
        obj[key] = value
      })
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj))
    } catch {
      // Quota / private-mode denial: the in-memory store still works.
    }
  }

  /** The raw override for a column (a preset id or an options patch), or null. */
  get(columnId: string): ColumnTypeOverride | null {
    this.ensureLoaded()
    return this.map.get(columnId) ?? null
  }

  /**
   * Set (or, with `null`, clear) a column's override. Accepts a registry preset
   * id or an inline `TypeOptions` patch.
   */
  set(columnId: string, override: ColumnTypeOverride | null): void {
    this.ensureLoaded()
    if (override === null) {
      if (this.map.delete(columnId)) this.notify()
      return
    }
    const clean = sanitizeOverride(override)
    if (!clean) {
      if (this.map.delete(columnId)) this.notify()
      return
    }
    this.map.set(columnId, clean)
    this.notify()
  }

  /** Drop a column's override. */
  clear(columnId: string): void {
    this.ensureLoaded()
    if (this.map.delete(columnId)) this.notify()
  }

  /**
   * A deep-cloned plain object of every current columnId → override entry, for
   * stashing in a format profile. Each override is re-sanitised on the way out,
   * so the snapshot shares no references with the live map.
   */
  snapshot(): Record<string, ColumnTypeOverride> {
    this.ensureLoaded()
    const out: Record<string, ColumnTypeOverride> = {}
    this.map.forEach((value, key) => {
      const clean = sanitizeOverride(value)
      if (clean) out[key] = clean
    })
    return out
  }

  /**
   * REPLACE the whole map with a sanitised clone of `entries` (a snapshot taken
   * earlier). `null` / an empty object clears everything. Persists, bumps the
   * version and notifies exactly once, so the grid re-renders with the new types.
   */
  restore(entries: Record<string, ColumnTypeOverride> | null): void {
    this.ensureLoaded()
    this.map.clear()
    if (entries && typeof entries === 'object') {
      for (const [key, value] of Object.entries(entries)) {
        if (!key) continue
        const clean = sanitizeOverride(value)
        if (clean) this.map.set(key, clean)
      }
    }
    this.notify()
  }

  /**
   * The effective `TypeOptions` for a column: its declared `baseMeta` with the
   * override folded on top (override wins). A stored preset id is resolved
   * through the registry to `{ type, ...options }` first. This is what the app
   * hands to `formatCellValue` / `acceptsInput` / `parseTypedValue`, so the
   * whole grid follows the chosen type automatically.
   */
  resolveMeta(
    columnId: string,
    baseMeta: TypeOptions | undefined,
  ): TypeOptions {
    this.ensureLoaded()
    const base = baseMeta ?? {}
    const override = this.map.get(columnId)
    if (!override) return { ...base }

    let patch: TypeOptions = {}
    if (typeof override === 'string') {
      const preset = getColumnTypePreset(override)
      if (preset) patch = { type: preset.type, ...preset.options }
    } else {
      patch = override
    }
    return { ...base, ...patch }
  }
}

/** The single override store the whole grid shares (mirrors `tableFormatting`). */
export const columnTypeOverrides = new ColumnTypeOverrideStore()

/** Convenience free function for folding an override onto a column's meta. */
export const resolveColumnMeta = (
  columnId: string,
  baseMeta: TypeOptions | undefined,
): TypeOptions => columnTypeOverrides.resolveMeta(columnId, baseMeta)

/**
 * Re-render on any override change. Returns the store's version counter so a
 * component reading `resolveMeta` during render stays in sync.
 */
export function useColumnTypeOverridesVersion(): number {
  return React.useSyncExternalStore(
    React.useCallback(
      (listener: () => void) => columnTypeOverrides.subscribe(listener),
      [],
    ),
    () => columnTypeOverrides.version,
    () => columnTypeOverrides.version,
  )
}
