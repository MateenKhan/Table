// Serialisable description of the WHOLE column tree — groups, headers, types,
// order and sizes — so an export carries the table's structure, not just its
// cell values, and an import can rebuild an identical table (a true clone).
//
// A live `ColumnDef` is full of functions (accessorFn, cell/header renderers,
// sort/filter fns) that cannot be JSON'd. We keep only the serialisable shape
// here; on rebuild the missing pieces are supplied by the library's own default
// machinery — the `DefaultCell` dispatch renders text/number/date/image/file
// from `meta.type`, and header text comes back as a plain string.

import type { ColumnDef, RowData } from '@tanstack/react-table'
import type { TypeOptions } from './columnTypes'

export type ColumnSchemaLeaf = {
  kind: 'leaf'
  id: string
  // The data key this column reads. Falls back to `id` when a column used an
  // accessor function (e.g. a computed `fullName`) — the stored value is kept in
  // `data` under that id, so reading it back by key reproduces the same cells.
  accessorKey?: string
  header?: string
  meta?: TypeOptions
  size?: number
  // Structural columns rebuilt from a built-in rather than from meta (the row
  // checkbox). Absent for ordinary data columns.
  role?: 'select'
  enableSorting?: boolean
  enableColumnFilter?: boolean
  enableGrouping?: boolean
  enableGlobalFilter?: boolean
}

export type ColumnSchemaGroup = {
  kind: 'group'
  id?: string
  header?: string
  columns: ColumnSchemaNode[]
}

export type ColumnSchemaNode = ColumnSchemaLeaf | ColumnSchemaGroup

/* --------------------------------------------------------------- serialise */

// Pull display text out of a header that may be a string, a function returning a
// string, or a function returning JSX (e.g. `() => <span>Last Name</span>`).
function reactNodeText(node: unknown): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(reactNodeText).join('')
  const props = (node as { props?: { children?: unknown } }).props
  if (props && 'children' in props) return reactNodeText(props.children)
  return ''
}

function headerToString(header: unknown, fallback: string): string {
  if (typeof header === 'string') return header
  if (typeof header === 'function') {
    try {
      // Header fns that read the render context throw on an empty arg and fall
      // back — fine, those are structural columns handled by `role`.
      const rendered = (header as (ctx: unknown) => unknown)({})
      const text =
        typeof rendered === 'string' ? rendered : reactNodeText(rendered)
      return text.trim() || fallback
    } catch {
      return fallback
    }
  }
  return fallback
}

type RawDef = Record<string, unknown>

function serializeOne(raw: unknown): ColumnSchemaNode {
  const def = raw as RawDef
  if (Array.isArray(def.columns)) {
    const id = (def.id as string | undefined) ?? undefined
    const header = headerToString(def.header, id ?? 'Group')
    return {
      kind: 'group',
      id,
      header,
      columns: serializeColumns(def.columns),
    }
  }
  const id = String(def.id ?? def.accessorKey ?? '')
  const accessorKey = def.accessorKey ? String(def.accessorKey) : undefined
  const leaf: ColumnSchemaLeaf = {
    kind: 'leaf',
    id,
    accessorKey,
    header: headerToString(def.header, accessorKey ?? id),
    meta: def.meta as TypeOptions | undefined,
  }
  if (typeof def.size === 'number') leaf.size = def.size
  if (id === 'select') leaf.role = 'select'
  if (def.enableSorting === false) leaf.enableSorting = false
  if (def.enableColumnFilter === false) leaf.enableColumnFilter = false
  if (def.enableGrouping === false) leaf.enableGrouping = false
  if (def.enableGlobalFilter === false) leaf.enableGlobalFilter = false
  return leaf
}

/** Serialise a column-def array (the base, pre-merge schema) into a JSON tree. */
export function serializeColumns(defs: readonly unknown[]): ColumnSchemaNode[] {
  return defs.map(serializeOne)
}

/* ----------------------------------------------------------------- rebuild */

/** True for a well-formed schema tree (used to validate imported payloads). */
export function isColumnSchema(value: unknown): value is ColumnSchemaNode[] {
  return (
    Array.isArray(value) &&
    value.every(
      (n) =>
        !!n &&
        typeof n === 'object' &&
        ((n as ColumnSchemaNode).kind === 'leaf' ||
          (n as ColumnSchemaNode).kind === 'group'),
    )
  )
}

function rebuildOne<T extends RowData>(
  node: ColumnSchemaNode,
  selectColumn: ColumnDef<T>,
): ColumnDef<T> {
  if (node.kind === 'group') {
    return {
      id: node.id ?? node.header ?? 'group',
      header: node.header,
      columns: node.columns.map((child) => rebuildOne(child, selectColumn)),
    } as ColumnDef<T>
  }
  if (node.role === 'select') return selectColumn

  const col: Record<string, unknown> = {
    id: node.id,
    accessorKey: node.accessorKey ?? node.id,
    header: node.header ?? node.id,
  }
  if (node.meta) col.meta = node.meta
  if (typeof node.size === 'number') col.size = node.size
  if (node.enableSorting === false) col.enableSorting = false
  if (node.enableColumnFilter === false) col.enableColumnFilter = false
  if (node.enableGrouping === false) col.enableGrouping = false
  if (node.enableGlobalFilter === false) col.enableGlobalFilter = false
  return col as unknown as ColumnDef<T>
}

/**
 * Rebuild a live `ColumnDef[]` from a serialised schema. Cell rendering is left
 * to the table's `defaultColumn` (which dispatches on `meta.type`); the row
 * checkbox is restored from the passed-in `selectColumn`.
 */
export function rebuildColumns<T extends RowData>(
  schema: ColumnSchemaNode[],
  selectColumn: ColumnDef<T>,
): ColumnDef<T>[] {
  return schema.map((node) => rebuildOne(node, selectColumn))
}
