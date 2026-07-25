import { ThumbnailSize, THUMBNAIL_SIZES } from '../thumbnailSize'

type Props = {
  value: ThumbnailSize
  onChange: (size: ThumbnailSize) => void
}

const LABELS: Record<ThumbnailSize, string> = {
  S: 'Small thumbnails, tightly packed rows',
  M: 'Medium thumbnails',
  L: 'Large thumbnails, tall rows',
}

// Segmented S / M / L control. Borders and spacing follow the the shared UI design
// system; the selected state uses the brand accent (tier-1 selection).
export function ThumbnailSizeControl({ value, onChange }: Props) {
  return (
    <div
      className="border border-slate-200 rounded-lg flex items-center overflow-hidden"
      role="group"
      aria-label="Thumbnail size"
    >
      <span className="px-2 text-sm text-slate-500">Rows</span>
      {THUMBNAIL_SIZES.map((size) => {
        const isActive = size === value

        return (
          <button
            key={size}
            type="button"
            onClick={() => onChange(size)}
            title={LABELS[size]}
            aria-pressed={isActive}
            className={`min-h-control px-2.5 border-l border-slate-200 text-sm transition-colors ${
              isActive
                ? 'bg-accent-500 text-white font-bold'
                : 'bg-white text-slate-700 sm:hover:bg-slate-50'
            }`}
          >
            {size}
          </button>
        )
      })}
    </div>
  )
}

export default ThumbnailSizeControl
