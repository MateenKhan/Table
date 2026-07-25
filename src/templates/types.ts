// ─────────────────────────────────────────────────────────────────────────────
// PROFILES / TEMPLATES — optional per-site verticals.

// ─────────────────────────────────────────────────────────────────────────────
//
// A *profile* is just a named set of columns (+ starter rows): Cupboard, Table,
// Bed, … Each is a piece of furniture / interior element. A *vertical* (Interior,
// …) is the set of profiles a site subdomain offers. The user multi-selects
// profiles and they COMBINE into one sheet — see composeProfiles (model C).

import { ColumnType, TypeOptions } from '../columnTypes'

export type ProfileColumn = {
  // Field key in the row object. Two profiles that share the SAME id (e.g.
  // 'width') are treated as the SAME column and merged under model C.
  id: string
  header: string
  type: ColumnType
  // Seed value for a starter row of the owning profile.
  defaultValue?: unknown
  // Extra column meta (decimals, suffix, currency, accept, …) merged into the
  // ColumnDef's meta so editing/formatting behave like any typed column.
  meta?: Partial<TypeOptions>
}

export type Profile = {
  id: string
  name: string
  columns: ProfileColumn[]
  // How many starter rows this profile seeds when selected. Default 2.
  rows?: number
}

export type Vertical = {
  id: string
  name: string
  // The hostname label that preloads this vertical (interior.example.com).
  subdomain: string
  profiles: Profile[]
  // Profile ids selected on first load. Empty = start with nothing selected.
  defaultSelected?: string[]
}
