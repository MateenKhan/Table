import React from 'react'

type Props = {
  // Rendered at the start of the row, before the pagination options. Kept
  // optional so App isn't broken mid-transition.
  leadingControls?: React.ReactNode
  hasNextPage: boolean
  hasPreviousPage: boolean
  nextPage: () => void
  pageCount: number
  pageIndex: number
  pageSize: number
  previousPage: () => void
  setPageIndex: (index: number) => void
  setPageSize: (size: number) => void
}

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(Math.max(n, lo), hi)

// Compact chevron — tighter than a full 36px icon button so the pager doesn't
// spread out.
const CHEV =
  'grid h-8 place-items-center rounded-lg px-1 text-slate-600 transition-colors sm:hover:bg-slate-100 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none'
// Compact numeric input: short + narrow so "1" and "10" don't sit in a big box.
const NUM = 'input-sm !min-h-0 !h-8 !px-1 text-center'

// Row size beyond this risks rendering the whole set at once and freezing the
// page, so it's the hard ceiling.
const MAX_ROWS = 10000

export function PaginationControls({
  leadingControls,
  hasNextPage,
  hasPreviousPage,
  nextPage,
  pageCount,
  pageIndex,
  pageSize,
  previousPage,
  setPageIndex,
  setPageSize,
}: Props) {
  // Both inputs are locally controlled from the prop, so keystrokes show while
  // typing but only commit (clamped) on Enter / blur. Current values are the
  // defaults.
  const [pageDraft, setPageDraft] = React.useState(String(pageIndex + 1))
  const [sizeDraft, setSizeDraft] = React.useState(String(pageSize))

  React.useEffect(() => {
    setPageDraft(String(pageIndex + 1))
  }, [pageIndex])
  React.useEffect(() => {
    setSizeDraft(String(pageSize))
  }, [pageSize])

  const commitPage = () => {
    const parsed = parseInt(pageDraft, 10)
    if (Number.isNaN(parsed) || parsed < 1) {
      setPageDraft(String(pageIndex + 1))
      return
    }
    const next = clamp(parsed, 1, Math.max(pageCount, 1))
    setPageIndex(next - 1)
    setPageDraft(String(next))
  }

  const commitSize = () => {
    const parsed = parseInt(sizeDraft, 10)
    if (Number.isNaN(parsed) || parsed < 1) {
      setSizeDraft(String(pageSize))
      return
    }
    const next = clamp(parsed, 1, MAX_ROWS)
    setPageSize(next)
    setSizeDraft(String(next))
  }

  const onlyDigits = (v: string) => v.replace(/[^0-9]/g, '')
  const selectOnFocus = (e: React.FocusEvent<HTMLInputElement>) =>
    e.currentTarget.select()

  return (
    <div className="flex items-center gap-0 text-sm">
      {leadingControls}

      <button
        className={CHEV}
        onClick={() => setPageIndex(0)}
        disabled={!hasPreviousPage}
        title="First page"
        aria-label="First page"
      >
        {'|<'}
      </button>
      <button
        className={CHEV}
        onClick={() => previousPage()}
        disabled={!hasPreviousPage}
        title="Previous page"
        aria-label="Previous page"
      >
        {'<'}
      </button>

      {/* Current-page input — reads "3 / 100". */}
      <div className="inline-flex items-center gap-0.5 px-0.5">
        <input
          className={`${NUM} !w-11`}
          type="text"
          inputMode="numeric"
          placeholder="Pg"
          aria-label="Current page"
          value={pageDraft}
          onFocus={selectOnFocus}
          onChange={(e) => setPageDraft(onlyDigits(e.target.value))}
          onBlur={commitPage}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commitPage()
              e.currentTarget.blur()
            }
          }}
        />
        <span className="text-2xs text-slate-500">/ {pageCount}</span>
      </div>

      <button
        className={CHEV}
        onClick={() => nextPage()}
        disabled={!hasNextPage}
        title="Next page"
        aria-label="Next page"
      >
        {'>'}
      </button>
      <button
        className={CHEV}
        onClick={() => setPageIndex(pageCount - 1)}
        disabled={!hasNextPage}
        title="Last page"
        aria-label="Last page"
      >
        {'>|'}
      </button>

      {/* Page-size input — the "rows" hint sits INSIDE the field as a tiny faint
          suffix (right-padded so the value never overlaps it), rather than a
          separate label outside. */}
      <div className="relative ml-1 inline-flex items-center">
        <input
          className={`${NUM} !w-12 !pb-2.5 text-center`}
          type="text"
          inputMode="numeric"
          aria-label="Rows per page"
          value={sizeDraft}
          onFocus={selectOnFocus}
          onChange={(e) => setSizeDraft(onlyDigits(e.target.value))}
          onBlur={commitSize}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commitSize()
              e.currentTarget.blur()
            }
          }}
        />
        <span className="pointer-events-none absolute bottom-[1px] left-1/2 -translate-x-1/2 text-[7px] uppercase leading-none tracking-tight text-slate-400">
          rows
        </span>
      </div>
    </div>
  )
}

export default PaginationControls
