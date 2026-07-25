import { Column, RowData, Table } from '@tanstack/react-table'
import React from 'react'

type Props<T extends RowData> = {
  table: Table<T>
}

export function ColumnVisibilityDropdown<T extends RowData>({
  table,
}: Props<T>) {
  const [isOpen, setIsOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const containerRef = React.useRef<HTMLDivElement>(null)

  // Close the menu when clicking anywhere outside of it
  React.useEffect(() => {
    if (!isOpen) return

    const onPointerDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [isOpen])

  const allColumns = table.getAllLeafColumns()
  const visibleCount = allColumns.filter((column) => column.getIsVisible())
    .length

  const matchesSearch = (column: Column<T, unknown>) =>
    column.id.toLowerCase().includes(search.trim().toLowerCase())

  const filteredColumns = allColumns.filter(matchesSearch)

  return (
    <div className="relative inline-block" ref={containerRef}>
      <button
        type="button"
        className="btn-ghost-sm"
        onClick={() => setIsOpen((open) => !open)}
      >
        <span>Columns</span>
        <span className="text-slate-500">
          {visibleCount}/{allColumns.length}
        </span>
        <span>{isOpen ? '▲' : '▼'}</span>
      </button>

      {isOpen ? (
        <div
          className="border border-slate-200 rounded-lg shadow-lg bg-white text-slate-700"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            zIndex: 20,
            minWidth: '14rem',
          }}
        >
          <div className="p-2 border-b border-slate-200">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search columns..."
              className="input-sm"
              autoFocus
            />
          </div>

          <div className="px-2 py-1 border-b border-slate-200 flex items-center justify-between gap-2">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                className="accent-accent-500"
                checked={table.getIsAllColumnsVisible()}
                onChange={table.getToggleAllColumnsVisibilityHandler()}
              />
              Toggle All
            </label>
            <span className="text-sm text-slate-500">{visibleCount} selected</span>
          </div>

          <div style={{ maxHeight: '16rem', overflowY: 'auto' }}>
            {filteredColumns.length === 0 ? (
              <div className="px-2 py-1 text-sm text-slate-500">
                No columns match "{search}"
              </div>
            ) : (
              filteredColumns.map((column) => {
                const pinned = column.getIsPinned()

                return (
                  <div
                    key={column.id}
                    className="px-2 py-1 flex items-center gap-1 sm:hover:bg-slate-50"
                  >
                    <label className="flex items-center gap-1.5 flex-1 cursor-pointer">
                      <input
                        type="checkbox"
                        className="accent-accent-500"
                        checked={column.getIsVisible()}
                        onChange={column.getToggleVisibilityHandler()}
                      />
                      {column.id}
                    </label>

                    {/* Pinning moved here from the header cells, which are now
                        reserved for the drag gesture. */}
                    {column.getCanPin() ? (
                      <span className="flex items-center gap-1">
                        <button
                          className={`rounded-lg border px-2 text-sm font-bold transition-colors ${
                            pinned === 'left'
                              ? 'bg-accent-50 text-accent-700 border-accent-200'
                              : 'bg-white text-slate-700 border-slate-200 sm:hover:bg-slate-50'
                          }`}
                          onClick={() =>
                            column.pin(pinned === 'left' ? false : 'left')
                          }
                          title={
                            pinned === 'left' ? 'Unpin' : 'Pin to the left'
                          }
                        >
                          {'<='}
                        </button>
                        <button
                          className={`rounded-lg border px-2 text-sm font-bold transition-colors ${
                            pinned === 'right'
                              ? 'bg-accent-50 text-accent-700 border-accent-200'
                              : 'bg-white text-slate-700 border-slate-200 sm:hover:bg-slate-50'
                          }`}
                          onClick={() =>
                            column.pin(pinned === 'right' ? false : 'right')
                          }
                          title={
                            pinned === 'right' ? 'Unpin' : 'Pin to the right'
                          }
                        >
                          {'=>'}
                        </button>
                      </span>
                    ) : null}
                  </div>
                )
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default ColumnVisibilityDropdown
