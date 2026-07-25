import React from 'react'
import { Vertical } from '../templates/types'

// Multi-select of the active vertical's profiles (Cupboard, Table, Bed, …).
// Picking several combines them into one sheet (see composeProfiles, model C).
// An optional, lazily-loaded vertical (not part of the core table).

type Props = {
  vertical: Vertical
  selectedIds: string[]
  onChange: (ids: string[]) => void
}

export function TemplateSelector({ vertical, selectedIds, onChange }: Props) {
  const [open, setOpen] = React.useState(false)

  const selected = new Set(selectedIds)
  const toggle = (id: string) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    // Preserve the vertical's declared profile order.
    onChange(vertical.profiles.filter((p) => next.has(p.id)).map((p) => p.id))
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        className="btn-ghost-sm"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
      >
        <span className="font-bold">{vertical.name}</span>
        <span className="text-slate-500">
          {selected.size}/{vertical.profiles.length}
        </span>
        <span aria-hidden="true">▾</span>
      </button>

      {open && (
        <>
          {/* Click-away. */}
          <div
            className="fixed inset-0 z-[70]"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            className="absolute left-0 z-[75] mt-1 min-w-[16rem] rounded-lg border border-slate-200 bg-white shadow-lg custom-scrollbar"
            role="menu"
          >
            <div className="eyebrow px-3 pt-2 pb-1">Profiles</div>
            <div className="max-h-72 overflow-y-auto pb-1">
              {vertical.profiles.map((profile) => {
                const checked = selected.has(profile.id)
                return (
                  <label
                    key={profile.id}
                    className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm text-slate-700 sm:hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      className="accent-accent-500"
                      checked={checked}
                      onChange={() => toggle(profile.id)}
                    />
                    <span className="flex-1 font-medium text-slate-900">
                      {profile.name}
                    </span>
                    <span className="text-slate-500">
                      {profile.columns.length} cols
                    </span>
                  </label>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default TemplateSelector
