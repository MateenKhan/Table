// Profile registry + composition. EXCLUDED from the shared UI import.

import { ColumnDef } from '@tanstack/react-table'
import { interiorVertical } from './interior'
import { Profile, ProfileColumn, Vertical } from './types'

export const VERTICALS: Vertical[] = [interiorVertical]

export const getVertical = (id: string | null | undefined): Vertical | undefined =>
  id ? VERTICALS.find((v) => v.id === id || v.subdomain === id) : undefined

export type ComposedSheet = {
  columns: ColumnDef<any>[]
  data: Record<string, unknown>[]
}

/**
 * Combine the selected profiles into one sheet.
 *
 * MODEL C (shared columns merge, unique ones append): two profiles that declare
 * the SAME column id — every furniture profile shares length/width/height — get
 * ONE shared column; profile-specific columns (shelves, seats, size) append after
 * in first-seen order. Each row is tagged with its profile in a leading `Profile`
 * column; cells for columns that don't belong to a row's profile stay blank.
 *
 * This is the ONLY place the combination model lives — swapping to a flat union
 * (A) or stacked sections (B) is a change here and nowhere else.
 */
export function composeProfiles(
  vertical: Vertical,
  selectedIds: string[],
): ComposedSheet {
  const selected: Profile[] = selectedIds
    .map((id) => vertical.profiles.find((p) => p.id === id))
    .filter((p): p is Profile => Boolean(p))

  const order: string[] = []
  const byId = new Map<string, ProfileColumn>()
  for (const profile of selected) {
    for (const col of profile.columns) {
      if (!byId.has(col.id)) {
        byId.set(col.id, col)
        order.push(col.id)
      }
    }
  }

  const columns: ColumnDef<any>[] = [
    {
      accessorKey: 'profile',
      header: 'Profile',
      footer: 'profile',
      meta: { type: 'text' },
    },
    ...order.map((id) => {
      const col = byId.get(id)!
      return {
        accessorKey: id,
        header: col.header,
        footer: id,
        meta: { type: col.type, ...(col.meta ?? {}) },
      } as ColumnDef<any>
    }),
  ]

  const data: Record<string, unknown>[] = []
  for (const profile of selected) {
    const rows = profile.rows ?? 2
    for (let i = 0; i < rows; i++) {
      const row: Record<string, unknown> = { profile: profile.name }
      for (const col of profile.columns) {
        row[col.id] = col.defaultValue ?? ''
      }
      data.push(row)
    }
  }

  return { columns, data }
}
