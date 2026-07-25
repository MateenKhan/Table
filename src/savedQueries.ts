// Browser-stored "saved queries": name a GlobalSearchValue the user built and
// recall it later. This is a module-level singleton in the exact shape of
// `customFunctions.ts` / `formatting.ts`: framework-agnostic `subscribe` /
// `version` hooks, a localStorage mirror, and a React `useSyncExternalStore`
// adapter so any consumer re-renders on a change. It owns NO React state and
// needs NO provider — the dialog both writes to and reads from this singleton.
//
// A saved query round-trips through JSON: `GlobalSearchValue` is plain,
// serialisable data (see globalSearch.ts), so persistence is a stringify away.
// Every entry read back from storage is re-validated and coerced into a known
// shape; anything that cannot be made sense of is dropped rather than trusted,
// so a corrupt or hand-edited `tableSavedQueries` can never crash a consumer.

import React from 'react'
import { GlobalSearchValue, emptyGlobalSearch } from './globalSearch'

export type SavedQuery = {
  id: string
  name: string
  value: GlobalSearchValue
  createdAt: number
  updatedAt: number
}

const STORAGE_KEY = 'tableSavedQueries'

/* --------------------------------------------------------------- id minting */

// Ids via a counter + random suffix, exactly like the other stores' sequences.
// The suffix keeps two ids minted in the same millisecond distinct.
let idSeq = 0
const newId = (): string => `sq-${++idSeq}-${Math.random().toString(36).slice(2, 7)}`

/* --------------------------------------------------------- value sanitising */

const asString = (value: unknown): string =>
  typeof value === 'string' ? value : ''

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []

const asObjectArray = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter(
        (v): v is Record<string, unknown> => !!v && typeof v === 'object',
      )
    : []

/**
 * Coerce anything (including malformed stored JSON) into a clean, complete
 * `GlobalSearchValue`, or `null` when the input is not even an object. Every
 * field is normalised against `emptyGlobalSearch`'s shape so downstream helpers
 * (`querySummary`, `isGlobalSearchEmpty`) never meet a missing array or a
 * non-object rule. This doubles as a deep clone: the result shares no
 * references with the input, so persisting the live builder value cannot later
 * be mutated out from under the store.
 */
function sanitizeValue(input: unknown): GlobalSearchValue | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>

  const values = asObjectArray(raw.values).map((entry) => ({
    columnId: asString(entry.columnId),
    value: asString(entry.value),
  }))

  // Rules keep the operands the user typed; we only guarantee each is an object
  // with the string fields the summary reads, so `ruleSummary` never throws.
  const rules = asObjectArray(raw.rules).map((entry) => {
    const rule: Record<string, unknown> = {
      id: asString(entry.id) || newId(),
      columnId: asString(entry.columnId),
      operator: asString(entry.operator),
      value: asString(entry.value),
    }
    if (typeof entry.value2 === 'string') rule.value2 = entry.value2
    return rule
  })

  const connectors = Array.isArray(raw.connectors)
    ? raw.connectors.map((c) => (c === 'or' ? 'or' : 'and'))
    : []

  let limit: GlobalSearchValue['limit'] = null
  if (raw.limit && typeof raw.limit === 'object') {
    const l = raw.limit as Record<string, unknown>
    const columnId = asString(l.columnId)
    const dir = l.dir === 'bottom' ? 'bottom' : 'top'
    const n = typeof l.n === 'number' && Number.isFinite(l.n) ? l.n : NaN
    if (columnId && Number.isFinite(n)) limit = { columnId, dir, n }
  }

  const normalized = {
    ...emptyGlobalSearch,
    text: asString(raw.text),
    values,
    columns: asStringArray(raw.columns),
    rules,
    combinator: raw.combinator === 'or' ? 'or' : 'and',
    connectors,
    limit,
  }

  // The structural shape above matches GlobalSearchValue; the rule/connector
  // arrays are validated members rather than the exact nominal types.
  return normalized as unknown as GlobalSearchValue
}

