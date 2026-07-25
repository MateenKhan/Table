import React from 'react'

// A colour tone for a group's outline + caption. Each group in the actions row
// gets its own so the border colour and the name read as a matched pair.
export type ControlGroupTone =
  | 'slate'
  | 'sky'
  | 'emerald'
  | 'violet'
  | 'teal'
  | 'amber'
  | 'rose'

const TONES: Record<ControlGroupTone, { border: string; caption: string }> = {
  slate: { border: 'border-slate-200', caption: 'text-slate-500' },
  sky: { border: 'border-sky-200', caption: 'text-sky-600' },
  emerald: { border: 'border-emerald-200', caption: 'text-emerald-600' },
  violet: { border: 'border-violet-200', caption: 'text-violet-600' },
  teal: { border: 'border-teal-200', caption: 'text-teal-600' },
  amber: { border: 'border-amber-200', caption: 'text-amber-600' },
  rose: { border: 'border-rose-300', caption: 'text-rose-500' },
}

type Props = {
  label: string
  tone?: ControlGroupTone
  children: React.ReactNode
  className?: string
}

/**
 * Outlined, captioned control container (Material "outlined" look).
 *
 * A bordered box whose caption overlaps the top border, masking the line behind
 * it with a matching white background. `tone` colours BOTH the outline and the
 * caption so each group in the actions row is a named, colour-coded cluster —
 * e.g. "Pagination" (sky), "Tools" (emerald), "Danger" (rose).
 */
export function ControlGroup({
  label,
  tone = 'slate',
  children,
  className,
}: Props) {
  const t = TONES[tone]
  return (
    <div
      className={`relative mt-1 inline-flex items-center gap-1 rounded-lg border ${t.border} bg-white px-2 pb-1 pt-2${
        className ? ` ${className}` : ''
      }`}
    >
      <span
        className={`absolute -top-2 left-2 bg-white px-1 text-[10px] font-semibold uppercase tracking-wide ${t.caption}`}
      >
        {label}
      </span>
      {children}
    </div>
  )
}

export default ControlGroup
