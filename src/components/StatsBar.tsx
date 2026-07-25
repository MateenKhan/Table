import { Table } from '@tanstack/react-table'
import { useCellSelection } from '../useCellSelection'
import {
  formatCellValue,
  isNumericType,
  TypeOptions,
} from '../columnTypes'

// The most cells we will ever scan for the aggregates. A whole-grid selection on
// a large sheet could otherwise be tens of thousands of reads on every render;
// past this cap we stop scanning and just report what we have.
const SCAN_CAP = 5000

type Props = {
  table: Table<any>
}

// Coerce a stored cell value into a finite number, or null when it is not one.
// Numeric columns store real numbers, but pasted / formula cells may arrive as
// numeric strings, so a trimmed string that parses cleanly counts too.
const asNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return null
    const n = Number(text)
    return Number.isFinite(n) ? n : null
  }
  return null
}

const isEmpty = (value: unknown) =>
  value === null || value === undefined || value === ''

// A plain, locale-grouped number for mixed / multi-column selections, where no
// single column meta applies. Integers stay integer; fractions keep a little
// precision without a wall of digits.
const formatPlain = (n: number): string => {
  if (Number.isInteger(n)) return n.toLocaleString('en-US')
  return n.toLocaleString('en-US', { maximumFractionDigits: 3 })
}

export default function StatsBar({ table }: Props) {
  const selection = useCellSelection()
  const scope = selection?.selectionScope

  if (!scope || scope.kind === 'none') return null

  // rowIndices are DATA indices; columnIds already exclude skip columns. When a
  // kind implies "all rows" / "all columns" and an axis came through empty, fall
  // back to every visible data row / leaf column accordingly.
  const rowIndices =
    scope.rowIndices.length > 0
      ? scope.rowIndices
      : table
          .getRowModel()
          .rows.filter((r) => !r.getIsGrouped())
          .map((r) => r.index)

  const columnIds =
    scope.columnIds.length > 0
      ? scope.columnIds
      : table.getVisibleLeafColumns().map((c) => c.id)

  const totalCells = rowIndices.length * columnIds.length
  // Only a genuine multi-cell selection earns a stats bar; a single cell is not
  // worth the clutter.
  if (totalCells <= 1) return null

  const data = table.options.data as Record<string, unknown>[]

  // When the selection sits inside exactly one numeric column, its meta drives
  // the Sum / Avg / Min / Max formatting so currency / units / decimals show.
  const singleColumnMeta: TypeOptions | undefined =
    columnIds.length === 1
      ? (table.getColumn(columnIds[0])?.columnDef.meta as TypeOptions | undefined)
      : undefined
  const useColumnFormat = !!singleColumnMeta && isNumericType(singleColumnMeta.type)

  let count = 0 // non-empty selected cells
  let numericCount = 0
  let sum = 0
  let min = Infinity
  let max = -Infinity
  let scanned = 0
  let capped = false

  outer: for (const rowIndex of rowIndices) {
    const row = data[rowIndex]
    if (!row) continue
    for (const columnId of columnIds) {
      if (scanned >= SCAN_CAP) {
        capped = true
        break outer
      }
      scanned++
      const value = row[columnId]
      if (isEmpty(value)) continue
      count++
      const n = asNumber(value)
      if (n !== null) {
        numericCount++
        sum += n
        if (n < min) min = n
        if (n > max) max = n
      }
    }
  }

  const hasNumbers = numericCount > 0
  const average = hasNumbers ? sum / numericCount : 0

  const fmt = (n: number) =>
    useColumnFormat ? formatCellValue(n, singleColumnMeta) : formatPlain(n)

  type Stat = { label: string; value: string }
  const stats: Stat[] = []
  stats.push({ label: 'Count', value: formatPlain(count) })
  if (hasNumbers) {
    stats.push({ label: 'Numeric', value: formatPlain(numericCount) })
    stats.push({ label: 'Sum', value: fmt(sum) })
    stats.push({ label: 'Avg', value: fmt(average) })
    stats.push({ label: 'Min', value: fmt(min) })
    stats.push({ label: 'Max', value: fmt(max) })
  } else {
    // Nothing numeric in the selection: keep Sum / Avg visible but empty so the
    // bar's shape is stable, rather than silently dropping them.
    stats.push({ label: 'Sum', value: '—' })
    stats.push({ label: 'Avg', value: '—' })
  }

  return (
    <div
      role="status"
      aria-live="off"
      className="custom-scrollbar flex items-center justify-end gap-3 overflow-x-auto rounded-lg border-t border-slate-200 bg-slate-50 px-3 py-1 text-2xs text-slate-600"
    >
      {capped ? (
        <span className="whitespace-nowrap text-slate-400" title="Only the first cells were scanned">
          first {SCAN_CAP.toLocaleString('en-US')} cells
        </span>
      ) : null}
      {stats.map((stat, i) => (
        <div key={stat.label} className="flex items-center gap-3 whitespace-nowrap">
          {i > 0 ? <span aria-hidden className="h-3 w-px bg-slate-300" /> : null}
          <span className="flex items-baseline gap-1">
            <span className="text-slate-400">{stat.label}</span>
            <span className="font-medium tabular-nums text-slate-700">
              {stat.value}
            </span>
          </span>
        </div>
      ))}
    </div>
  )
}
