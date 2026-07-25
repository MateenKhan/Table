// Named "format profiles": bundles of the grid's FORMATTING (not its data) that
// a user can save, re-apply, edit and delete. A profile captures a snapshot of
// BOTH global stores at save time — `tableFormatting` (per-scope colours /
// borders / fonts / alignment) and `columnTypeOverrides` (the per-column chosen
// datatype) — so applying one restores the whole look-and-feel in a single step.
//
// This is a module-level singleton in the exact shape of `savedQueries.ts` /
// `formatting.ts`: framework-agnostic `subscribe` / `version` hooks, a
// localStorage mirror, and a React `useSyncExternalStore` adapter so any
// consumer re-renders on a change. It owns NO React state and needs NO provider
// — the dialog both writes to and reads from this singleton.
//
// A profile round-trips through JSON: both snapshots are plain, serialisable
// data. Every entry read back from storage is re-validated; anything that cannot
// be made sense of is dropped rather than trusted, so a corrupt or hand-edited
// `tableFormatProfiles` can never crash a consumer.

import React from 'react'
import { tableFormatting, sanitizeFormat, Format } from './formatting'
import {
  columnTypeOverrides,
  ColumnTypeOverride,
} from './columnTypeOverrides'

export type FormatProfile = {
  id: string
  name: string
  /** Snapshot of `tableFormatting`: scope-key → Format. */
  formatting: Record<string, Format>
  /** Snapshot of `columnTypeOverrides`: columnId → override (preset id / patch). */
  columnTypes: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

const STORAGE_KEY = 'tableFormatProfiles'

/* --------------------------------------------------------------- id minting */

// Ids via a counter + random suffix, exactly like the other stores' sequences.
let idSeq = 0
const newId = (): string =>
  `fp-${++idSeq}-${Math.random().toString(36).slice(2, 7)}`

/* --------------------------------------------------------- map sanitising */

// Clean a stored `formatting` map: keep only string keys whose value sanitises
// to a usable Format. Doubles as a deep clone (sanitizeFormat builds a fresh
// object), so the stored copy shares no references with what was handed in.
function sanitizeFormatting(value: unknown): Record<string, Format> {
  const out: Record<string, Format> = {}
  if (!value || typeof value !== 'object') return out
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!key) continue
    const clean = sanitizeFormat(raw)
    if (clean) out[key] = clean
  }
  return out
}

// Clean a stored `columnTypes` map: keep only string keys whose value is a
// non-empty string (a preset id) or a plain object (an inline options patch).
// The override store re-sanitises on `restore`, so this is a light structural
// gate plus a deep clone of the object patches.
function sanitizeColumnTypes(value: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (!value || typeof value !== 'object') return out
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!key) continue
    if (typeof raw === 'string') {
      if (raw.trim()) out[key] = raw
    } else if (raw && typeof raw === 'object') {
      out[key] = JSON.parse(JSON.stringify(raw))
    }
  }
  return out
}

/**
 * Validate one stored record into a `FormatProfile`, or `null` to drop it. A
 * usable entry needs a non-empty id and a name string; the maps default to empty
 * and the timestamps fall back to "now", so a legacy/partial record still loads.
 */
function sanitizeEntry(input: unknown): FormatProfile | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>

  const id = typeof raw.id === 'string' ? raw.id : ''
  if (!id) return null
  if (typeof raw.name !== 'string') return null

  const now = Date.now()
  const createdAt =
    typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt)
      ? raw.createdAt
      : now
  const updatedAt =
    typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt)
      ? raw.updatedAt
      : createdAt

  return {
    id,
    name: raw.name,
    formatting: sanitizeFormatting(raw.formatting),
    columnTypes: sanitizeColumnTypes(raw.columnTypes),
    createdAt,
    updatedAt,
  }
}

/* ----------------------------------------------------------------- the store */

class FormatProfilesStore {
  private map = new Map<string, FormatProfile>()
  private listeners = new Set<() => void>()
  private revision = 0
  private loaded = false

  /** Bumped on every change — use as a `useSyncExternalStore` snapshot. */
  get version(): number {
    return this.revision
  }

