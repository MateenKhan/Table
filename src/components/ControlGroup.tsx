import React from 'react'

type Props = {
  label: string
  children: React.ReactNode
  className?: string
}

/**
 * Outlined, captioned control container (Material "outlined" look).
 *
 * A hairline bordered box whose caption overlaps the top border, masking the
 * hairline behind it with a matching white background. Wrap a compact row of
 * controls to give it a titled group — e.g. "Pagination", "Rows", "Text".
 */
export function ControlGroup({ label, children, className }: Props) {
  return (
    <div
      className={`relative inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1${
        className ? ` ${className}` : ''
      }`}
    >
      <span className="absolute -top-2 left-2 bg-white px-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      {children}
    </div>
  )
}

export default ControlGroup
