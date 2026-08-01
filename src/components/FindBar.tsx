import React from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react'
import { usePartClass } from '../theme'

// A compact, browser-style "find on page" bar, portalled to the top-right. It is
// purely presentational: App owns the query, the match count and navigation and
// passes them in. Keyboard on the input (Enter / ↑ / ↓ / Esc) is forwarded to
// `onInputKeyDown`; F3 / Shift+F3 are handled globally by App while it is open.
export type FindBarProps = {
  query: string
  onQueryChange: (query: string) => void
  // 1-based position of the current match, and the total (0 when none).
  current: number
  total: number
  onNext: () => void
  onPrev: () => void
  onClose: () => void
  inputRef: React.RefObject<HTMLInputElement>
  onInputKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void
}

export function FindBar({
  query,
  onQueryChange,
  current,
  total,
  onNext,
  onPrev,
  onClose,
  inputRef,
  onInputKeyDown,
}: FindBarProps) {
  const partClass = usePartClass('toolbar')
  const count = query.trim() ? `${current}/${total}` : ''
  const noMatch = !!query.trim() && total === 0

  const navBtn =
    'inline-grid place-items-center w-7 h-7 rounded-md text-slate-600 sm:hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed'

  return createPortal(
    <div
      data-jt="find"
      className={`fixed top-3 right-4 z-[300] flex items-center gap-1 rounded-xl border border-slate-300 bg-white px-2 py-1.5 shadow-lg ${partClass}`}
      role="search"
    >
      <Search size={15} className="text-slate-400 shrink-0 ml-0.5" aria-hidden />
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={onInputKeyDown}
        placeholder="Find in table"
        aria-label="Find in table"
        className="w-44 bg-transparent px-1 py-0.5 text-sm text-slate-900 outline-none placeholder:text-slate-400"
      />
      <span
        className={`min-w-[3rem] text-center text-2xs tabular-nums ${
          noMatch ? 'text-rose-500' : 'text-slate-500'
        }`}
      >
        {count}
      </span>
      <div className="mx-0.5 h-5 w-px bg-slate-200" aria-hidden />
      <button
        type="button"
        className={navBtn}
        title="Previous (Shift+F3 / ↑)"
        aria-label="Previous match"
        onClick={onPrev}
        disabled={total === 0}
      >
        <ChevronUp size={16} />
      </button>
      <button
        type="button"
        className={navBtn}
        title="Next (F3 / Enter / ↓)"
        aria-label="Next match"
        onClick={onNext}
        disabled={total === 0}
      >
        <ChevronDown size={16} />
      </button>
      <button
        type="button"
        className={navBtn}
        title="Close (Esc)"
        aria-label="Close find"
        onClick={onClose}
      >
        <X size={16} />
      </button>
    </div>,
    document.body,
  )
}

export default FindBar
