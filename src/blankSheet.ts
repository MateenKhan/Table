// Generators for a "blank sheet" — the generic, structure-free grid a user is
// dropped into after Delete-all wipes the demo data. Everything here is tiny and
// pure: App calls these to reset both the column model and the rows, then applies
// `defaultColumn` (the EditableCell renderer) so the plain defs below become live
// editable columns.
import type { ColumnDef } from '@tanstack/react-table'

/**
 * Generic text columns for a blank sheet. Ids / accessorKeys are `col1..colN`.
 * Headers are EMPTY strings — the user types their own header by double-clicking
 * (the coordinate letters A/B/C above already identify the column), and a string
 * header is what the table's inline rename needs to seed its editor, so keep it a
 * string, never a render function. Each column is typed `text` for free entry.
 */
export function blankColumns(count = 6): ColumnDef<any>[] {
  const n = Math.max(0, Math.floor(count))
  const defs: ColumnDef<any>[] = []
  for (let i = 1; i <= n; i++) {
    const id = `col${i}`
    defs.push({
      id,
      accessorKey: id,
      header: '',
      meta: { type: 'text' },
    })
  }
  return defs
}

/** A single blank row: every given column id mapped to an empty string. */
export function blankRow(columnIds: string[]): Record<string, unknown> {
  const row: Record<string, unknown> = {}
  for (const id of columnIds) row[id] = ''
  return row
}

/** `count` blank rows, each carrying every column id set to `''`. */
export function blankRows(
  count: number,
  columnIds: string[],
): Record<string, unknown>[] {
  const n = Math.max(0, Math.floor(count))
  const rows: Record<string, unknown>[] = []
  for (let i = 0; i < n; i++) rows.push(blankRow(columnIds))
  return rows
}