  /** Framework-agnostic subscription. Returns an unsubscribe function. */
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
      // A misbehaving subscriber must never take a mutation down with it.
      try {
        listener()
      } catch {
        /* ignored */
      }
    })
  }

  // Loading is lazy so the module is import-safe even where `localStorage` is
  // unavailable; the first read triggers it.
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
      for (const record of parsed) {
        const entry = sanitizeEntry(record)
        if (entry) this.map.set(entry.id, entry)
      }
    } catch {
      // Malformed JSON / denied storage: start empty rather than throwing.
    }
  }

  private persist() {
    try {
      if (typeof localStorage === 'undefined') return
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(Array.from(this.map.values())),
      )
    } catch {
      // Quota / private-mode denial: the in-memory store still works this session.
    }
  }

  /** Every profile, most-recently-updated first, as fresh objects. */
  list(): FormatProfile[] {
    this.ensureLoaded()
    return Array.from(this.map.values())
      .map(clone)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /** One profile by id, as a fresh object, or `undefined`. */
  get(id: string): FormatProfile | undefined {
    this.ensureLoaded()
    const entry = this.map.get(id)
    return entry ? clone(entry) : undefined
  }

  /**
   * Snapshot BOTH live stores into a new profile under a fresh id. This is the
   * "save the current look" entry point. Returns the stored profile.
   */
  saveCurrent(name: string): FormatProfile {
    this.ensureLoaded()
    const now = Date.now()
    const entry: FormatProfile = {
      id: newId(),
      name: name.trim(),
      formatting: tableFormatting.snapshot(),
      columnTypes: columnTypeOverrides.snapshot(),
      createdAt: now,
      updatedAt: now,
    }
    this.map.set(entry.id, entry)
    this.notify()
    return clone(entry)
  }

  /**
   * Re-snapshot the CURRENT live stores into an existing profile (touches
   * `updatedAt`). No-op for an unknown id. Use this to "update" a profile to the
   * grid's current look after tweaking it.
   */
  updateCurrent(id: string): void {
    this.ensureLoaded()
    const entry = this.map.get(id)
    if (!entry) return
    this.map.set(id, {
      ...entry,
      formatting: tableFormatting.snapshot(),
      columnTypes: columnTypeOverrides.snapshot(),
      updatedAt: Date.now(),
    })
    this.notify()
  }

  /**
   * Apply a stored profile to the live grid: REPLACE both stores with the
   * profile's snapshots. Each store bumps its own version, so the whole grid
   * re-renders with the profile's look. No-op for an unknown id.
   */
  apply(id: string): void {
    this.ensureLoaded()
    const entry = this.map.get(id)
    if (!entry) return
    tableFormatting.restore(entry.formatting)
    // The override store re-sanitises each value; the cast is only to satisfy
    // the nominal `ColumnTypeOverride` element type of `restore`.
    columnTypeOverrides.restore(
      entry.columnTypes as Record<string, ColumnTypeOverride>,
    )
  }

  /** Rename an existing profile (touches `updatedAt`). No-op for an unknown id. */
  rename(id: string, name: string): void {
    this.ensureLoaded()
    const entry = this.map.get(id)
    if (!entry) return
    this.map.set(id, { ...entry, name: name.trim(), updatedAt: Date.now() })
    this.notify()
  }

  /** Delete one profile. */
  remove(id: string): void {
    this.ensureLoaded()
    if (this.map.delete(id)) this.notify()
  }

  /** Drop every profile. */
  clear(): void {
    this.ensureLoaded()
    if (!this.map.size) return
    this.map.clear()
    this.notify()
  }
}

// A structured clone via JSON: both snapshots are plain JSON, so this keeps
// callers from mutating the stored copy through the object they were handed.
const clone = (entry: FormatProfile): FormatProfile => ({
  id: entry.id,
  name: entry.name,
  formatting: JSON.parse(JSON.stringify(entry.formatting)) as Record<
    string,
    Format
  >,
  columnTypes: JSON.parse(JSON.stringify(entry.columnTypes)) as Record<
    string,
    unknown
  >,
  createdAt: entry.createdAt,
  updatedAt: entry.updatedAt,
})

/** The single store the whole feature shares (mirrors `savedQueries`). */
export const formatProfiles = new FormatProfilesStore()

/**
 * Re-render on any format-profiles change. Returns the store's version counter,
 * so a component reading `formatProfiles.list()` during render stays in sync.
 */
export function useFormatProfilesVersion(): number {
  return React.useSyncExternalStore(
    React.useCallback(
      (listener: () => void) => formatProfiles.subscribe(listener),
      [],
    ),
    () => formatProfiles.version,
    () => formatProfiles.version,
  )
}