/**
 * Validate one stored record into a `SavedQuery`, or `null` to drop it. A usable
 * entry needs a non-empty id, a name string, and a value that sanitises; the
 * timestamps fall back to "now" so a legacy/partial record still sorts sensibly.
 */
function sanitizeEntry(input: unknown): SavedQuery | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>

  const id = asString(raw.id)
  if (!id) return null
  if (typeof raw.name !== 'string') return null

  const value = sanitizeValue(raw.value)
  if (!value) return null

  const now = Date.now()
  const createdAt =
    typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt)
      ? raw.createdAt
      : now
  const updatedAt =
    typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt)
      ? raw.updatedAt
      : createdAt

  return { id, name: raw.name, value, createdAt, updatedAt }
}

/* ----------------------------------------------------------------- the store */

class SavedQueriesStore {
  private map = new Map<string, SavedQuery>()
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(this.map.values())))
    } catch {
      // Quota / private-mode denial: the in-memory store still works this session.
    }
  }

  /** Every saved query, most-recently-updated first, as fresh objects. */
  list(): SavedQuery[] {
    this.ensureLoaded()
    return Array.from(this.map.values())
      .map(clone)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /** One saved query by id, as a fresh object, or `undefined`. */
  get(id: string): SavedQuery | undefined {
    this.ensureLoaded()
    const entry = this.map.get(id)
    return entry ? clone(entry) : undefined
  }

  /** Store a new saved query under a fresh id. Returns the stored entry. */
  save(name: string, value: GlobalSearchValue): SavedQuery {
    this.ensureLoaded()
    const now = Date.now()
    const entry: SavedQuery = {
      id: newId(),
      name: name.trim(),
      value: sanitizeValue(value) ?? { ...emptyGlobalSearch },
      createdAt: now,
      updatedAt: now,
    }
    this.map.set(entry.id, entry)
    this.notify()
    return clone(entry)
  }

  /** Rename an existing entry (touches `updatedAt`). No-op for an unknown id. */
  rename(id: string, name: string): void {
    this.ensureLoaded()
    const entry = this.map.get(id)
    if (!entry) return
    this.map.set(id, { ...entry, name: name.trim(), updatedAt: Date.now() })
    this.notify()
  }

  /** Swap the stored query of an existing entry (touches `updatedAt`). */
  replace(id: string, value: GlobalSearchValue): void {
    this.ensureLoaded()
    const entry = this.map.get(id)
    if (!entry) return
    this.map.set(id, {
      ...entry,
      value: sanitizeValue(value) ?? { ...emptyGlobalSearch },
      updatedAt: Date.now(),
    })
    this.notify()
  }

  /** Delete one entry. */
  remove(id: string): void {
    this.ensureLoaded()
    if (this.map.delete(id)) this.notify()
  }

  /** Drop every saved query. */
  clear(): void {
    this.ensureLoaded()
    if (!this.map.size) return
    this.map.clear()
    this.notify()
  }
}

const clone = (entry: SavedQuery): SavedQuery => ({
  id: entry.id,
  name: entry.name,
  // The value is plain JSON; a structured clone keeps callers from mutating the
  // stored copy through the object they were handed.
  value: JSON.parse(JSON.stringify(entry.value)) as GlobalSearchValue,
  createdAt: entry.createdAt,
  updatedAt: entry.updatedAt,
})

/** The single store the whole feature shares (mirrors `tableFormatting`). */
export const savedQueries = new SavedQueriesStore()

/**
 * Re-render on any saved-queries change. Returns the store's version counter, so
 * a component reading `savedQueries.list()` during render stays in sync.
 */
export function useSavedQueriesVersion(): number {
  return React.useSyncExternalStore(
    React.useCallback(
      (listener: () => void) => savedQueries.subscribe(listener),
      [],
    ),
    () => savedQueries.version,
    () => savedQueries.version,
  )
}
