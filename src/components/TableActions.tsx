import ActionsBar, { ActionFormat } from './ActionsBar'
import { useCellSelection } from '../useCellSelection'
import {
  tableFormatting,
  resolveFormat,
  useFormatVersion,
  FONT_SIZE_OPTIONS,
  FONT_FAMILY_OPTIONS,
} from '../formatting'

// Connects the (pure, props-driven) ActionsBar to the live selection scope and
// the formatting store. Rendered INSIDE CellSelectionProvider so it can read the
// current selection; the data-mutating callbacks come down from App.
type Props = {
  data: Record<string, unknown>[]
  onDeleteAllTable: () => void
  onRestoreTable: () => void
  onDeleteRows: (rowIndices: number[]) => void
  onEmptyColumns: (columnIds: string[]) => void
  onMergeColumns: (columnIds: string[]) => void
}

// Pass label+value so the picker shows "Sans"/"Serif"/"Mono", not the full stack.
const FONT_FAMILY_ITEMS = FONT_FAMILY_OPTIONS.map((o) => ({
  label: o.label,
  value: o.value,
}))
const FONT_SIZE_STRINGS = [...FONT_SIZE_OPTIONS]

export default function TableActions({
  data,
  onDeleteAllTable,
  onRestoreTable,
  onDeleteRows,
  onEmptyColumns,
  onMergeColumns,
}: Props) {
  const selection = useCellSelection()
  // Re-render when any format changes so the bar's active states stay truthful.
  useFormatVersion()
  if (!selection) return null

  const scope = selection.selectionScope

  // The effective format of a representative target, for the bar's active state.
  const repCol = scope.columnIds[0] ?? ''
  const repRow = scope.rowIndices[0] ?? -1
  const currentFormat: ActionFormat = repCol
    ? (resolveFormat(repCol, repRow) as ActionFormat)
    : {}

  const onSetFormat = (patch: ActionFormat) => {
    for (const key of selection.getFormatScopeKeys()) {
      tableFormatting.update(key, patch)
    }
  }

  // Does the current selection actually hold data? Drives the data-loss confirm.
  const selectionHasValues = (() => {
    if (!scope.columnIds.length) return false
    const rows = scope.rowIndices.length
      ? scope.rowIndices
      : data.map((_, i) => i)
    for (const r of rows) {
      const row = data[r]
      if (!row) continue
      for (const c of scope.columnIds) {
        const v = row[c]
        if (v !== undefined && v !== null && String(v).trim() !== '') return true
      }
    }
    return false
  })()

  return (
    <ActionsBar
      scope={scope}
      selectionHasValues={selectionHasValues}
      currentFormat={currentFormat}
      onSetFormat={onSetFormat}
      fontFamilies={FONT_FAMILY_ITEMS}
      fontSizes={FONT_SIZE_STRINGS}
      onDeleteAllTable={onDeleteAllTable}
      onRestoreTable={onRestoreTable}
      onDeleteRows={onDeleteRows}
      onEmptyColumns={onEmptyColumns}
      onMergeColumns={onMergeColumns}
    />
  )
}
